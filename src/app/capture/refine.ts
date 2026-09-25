import { useSyncExternalStore } from 'react';
import { preferences } from '../core/preferences.ts';
import { getNote, setNoteRecording, updateNote } from '../core/store.ts';
import { invoke, isTauri } from '../core/tauri.ts';
import { findKeyword } from './command.ts';
import { appendBody } from './appendBody.ts';
import { renderNote, type Segment } from './markdown.ts';

/**
 * Better words after the recording: the post-pass.
 *
 * The live transcript comes from a small, fast model so the words keep up with
 * speech. A larger one makes about half as many mistakes but cannot keep up,
 * so it runs afterwards, in the background, over the recording the capture
 * kept (native generation 7): one pass per take, then the note's words are
 * replaced with the better ones - only if the note still reads exactly as Done
 * saved it, because an edit in between is the person's and wins.
 *
 * The queue lives in localStorage, so a pass the phone did not get to (the
 * app was closed, the recorder was opened again) runs on the next launch. One
 * pass at a time, never while the recorder is on screen: both models want the
 * same cores. The first pass downloads the larger model (190 MB); until it is
 * there, notes simply keep their live words.
 */

export interface RefineJob {
  /** The note. */
  id: string;
  /** Where this take starts on the recording's timeline. */
  fromMs: number;
  /** The recording's whole length after this take. */
  recordingMs: number;
  /** The note's text before this take: empty for a new note. */
  baseBody: string;
  /** What Done saved: the text that must still stand for the words to be replaced. */
  savedBody: string;
  /** Whether the take is the note's first, and so may take a title. */
  titled: boolean;
  /** The phrases before this take, already on the recording's timeline. */
  priorSegments: Segment[];
  /** The tail of the text before the take, so the model continues its casing. */
  promptTail: string;
  /**
   * Stretches of the recording that were commands ("Glyph, add buy milk to
   * HelloTrade", and the yes after it), on the recording's timeline: the better
   * words leave them out, as the live words did. Absent on jobs from before.
   */
  skip?: Array<{ startMs: number; endMs: number }>;
  /**
   * The voice memos this take left (core/clips.ts), each already written as its mark, on the recording's timeline:
   * the better words never heard them - their stretches are in `skip` - so they are put back where they were.
   */
  clips?: Segment[];
  /** Phrases that were words and then "Glyph": the better words keep what came before the keyword. */
  keywordAt?: Array<{ startMs: number; endMs: number }>;
  tries: number;
}

/** The binary generation that has `capture_refine`. */
const REFINE_GENERATION = 7;
const QUEUE_KEY = 'glyph-refine-queue';
const MAX_TRIES = 3;
/** How long to wait before trying again after "busy" or a failure. */
const RETRY_MS = 20_000;

// ---- the queue -------------------------------------------------------------------------

