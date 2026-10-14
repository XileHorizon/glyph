import { call } from '../core/account/api.ts';
import { accountState } from '../core/account/account.ts';
import { fromBase64Url, openBytes, sealBytes, toBase64Url } from '../core/sync/crypto.ts';
import { withFrontMatterTitle, frontMatterValue } from '../core/frontMatter.ts';
import { createNote, listNotes, newNoteId, noteTitle, NOTE_SAVED, type Note } from '../core/store.ts';
import { chaptersOf, isBookBody } from '../book/book.ts';
import { sameTitle } from '../editor/wikiLinks.ts';
import { zipFiles } from './zip.ts';

/**
 * Sharing a note or a book by its link (docs/SHARING.md).
 *
 * Matt: "share books and notes with people online and allow them to read only the notes and give them areas to fork
 * the note into their own Ghost.md app". His choices: anyone with the link reads it, and the server cannot; what is
 * shared follows the owner's edits; readers open a small page of its own made of the app's parts; and a reader can
 * save a copy into their own Ghost.md or download it as Markdown.
 *
 * So a share is sealed on the device under a key made for that share alone, and the key rides in the link after the
 * `#`, which a browser never sends to a server: the link is the only way in, and the service (server/src/shares.rs)
 * keeps ciphertext it cannot open, as it does a synced note. A book is shared whole - its index and every chapter
 * that has a note - so the reader can turn its pages. This device keeps which of its notes it has shared, with each
 * share's key, and writes a share again a few seconds after any save that changed what it holds.
 */

/** What a share holds, sealed. A note is one page; a book is its index first, then its chapters in order. */
export interface Shared {
  v: 1;
  kind: 'note' | 'book';
  title: string;
  pages: { title: string; body: string }[];
  /** When it was written, in ms. */
  at: number;
}

/** The context a share is sealed in: a synced note's ciphertext cannot be passed off as a share, nor the reverse. */
const CONTEXT = 'glyph/v1/share';

/** Where a reader reads: the small page beside the app (read.html). */
export const READER_URL: string =
  (import.meta.env.VITE_GLYPH_READER as string | undefined)?.replace(/\/+$/, '') || 'https://attack.fm/glyph/read.html';

// ---- keys, ids and links --------------------------------------------------------------------

function random(bytes: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return out;
}

/** A share's id: 128 random bits, base64url. */
export function newShareId(): string {
  return toBase64Url(random(16));
}

/** A share's key: 256 random bits, base64url, carried in the link and nowhere else but this device. */
export function newShareKey(): string {
  return toBase64Url(random(32));
}

function keyOf(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64Url(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function sealShare(shared: Shared, key: string): Promise<string> {
  return toBase64Url(await sealBytes(await keyOf(key), new TextEncoder().encode(JSON.stringify(shared)), CONTEXT));
}

export async function openShare(blob: string, key: string): Promise<Shared> {
  const bytes = await openBytes(await keyOf(key), fromBase64Url(blob), CONTEXT);
  const shared = JSON.parse(new TextDecoder().decode(bytes)) as Shared;
  if (shared?.v !== 1 || !Array.isArray(shared.pages)) throw new Error('This link was shared by a newer Ghost.md. Update the app to read it.');
  return shared;
}

/** The link a reader opens: the reader page, and after the `#` the share's id and key. */
export function shareLink(id: string, key: string): string {
  return `${READER_URL}#${id}.${key}`;
}

const LINKED = /([A-Za-z0-9_-]{22,64})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

/** A share's id and key out of a link, or out of what follows its `#`; null when it holds none. */
export function readShareLink(text: string): { id: string; key: string } | null {
  const hash = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text;
  const found = LINKED.exec(hash.trim());
  return found ? { id: found[1]!, key: found[2]! } : null;
}

// ---- what a note or a book shares ---------------------------------------------------------------

/** What `note` shares: itself, or a book's index and every chapter that has a note, found among `notes`. */
export function sharedOf(note: Note, notes: readonly Note[]): Shared {
  const title = noteTitle(note.body) || 'Untitled';
  if (!isBookBody(note.body)) return { v: 1, kind: 'note', title, pages: [{ title, body: note.body }], at: Date.now() };
  const pages = [{ title, body: note.body }];
  for (const chapter of chaptersOf(note.body)) {
    const found = notes.find((n) => n.id !== note.id && sameTitle(noteTitle(n.body), chapter.title));
    if (found && !pages.some((p) => sameTitle(p.title, chapter.title))) pages.push({ title: chapter.title, body: found.body });
  }
  return { v: 1, kind: 'book', title, pages, at: Date.now() };
}

// ---- this device's shares -------------------------------------------------------------------------

const KEY = 'glyph-shares';

export interface Kept {
  id: string;
  key: string;
  /** What was sent last, as a digest, so a save that changed nothing in it sends nothing. */
  sent: string;
}

function readKept(): Record<string, Kept> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Kept>) : {};
  } catch {
    return {};
  }
}

function writeKept(kept: Record<string, Kept>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // No storage: the share stays up, and this device forgets it holds it.
  }
  for (const listener of listeners) listener();
}

const listeners = new Set<() => void>();

