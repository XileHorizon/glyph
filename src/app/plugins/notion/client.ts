import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../../core/tauri.ts';
import { host } from './manifest.ts';

/**
 * Notion, from the page: signing in, the boards a note can send its list to,
 * and the tasks on them.
 *
 * Matt: link Notion boards so list items become Notion tasks (by voice, by
 * swiping an item, or a whole list at once), and "add a note for the notion
 * task for <title>" to reference a task as a link.
 *
 * - Signing in is "Sign in with Notion" through glyph-api (server/src/notion.rs):
 *   this page makes a random state and verifier, opens the browser at `start`
 *   with the verifier's SHA-256, and collects the tokens from `claim` when the
 *   person comes back. The tokens go straight to Rust (`notion_save_account`)
 *   and are never kept here.
 * - Every Notion call goes through Rust (`notion_request`): api.notion.com does
 *   not answer a web page, and Rust holds the token. Native generation 12.
 * - Which board a note sends to is a fact about this phone: the plugin's
 *   storage, `glyph-notion-links`, cleared by a reset.
 *
 * All of it through the plugin's host (plugins/host.ts), so the four native
 * commands and two keys in the manifest are all it can reach.
 */

const API = 'https://attack.fm/glyph/api/notion';
const LINKS_KEY = 'glyph-notion-links';
const SIGN_IN_KEY = 'glyph-notion-signin';

// ---- availability ----------------------------------------------------------------------

/** Whether this binary can talk to Notion at all. */
export async function notionAvailable(): Promise<boolean> {
  return isTauri() && (await host.nativeReady());
}

let ready = false;
void notionAvailable().then((yes) => (ready = yes));

/** The last answer of `notionAvailable`, for code that cannot wait (a swipe deciding whether it counts). */
export function notionReadyNow(): boolean {
  return ready;
}

// ---- the account --------------------------------------------------------------------------

export interface NotionAccount {
  connected: boolean;
  workspaceName?: string | null;
  workspaceIcon?: string | null;
}

