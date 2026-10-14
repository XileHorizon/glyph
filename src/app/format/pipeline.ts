import { generate, MODELS, type Hardware, type Phase, type Run } from '../core/ai.ts';
import { pluginContextFor, pluginContextVersion } from '../plugins/registry.ts';
import { cleanNote, cleanRewrite } from './clean.ts';
import { bodyHash, tidy, type Kept } from './formatter.ts';
import { protectLinks, restoreLinks } from './links.ts';
import type { Mode } from './modes.ts';
import { budgetFor, promptFor, TEMPERATURE } from './prompt.ts';
import { keepResult } from './results.ts';
import { protectTables, restoreTables } from './tables.ts';

/**
 * Formatting in passes: a quick draft, then revisions by slower models.
 *
 * Matt, after a spoken note came out rough: "the quick format wasn't really
 * fast, maybe the quick format needs to reformat a few times with slower
 * models to make revisions". So a note is formatted the way whisper already
 * transcribes it - a small model first, a bigger one after - and the passes
 * are the models on the phone from the smallest up to the one chosen in
 * Settings. Each pass writes from the note itself (not from the draft, which
 * would anchor a careful model to a careless one) and is saved as it lands,
 * so a killed app keeps the best it had, and a note opened after a draft has
 * landed shows the draft while the revision is still being written.
 *
 * One run per note at a time, shared by whoever asked - the Formatted view or
 * the background queue - and watched through `subscribe`: the view draws the
 * draft as it streams and the revision's progress line, the queue only waits
 * for the end. Everything here is module state on purpose: a run outlives the
 * screen that started it, the way the whisper post-pass does.
 */

export interface PipelineProgress {
  id: string;
  mode: Mode;
  /** Which pass is running, from 1, of how many. */
  pass: number;
  passes: number;
  model: string;
  phase: Phase;
  /** The pass's own text so far; empty while a revision runs (the draft is on screen). */
  text: string;
  promptTokens: number;
  promptTokensDone: number;
  outputTokens: number;
  tokensPerSecond: number;
  elapsedMs: number;
  /** The phone under the model, from a binary that reports it. */
  hardware?: Hardware | null;
}

export interface PassLanded {
  id: string;
  mode: Mode;
  text: string;
  model: string;
  /** The page's hash of the body the pass was written from. */
  hash: number;
  ms: number;
  truncated: boolean;
  /** The model of the pass that follows, or null when this was the last. */
  next: string | null;
}

export type PipelineEvent = { kind: 'progress'; progress: PipelineProgress } | { kind: 'landed'; landed: PassLanded } | { kind: 'ended'; id: string; mode: Mode; reason: 'done' | 'stopped' | 'failed'; message?: string };

type Listener = (event: PipelineEvent) => void;

const listeners = new Set<Listener>();
const runs = new Map<string, { cancel: () => void; progress: PipelineProgress | null; done: Promise<void> }>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(event: PipelineEvent): void {
  listeners.forEach((l) => l(event));
}

/** The run in progress for a note, if any. */
export function runningFor(id: string): PipelineProgress | null {
  return runs.get(id)?.progress ?? null;
}

export function isRunning(id: string): boolean {
  return runs.has(id);
}

/** Stops a note's run, if any; resolves once it has ended, so a new one can start. */
export function cancelRun(id: string): Promise<void> {
  const run = runs.get(id);
  if (!run) return Promise.resolve();
  run.cancel();
  return run.done;
}

/**
 * The "model" of a formatted text the person has edited by hand. It sorts
 * above every real model, so no pass revises it: their words stand until the
 * note itself changes, and Redo is the way to ask for the model's again.
 */
export const EDITED = 'edited';

/**
 * The "model" of a formatted text that has been applied to the note: the
 * note's body is now this text, so formatting it again would only chew it
 * over. It sorts above every model, like an edit.
 */
export const APPLIED = 'applied';