/** Told whenever this device starts or stops sharing a note. */
export function onShares(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The link for a note this device shares, or null. */
export function linkFor(noteId: string): string | null {
  const kept = readKept()[noteId];
  return kept ? shareLink(kept.id, kept.key) : null;
}

/** A short digest of what a share holds, pages only: when it was written does not make it different. */
function digest(shared: Shared): string {
  const text = JSON.stringify([shared.kind, shared.title, shared.pages]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

function token(): string {
  const session = accountState().session;
  if (!session) throw new Error('Sign in under Settings > Account to share: a share is kept with your account.');
  return session.token;
}

/** Shares `note` (and, for a book, its chapters among `notes`), or writes its share again; answers the link. */
export async function shareNote(note: Note, notes: readonly Note[]): Promise<string> {
  const auth = token();
  const all = readKept();
  const kept = all[note.id] ?? { id: newShareId(), key: newShareKey(), sent: '' };
  const shared = sharedOf(note, notes);
  await call('PUT', `shares/${kept.id}`, { token: auth, body: { blob: await sealShare(shared, kept.key) } });
  all[note.id] = { ...kept, sent: digest(shared) };
  writeKept(all);
  return shareLink(kept.id, kept.key);
}

/** Stops sharing `noteId`: the share is taken down and its link reads nothing from then on. */
export async function stopSharing(noteId: string): Promise<void> {
  const all = readKept();
  const kept = all[noteId];
  if (!kept) return;
  await call('DELETE', `shares/${kept.id}`, { token: token() });
  delete all[noteId];
  writeKept(all);
}

/** Writes again every share whose note, or whose book's chapters, changed since it was last sent. */
export async function refreshShares(): Promise<number> {
  const all = readKept();
  const ids = Object.keys(all);
  if (!ids.length || !accountState().session) return 0;
  const notes = await listNotes();
  let sent = 0;
  for (const id of ids) {
    const note = notes.find((n) => n.id === id);
    const kept = all[id];
    if (!note || !kept) continue;
    const shared = sharedOf(note, notes);
    if (digest(shared) === kept.sent) continue;
    try {
      await call('PUT', `shares/${kept.id}`, { token: token(), body: { blob: await sealShare(shared, kept.key) } });
      all[id] = { ...kept, sent: digest(shared) };
      sent += 1;
    } catch {
      // Offline, or signed out: the next save tries again.
    }
  }
  if (sent) writeKept(all);
  return sent;
}

/** After a save, the shares follow: a few seconds' quiet, then every share that changed is written again. */
const FOLLOW_MS = 3000;
let following = false;

export function followShares(): void {
  if (following || typeof window === 'undefined') return;
  following = true;
  let timer = 0;
  window.addEventListener(NOTE_SAVED, () => {
    if (!Object.keys(readKept()).length) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refreshShares(), FOLLOW_MS);
  });
}

// ---- reading and forking ----------------------------------------------------------------------------

/** What a link shares, read and opened: anyone with the link can, with no account. */
export async function readShared(link: string, fetcher: typeof fetch = fetch): Promise<Shared> {
  const found = readShareLink(link);
  if (!found) throw new Error('That is not a Ghost.md share link.');
  const answer = await call<{ blob: string }>('GET', `shares/${found.id}`, { fetcher });
  return openShare(answer.blob, found.key);
}

/** A page's body under a new title: its front matter's title if it has one, else its first heading. */
function retitled(body: string, from: string, to: string): string {
  if (frontMatterValue(body, 'title') !== null) return withFrontMatterTitle(body, to);
  const lines = body.split('\n');
  const at = lines.findIndex((line) => /^#\s/.test(line));
  if (at >= 0 && sameTitle(lines[at]!.replace(/^#\s+/, ''), from)) lines[at] = `# ${to}`;
  else lines.unshift(`# ${to}`, '');
  return lines.join('\n');
}

/**
 * Saves a copy of what was shared into this library, as the reader's own notes: a note, or a book with its chapters.
 * A page whose title a note here already has is saved as "Title (shared)", and a book's index points at the copies,
 * so a fork never mixes with what the reader already wrote. Answers the note to open: the note, or the book.
 */
export async function forkShared(
  shared: Shared,
  deps: { notes: () => Promise<Note[]>; save: (body: string) => Promise<Note> } = {
    notes: listNotes,
    save: (body) => createNote(newNoteId(), body, 'editor'),
  },
): Promise<Note> {
  const have = (await deps.notes()).map((n) => noteTitle(n.body));
  const taken = (t: string) => have.some((h) => sameTitle(h, t));
  const names = new Map<string, string>();
  for (const page of shared.pages) {
    let name = page.title;
    for (let n = 1; taken(name) || [...names.values()].some((v) => sameTitle(v, name)); n++) name = n === 1 ? `${page.title} (shared)` : `${page.title} (shared ${n})`;
    names.set(page.title, name);
  }
  let first: Note | null = null;
  for (const [i, page] of shared.pages.entries()) {
    let body = page.body;
    const name = names.get(page.title)!;
    if (name !== page.title) body = retitled(body, page.title, name);
    // The book's index points at the copies it was saved with.
    if (shared.kind === 'book' && i === 0) {
      for (const [from, to] of names) if (from !== to && from !== page.title) body = body.split(`[[${from}]]`).join(`[[${to}]]`);
    }
    const saved = await deps.save(body);
    first ??= saved;
  }
  if (!first) throw new Error('That share holds nothing to save.');
  return first;
}

/** A file name from a title: what a file system takes, never empty. */
function fileName(title: string): string {
  return title.replace(/[\\/:*?"<>|\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
}

/** What was shared, as files for any Markdown app: one `.md` for a note, a `.zip` of every page for a book. */
export function sharedAsFile(shared: Shared): { name: string; blob: Blob } {
  if (shared.kind === 'note' || shared.pages.length === 1) {
    const page = shared.pages[0]!;
    return { name: `${fileName(page.title)}.md`, blob: new Blob([page.body], { type: 'text/markdown' }) };
  }
  const encoder = new TextEncoder();
  const files = shared.pages.map((page) => ({ name: `${fileName(page.title)}.md`, bytes: encoder.encode(page.body) }));
  return { name: `${fileName(shared.title)}.zip`, blob: new Blob([zipFiles(files)], { type: 'application/zip' }) };
}