export async function notionAccount(): Promise<NotionAccount> {
  if (!(await notionAvailable())) return { connected: false };
  return host.invoke<NotionAccount>('notion_account').catch(() => ({ connected: false }));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Starts "Sign in with Notion": the browser opens at Notion's consent page.
 * The state and verifier are remembered so the sign-in can be collected after
 * Glyph comes back to the front, even if the page reloaded meanwhile.
 */
export async function startNotionSignIn(): Promise<void> {
  if (!(await notionAvailable())) throw new Error('Notion needs the newest Ghost.md. Install it from Settings > Updates.');
  const state = randomToken();
  const verifier = randomToken();
  const challenge = await challengeOf(verifier);
  // Without storage the sign-in can still be collected in this page's life.
  host.storage.set(SIGN_IN_KEY, { state, verifier, at: Date.now() });
  pendingSignIn = { state, verifier, at: Date.now() };
  await host.openUrl(`${API}/start?state=${encodeURIComponent(state)}&challenge=${encodeURIComponent(challenge)}`);
}

let pendingSignIn: { state: string; verifier: string; at: number } | null = null;

function signInInFlight(): { state: string; verifier: string; at: number } | null {
  if (pendingSignIn) return pendingSignIn;
  const saved = host.storage.get<{ state: string; verifier: string; at: number } | null>(SIGN_IN_KEY, null);
  if (saved && typeof saved.state === 'string' && Date.now() - saved.at < 10 * 60_000) return (pendingSignIn = saved);
  return null;
}

function forgetSignIn(): void {
  pendingSignIn = null;
  host.storage.remove(SIGN_IN_KEY);
}

/**
 * Collects a finished sign-in: the account, or `pending` while the person is
 * still on Notion's page, or null when none was started. A sign-in that was
 * refused or failed says why.
 */
export async function collectNotionSignIn(): Promise<NotionAccount | 'pending' | null> {
  const flight = signInInFlight();
  if (!flight) return null;
  host.require('network');
  const response = await fetch(`${API}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: flight.state, verifier: flight.verifier }),
  });
  if (response.status === 202) return 'pending';
  const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  forgetSignIn();
  if (!response.ok) throw new Error(typeof answer.error === 'string' ? answer.error : 'Notion sign-in did not finish.');
  return host.invoke<NotionAccount>('notion_save_account', { account: answer });
}

export async function disconnectNotion(): Promise<void> {
  forgetSignIn();
  if (await notionAvailable()) await host.invoke('notion_disconnect');
}

/** The account, kept current: re-read on focus, and a sign-in in flight collected when Glyph comes back. */
export function useNotionAccount(): { account: NotionAccount | null; problem: string | null; refresh: () => Promise<void> } {
  const [account, setAccount] = useState<NotionAccount | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const collected = await collectNotionSignIn();
      if (collected && collected !== 'pending') setAccount(collected);
      else setAccount(await notionAccount());
      setProblem(null);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
      setAccount(await notionAccount());
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);
  return { account, problem, refresh };
}

// ---- calls ------------------------------------------------------------------------------

interface Answer<T> {
  status: number;
  body: T;
}

/** A call to Notion's API through the app, with Notion's refusals as sentences. */
export async function notionRequest<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const answer = await host.invoke<Answer<T & { message?: string }>>('notion_request', { request: { method, path, body: body ?? null } });
  if (answer.status >= 400) {
    const message = (answer.body as { message?: string } | null)?.message;
    if (answer.status === 401) throw new Error('Notion signed Ghost.md out. Sign in again in Settings > Notion.');
    if (answer.status === 404) throw new Error(path.startsWith('pages/') ? 'Notion can’t see that task. Share its board with Ghost.md in Notion.' : 'Notion can’t see that board. Share it with Ghost.md in Notion.');
    throw new Error(message ?? `Notion answered ${answer.status}.`);
  }
  return answer.body;
}

/** Plain text of a Notion rich text array. */
function plain(rich: unknown): string {
  return Array.isArray(rich) ? rich.map((r) => (r as { plain_text?: string }).plain_text ?? '').join('') : '';
}

export interface Board {
  id: string;
  title: string;
  url: string;
  /** The name of the board's title property: every database has exactly one. */
  titleProperty: string;
  /** A checkbox or status property that marks a task done, if the board has one. */
  doneProperty: { name: string; kind: 'checkbox' | 'status' } | null;
}

interface DatabaseObject {
  id: string;
  url: string;
  title?: unknown;
  properties?: Record<string, { type: string; name?: string }>;
}

function boardOf(db: DatabaseObject): Board {
  const properties = Object.entries(db.properties ?? {});
  const titleProperty = properties.find(([, p]) => p.type === 'title')?.[0] ?? 'Name';
  const status = properties.find(([, p]) => p.type === 'status');
  const checkbox = properties.find(([, p]) => p.type === 'checkbox');
  return {
    id: db.id,
    url: db.url,
    title: plain(db.title) || 'Untitled board',
    titleProperty,
    doneProperty: status ? { name: status[0], kind: 'status' } : checkbox ? { name: checkbox[0], kind: 'checkbox' } : null,
  };
}

/** Every board (database) the sign-in was given access to, recently edited first. */
export async function listBoards(): Promise<Board[]> {
  const found = await notionRequest<{ results: DatabaseObject[] }>('POST', 'search', {
    filter: { property: 'object', value: 'database' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
    page_size: 50,
  });
  return found.results.map(boardOf);
}

export interface Task {
  id: string;
  title: string;
  url: string;
}

/** Makes a task on `board` and answers it, with its link. */
export async function createTask(board: Board, title: string): Promise<Task> {
  const page = await notionRequest<{ id: string; url: string }>('POST', 'pages', {
    parent: { database_id: board.id },
    properties: { [board.titleProperty]: { title: [{ type: 'text', text: { content: title.slice(0, 2000) } }] } },
  });
  return { id: page.id, title, url: page.url };
}

/** The board's tasks whose titles contain `words`, for "add a note for the notion task for …". */
export async function findTasks(board: Board, words: string): Promise<Task[]> {
  const result = await notionRequest<{ results: Array<{ id: string; url: string; properties: Record<string, { type: string; title?: unknown }> }> }>(
    'POST',
    `databases/${board.id}/query`,
    {
      filter: words.trim() ? { property: board.titleProperty, title: { contains: words.trim().split(/\s+/)[0] } } : undefined,
      page_size: 50,
    },
  );
  return result.results.map((page) => ({
    id: page.id,
    url: page.url,
    title: plain(Object.values(page.properties).find((p) => p.type === 'title')?.title) || 'Untitled',
  }));
}

// ---- which note sends to which board -------------------------------------------------------

export type BoardLinks = Record<string, Board>;

export function boardLinks(): BoardLinks {
  const links = host.storage.get<BoardLinks>(LINKS_KEY, {});
  return links && typeof links === 'object' ? links : {};
}

export function boardFor(noteId: string): Board | null {
  return boardLinks()[noteId] ?? null;
}

export function linkBoard(noteId: string, board: Board | null): void {
  // A copy: what a read answers is shared with every other read of it (plugins/host.ts).
  const links = { ...boardLinks() };
  if (board) links[noteId] = board;
  else delete links[noteId];
  host.storage.set(LINKS_KEY, links);
}
