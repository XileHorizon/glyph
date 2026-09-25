import { useEffect, useMemo, useState } from 'react';
import { generate, listModels } from '../core/ai.ts';
import { preferences } from '../core/preferences.ts';
import type { Note } from '../core/store.ts';
import { isTauri } from '../core/tauri.ts';
import { bodyHash } from './formatter.ts';
import { protectLinks } from './links.ts';
import { isRunning, passesFor } from './pipeline.ts';
import { GIST_PROMPT, TEMPERATURE } from './prompt.ts';
import { keepGist, readGist } from './results.ts';

/**
 * The gist: one quiet line under each note's title on the home page, what the
 * note is about, written on the phone in the background.
 *
 * Matt's board: "live on-device AI summaries on the home list". The page hands
 * this the notes it has cards for (`useGists`); a runner works through the
 * ones with no gist, or a gist written from an older body, one at a time,
 * newest first, only while the app is on screen, and only with a model on the
 * phone - the smallest, since a line of twelve words wants speed, not care.
 * Each gist is kept with the hash of the body it came from (results.ts), so a
 * note that has not changed is never asked about twice, and a note that has
 * shows its old line until the new one lands. A note the runner could not gist
 * is left alone for the rest of the session. Nothing leaves the phone.
 */

/** The model's answer as a card's line: the first line, bare, at most this long. */
const LONGEST = 90;

export function tidyGist(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^```/.test(l)) ?? '';
  let out = line
    .replace(/^(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+|>\s*)+/, '')
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?:;,]+$/, '')
    .trim();
  if (out.length > LONGEST) {
    const cut = out.slice(0, LONGEST);
    out = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), LONGEST - 20)).trimEnd()}…`;
  }
  return out;
}

// ---- the runner ----------------------------------------------------------------------------

/** The bodies the home page has cards for, by note id: what the runner works from. */
const bodies = new Map<string, string>();
const hashes = new Map<string, { body: string; hash: number }>();
const listeners = new Set<() => void>();
const failed = new Set<string>();
let active: string | null = null;
let timer = 0;

function hashOf(id: string, body: string): number {
  const known = hashes.get(id);
  if (known && known.body === body) return known.hash;
  const hash = bodyHash(body);
  hashes.set(id, { body, hash });
  return hash;
}

/** The body's first line, the part a gist would change with. */
const headOf = (body: string) => body.split('\n').find((l) => l.trim())?.trim() ?? '';

/**
 * Whether the kept gist still stands for `body`: the same body, or one that
 * changed in a small way - a fixed typo, a word - rather than a meaningful
 * one (Matt's card: "re-summarize after meaningful changes"). Meaningful is
 * the first line changing, or the length moving by a twentieth and at least
 * twenty characters. A stale-but-close gist is shown and not asked for again.
 */
export function gistStands(kept: { for: number; len?: number; head?: string } | null, id: string, body: string): boolean {
  if (!kept) return false;
  if (kept.for === hashOf(id, body)) return true;
  if (kept.len === undefined || kept.head === undefined) return false;
  if (kept.head !== headOf(body)) return false;
  return Math.abs(body.length - kept.len) < Math.max(20, kept.len * 0.05);
}

/** The kept gist for a note, when it still stands for the body the note has now. */
export function gistFor(id: string, body: string): string | null {
  const kept = readGist(id);
  return kept?.text && gistStands(kept, id, body) ? kept.text : null;
}

function owed(): [string, string] | null {
  for (const [id, body] of bodies) {
    if (!body.trim() || failed.has(id) || gistFor(id, body) || isRunning(id)) continue;
    return [id, body];
  }
  return null;
}

/** One turn of the runner: the next note owed a gist, if the app is on screen. Exported for its test. */
export async function runGists(): Promise<void> {
  return pump();
}

async function pump(): Promise<void> {
  if (active || !isTauri() || document.visibilityState !== 'visible') return;
  const next = owed();
  if (!next) return;
  const [id, body] = next;
  active = id;
  try {
    const present = (await listModels()).filter((m) => m.present).map((m) => m.id);
    const model = passesFor(present, preferences().formatModel)[0];
    if (!model) return;
    // Links go in as tokens, as for every pass, and the line never has them.
    const { text } = protectLinks(body);
    const output = await generate({ model, system: GIST_PROMPT, prompt: text, maxTokens: 40, temperature: TEMPERATURE, onProgress: () => undefined }).done;
    const line = tidyGist(output.text);
    if (line) keepGist(id, { text: line, for: hashOf(id, body), model, len: body.length, head: headOf(body) });
    else failed.add(id);
    listeners.forEach((listener) => listener());
  } catch (failure) {
    console.warn('[glyph] the gist did not come:', failure);
    failed.add(id);
  } finally {
    active = null;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void pump(), 800);
  }
}

function kick(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void pump(), 1500);
}

/**
 * The gists for the notes the home page shows, by id, and the work to have
 * them: the runner starts when a note has none and the app is on screen.
 */
export function useGists(notes: readonly Note[]): Record<string, string> {
  const [, bump] = useState(0);

  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      listeners.delete(listener);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    // Newest first: the note just made is the one a person is looking at.
    bodies.clear();
    for (const note of [...notes].sort((a, b) => b.updatedAt - a.updatedAt)) bodies.set(note.id, note.body);
    kick();
  }, [notes]);

  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const note of notes) {
      const gist = gistFor(note.id, note.body);
      if (gist) out[note.id] = gist;
    }
    return out;
    // Re-read after the runner speaks (bump) as well as when the notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, listeners.size, active]);
}