function readQueue(): RefineJob[] {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? (value as RefineJob[]).filter((j) => j && typeof j.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeQueue(jobs: RefineJob[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(jobs));
  } catch {
    // No storage: the job runs now or not at all.
  }
}

// ---- what the screen sees ---------------------------------------------------------------

export interface RefineState {
  /** Notes whose better words are being worked out right now, or waiting their turn. */
  pending: ReadonlySet<string>;
  /** The larger model's download, while one is under way. */
  download: { received: number; total: number } | null;
}

let state: RefineState = { pending: new Set(), download: null };
const listeners = new Set<() => void>();
function publish(next: Partial<RefineState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
function syncPending(): void {
  publish({ pending: new Set(readQueue().map((j) => j.id)) });
}

export function useRefining(): RefineState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

// ---- the pure part -----------------------------------------------------------------------

/**
 * The note as it should read with the take's better phrases in place of the
 * live ones: the text before the take, then the take rendered again from the
 * new phrases - the first take titled, a later one not, as the recorder did.
 */
export function refinedBody(job: RefineJob, refined: readonly Segment[]): string {
  const take = renderNote(withClips(job, withoutCommands(job, refined)), '', { titled: job.titled }).markdown;
  return appendBody(job.baseBody, take);
}

/** The better phrases with this take's voice memos back among them, in the order they were spoken. */
export function withClips(job: Pick<RefineJob, 'clips'>, refined: readonly Segment[]): Segment[] {
  const clips = job.clips ?? [];
  if (!clips.length) return [...refined];
  return [...refined, ...clips].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** The recording's phrases with the take's replaced by the better ones. */
export function refinedSegments(job: RefineJob, refined: readonly Segment[]): Segment[] {
  return [...job.priorSegments.filter((s) => s.endMs <= job.fromMs), ...withClips(job, withoutCommands(job, refined))];
}

/** How much of `segment` the spans cover, 0 to 1. */
function covered(segment: Segment, spans: readonly { startMs: number; endMs: number }[]): number {
  const length = Math.max(1, segment.endMs - segment.startMs);
  const overlap = spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.endMs, segment.endMs) - Math.max(span.startMs, segment.startMs)), 0);
  return overlap / length;
}

/**
 * The better phrases with the take's commands taken out: a phrase mostly
 * inside a command's stretch goes, and one that overlaps a phrase the live
 * words cut at "Glyph" is cut there too. The larger model hears the phrases
 * at slightly different times, so it is by overlap, not by match.
 */
export function withoutCommands(job: Pick<RefineJob, 'skip' | 'keywordAt'>, refined: readonly Segment[]): Segment[] {
  const skip = job.skip ?? [];
  const keywordAt = job.keywordAt ?? [];
  return refined.flatMap((segment) => {
    if (skip.length && covered(segment, skip) >= 0.5) return [];
    if (keywordAt.length && covered(segment, keywordAt) > 0) {
      const found = findKeyword(segment.text);
      if (found) return found.before ? [{ ...segment, text: found.before }] : [];
    }
    return [segment];
  });
}

// ---- running -------------------------------------------------------------------------------

let recorderLive = false;
let running = false;
let timer = 0;
let onChanged: (() => void) | null = null;
let generation: number | null = null;

/** Ask for a pass over a finished take. Runs when the recorder has gone and the phone is free. */
export function enqueueRefine(job: Omit<RefineJob, 'tries'>): void {
  if (!isTauri() || !preferences().refine) return;
  const queue = readQueue().filter((j) => j.id !== job.id || j.fromMs !== job.fromMs);
  queue.push({ ...job, tries: 0 });
  writeQueue(queue);
  syncPending();
  kick();
}

/** The recorder is on screen (or not): no pass runs while it is. */
export function setRecorderLive(live: boolean): void {
  recorderLive = live;
  if (!live) kick(1500);
}

/** Wire the runner to the app: called once, with what to do when a note's words changed. */
export function startRefining(changed: () => void): () => void {
  onChanged = changed;
  syncPending();
  const onVisible = () => {
    if (document.visibilityState === 'visible') kick(2000);
  };
  document.addEventListener('visibilitychange', onVisible);
  kick(4000);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.clearTimeout(timer);
    onChanged = null;
  };
}

function kick(delay = 0): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runNext(), delay);
}

async function canRefine(): Promise<boolean> {
  if (!isTauri() || !preferences().refine) return false;
  generation ??= await invoke<{ nativeGeneration?: number }>('ota_status').then(
    (status) => status.nativeGeneration ?? 0,
    () => 0,
  );
  return generation >= REFINE_GENERATION;
}

interface ModelStatus {
  present: boolean;
  bytes: number;
}

