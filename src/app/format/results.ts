import { getNote, setNoteFormatted } from '../core/store.ts';
import type { Kept } from './formatter.ts';
import type { Mode } from './modes.ts';

/**
 * Where each mode's text is kept, per note.
 *
 * Format's lives with the note in the store (`formatted`, `formatted_for`,
 * `formatted_model` in SQLite on the phone): it is the one the background
 * queue writes after a recording, and the one the list and the settings
 * already know. Summarize and Enhance are asked for by hand and kept here,
 * on the page, under one key, each with the hash of the body it was written
 * from and the model that wrote it - the same three things, so the pipeline
 * and the view treat all three modes alike. Moving them into the store is a
 * native change (a column each, a generation bump); this is what ships over
 * the air today.
 */

const KEY = 'glyph-ai-results';

type Stored = { text: string; for: number; model: string };
/** What is kept here per note: the modes that are not Format's, and the home page's one-line gist. */
type Kind = Exclude<Mode, 'format'> | 'gist';
type Sheet = Record<string, Partial<Record<Kind, Stored>>>;

/**
 * The sheet as last parsed, with the text it came from: the home page reads a gist for every card it draws, and each
 * read was the whole sheet parsed again (measured: 24 parses to show the home page once). A read asks for the text,
 * which cannot be stale, and parses only when it has changed. What it answers is shared: a writer copies it first.
 */
let parsedSheet: { raw: string; sheet: Sheet } | null = null;

function readSheet(): Sheet {
  try {
    const raw = localStorage.getItem(KEY) ?? '{}';
    if (parsedSheet && parsedSheet.raw === raw) return parsedSheet.sheet;
    const value = JSON.parse(raw) as unknown;
    const sheet = value && typeof value === 'object' && !Array.isArray(value) ? (value as Sheet) : {};
    parsedSheet = { raw, sheet };
    return sheet;
  } catch {
    return {};
  }
}

function writeSheet(sheet: Sheet): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sheet));
  } catch {
    // No storage: the text stays on screen for now and is written again next time.
  }
}

/** The kept text for a note in a mode, or null when nothing is kept. */
export async function keptFor(id: string, mode: Mode): Promise<Kept | null> {
  if (mode === 'format') {
    const note = await getNote(id);
    if (!note) return null;
    return { formatted: note.formatted, formattedFor: note.formattedFor, formattedModel: note.formattedModel };
  }
  const stored = readSheet()[id]?.[mode];
  return stored ? { formatted: stored.text, formattedFor: stored.for, formattedModel: stored.model } : null;
}

/** Keep a mode's text for a note: what it was written from, and by what. */
export async function keepResult(id: string, mode: Mode, text: string, hash: number | null, model: string | null): Promise<void> {
  if (mode === 'format') {
    await setNoteFormatted(id, text, hash, model);
    return;
  }
  const sheet = { ...readSheet() };
  const mine = { ...(sheet[id] ?? {}) };
  if (hash === null || model === null) delete mine[mode];
  else mine[mode] = { text, for: hash, model };
  if (Object.keys(mine).length) sheet[id] = mine;
  else delete sheet[id];
  writeSheet(sheet);
}

/** The home page's gist: its line, the body it came from as a hash, its length and its first line, and the model. */
export interface Gist {
  text: string;
  for: number;
  model: string;
  /** The body's length and first line when the gist was written: what "a meaningful change" is measured against. */
  len?: number;
  head?: string;
}

export function readGist(id: string): Gist | null {
  return (readSheet()[id]?.gist as Gist | undefined) ?? null;
}

export function keepGist(id: string, gist: Gist): void {
  const sheet = { ...readSheet() };
  sheet[id] = { ...(sheet[id] ?? {}), gist };
  writeSheet(sheet);
}

/** A note is gone: so are its summary, its enhanced text and its gist. */
export function forgetResults(id: string): void {
  const sheet = { ...readSheet() };
  if (!(id in sheet)) return;
  delete sheet[id];
  writeSheet(sheet);
}