/** Bytes of a model, for ordering; a person's edit, an applied text and an unknown id sort last. */
function sizeOf(id: string): number {
  if (id === EDITED || id === APPLIED) return Number.MAX_SAFE_INTEGER;
  return MODELS.find((m) => m.id === id)?.bytes ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The passes for a note: every model on the phone no bigger than the chosen
 * one, smallest first, so the draft comes quickly and the chosen model has
 * the last word. A chosen model that is not on the phone leaves the passes
 * that are; nothing on the phone is no passes at all.
 */
export function passesFor(present: readonly string[], chosen: string): string[] {
  const ceiling = sizeOf(chosen);
  return [...new Set(present)].filter((id) => sizeOf(id) <= ceiling).sort((a, b) => sizeOf(a) - sizeOf(b));
}

/**
 * What a formatted version was written from: the body, and the version of
 * the context plugins gave with it (plugins/registry.ts: the Projects plugin's
 * briefing), so a note whose project was re-read is formatted again as if it
 * had been edited.
 */
export function noteHash(id: string, body: string): number {
  const version = pluginContextVersion(id);
  return bodyHash(version ? `${body}\u0000project:${version}` : body);
}

/**
 * Whether a note needs formatting, given what it has: nothing kept, kept text
 * from a different body, or a draft by a model smaller than the last pass
 * would use. `hash` is the note's `noteHash` now.
 */
export function needsPasses(kept: Kept | null, hash: number, passes: readonly string[]): boolean {
  const last = passes[passes.length - 1];
  if (!last) return false;
  if (!kept?.formatted || kept.formattedFor !== hash) return true;
  return sizeOf(kept.formattedModel ?? '') < sizeOf(last);
}

/**
 * The passes still owed to a note: all of them when nothing fresh is kept,
 * and only the ones by bigger models when a fresh draft is - so a draft by
 * the 2B is revised by the 4B without the 2B running again.
 */
export function revisionPasses(kept: Kept | null, hash: number, passes: readonly string[]): string[] {
  if (!kept?.formatted || kept.formattedFor !== hash) return [...passes];
  const have = sizeOf(kept.formattedModel ?? '');
  return passes.filter((id) => sizeOf(id) > have);
}

/**
 * Runs the passes for a note, one after another, saving each. A second call
 * for the same note while one runs answers the run already going, whatever
 * its mode: one note, one model at a time. Resolves when the last pass has
 * landed, or the run was stopped, or a pass failed (the passes that landed
 * stay saved).
 */
export function runPipeline(id: string, body: string, passes: readonly string[], mode: Mode = 'format'): Promise<void> {
  const existing = runs.get(id);
  if (existing) return existing.done;
  if (!passes.length) return Promise.resolve();

  let current: Run | null = null;
  let stopped = false;
  const hash = noteHash(id, body);
  // What plugins know about the note (a linked project's briefing) goes in
  // with it, in the system message, so it is part of the snapshotted prefix.
  const context = pluginContextFor(id) ?? undefined;
  // Tables and links go in as tokens the model can copy, and come back out
  // (tables.ts, links.ts): tables first, so a link in a cell is inside the
  // block; and back in reverse. A summary may leave a table out.
  // The note as the model should see it (clean.ts): the hash stays the note's own.
  const { text: withoutTables, tables } = protectTables(cleanNote(body));
  const { text: protectedBody, links } = protectLinks(withoutTables);
  const restore = (text: string, final: boolean) => restoreTables(restoreLinks(text, links, final), tables, final, mode !== 'summarize');
  const entry = { cancel: () => undefined, progress: null as PipelineProgress | null, done: Promise.resolve() };
  entry.cancel = () => {
    stopped = true;
    current?.cancel();
  };

  entry.done = (async () => {
    try {
      for (let index = 0; index < passes.length; index += 1) {
        if (stopped) break;
        const model = passes[index]!;
        const next = passes[index + 1] ?? null;
        const first = index === 0;
        const progressOf = (phase: Phase, text = '', extra: Partial<PipelineProgress> = {}): PipelineProgress => ({
          id,
          mode,
          pass: index + 1,
          passes: passes.length,
          model,
          phase,
          text,
          promptTokens: 0,
          promptTokensDone: 0,
          outputTokens: 0,
          tokensPerSecond: 0,
          elapsedMs: 0,
          ...extra,
        });
        entry.progress = progressOf('loading');
        publish({ kind: 'progress', progress: entry.progress });
        current = generate({
          model,
          system: promptFor(mode),
          context,
          prompt: protectedBody,
          maxTokens: budgetFor(mode, protectedBody.length),
          temperature: TEMPERATURE,
          onProgress: (p) => {
            if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') return;
            // The draft streams; a revision keeps the draft on screen and
            // reports only its pace, so the words do not vanish and regrow.
            entry.progress = progressOf(p.phase, first ? restore(p.partial, false) : '', {
              promptTokens: p.promptTokens,
              promptTokensDone: p.promptTokensDone,
              outputTokens: p.outputTokens,
              tokensPerSecond: p.tokensPerSecond,
              elapsedMs: p.elapsedMs,
              hardware: p.hardware ?? null,
            });
            publish({ kind: 'progress', progress: entry.progress });
          },
        });
        const output = await current.done;
        current = null;
        const text = tidy(cleanRewrite(restore(tidy(output.text), true)));
        await keepResult(id, mode, text, hash, model).catch((failure: unknown) => console.warn('[glyph] result not kept:', failure));
        publish({ kind: 'landed', landed: { id, mode, text, model, hash, ms: output.ms, truncated: output.truncated, next: stopped ? null : next } });
      }
      publish({ kind: 'ended', id, mode, reason: stopped ? 'stopped' : 'done' });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      publish({ kind: 'ended', id, mode, reason: message === 'cancelled' ? 'stopped' : 'failed', message });
    } finally {
      runs.delete(id);
    }
  })();

  runs.set(id, entry);
  return entry.done;
}