/** The larger model, downloaded on first use with its progress shown. */
async function ensureRefineModel(): Promise<boolean> {
  const status = await invoke<ModelStatus>('capture_refine_model_status').catch(() => null);
  if (!status) return false;
  if (status.present) return true;
  // Local only: the better words wait until the model is on the phone.
  if (preferences().localOnly) return false;
  const { listen } = await import('@tauri-apps/api/event');
  publish({ download: { received: 0, total: status.bytes } });
  const unlisten = await listen<{ receivedBytes: number; totalBytes: number }>('capture://refine-model-progress', (event) =>
    publish({ download: { received: event.payload.receivedBytes, total: event.payload.totalBytes } }),
  );
  try {
    const fetched = await invoke<ModelStatus>('capture_fetch_refine_model');
    return fetched.present;
  } catch (error) {
    console.warn('[glyph] the larger voice model did not download:', error);
    return false;
  } finally {
    unlisten();
    publish({ download: null });
  }
}

async function runNext(): Promise<void> {
  if (running || recorderLive) return;
  const queue = readQueue();
  const job = queue[0];
  if (!job) return;
  if (!(await canRefine())) return;
  running = true;
  try {
    if (!(await ensureRefineModel())) {
      kick(RETRY_MS * 3);
      return;
    }
    const refined = await invoke<Segment[]>('capture_refine', { id: job.id, fromMs: job.fromMs, promptTail: job.promptTail });
    await apply(job, refined);
    finish(job);
    onChanged?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/busy|cancelled/i.test(message)) {
      kick(RETRY_MS);
    } else {
      console.warn('[glyph] the better words did not come:', message);
      if (job.tries + 1 >= MAX_TRIES) finish(job);
      else {
        writeQueue(readQueue().map((j) => (j.id === job.id && j.fromMs === job.fromMs ? { ...j, tries: j.tries + 1 } : j)));
        kick(RETRY_MS);
      }
    }
  } finally {
    running = false;
    if (readQueue().length) kick(500);
  }
}

/** The better words go in only if the note still reads as Done left it; the better phrases go in either way. */
async function apply(job: RefineJob, refined: Segment[]): Promise<void> {
  if (!refined.length) return;
  const note = await getNote(job.id);
  if (!note) return;
  if (note.body === job.savedBody) await updateNote(job.id, refinedBody(job, refined), note.revision ?? 1).catch(() => null);
  await setNoteRecording(job.id, job.recordingMs, refinedSegments(job, refined)).catch(() => null);
}

function finish(job: RefineJob): void {
  writeQueue(readQueue().filter((j) => !(j.id === job.id && j.fromMs === job.fromMs)));
  syncPending();
}

// ---- listening again for a review ---------------------------------------------------------

/**
 * The review after a recording (review/) runs this take's pass itself, now,
 * and shows its progress instead of letting the queue do it later: the
 * careful words are what the fast ones are checked against. Answers the
 * better phrases, commands included (the review compares like with like), or
 * null when this phone cannot listen again: an old binary, better words
 * switched off, or the larger model not there and not fetched.
 */
export async function listenAgain(job: Omit<RefineJob, 'tries'>, onPercent: (percent: number) => void): Promise<Segment[] | null> {
  if (!(await canRefine())) return null;
  if (!(await ensureRefineModel())) return null;
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<{ id: string; percent: number }>('capture://refine-progress', (event) => {
    if (event.payload.id === job.id) onPercent(event.payload.percent);
  });
  try {
    return await invoke<Segment[]>('capture_refine', { id: job.id, fromMs: job.fromMs, promptTail: job.promptTail });
  } finally {
    unlisten();
  }
}

/** The recording's phrases after a review: the better ones, commands left out, for the tape's transcript. */
export async function keepBetterPhrases(job: Omit<RefineJob, 'tries'>, refined: readonly Segment[]): Promise<void> {
  await setNoteRecording(job.id, job.recordingMs, refinedSegments({ ...job, tries: 0 }, refined)).catch(() => null);
}

/** No queued pass runs while a review is on screen: the review's own pass and its model want the cores. */
export function holdRefining(on: boolean): void {
  setRecorderLive(on);
}
