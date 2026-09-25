import { useCallback, useEffect, useRef, useState } from 'react';
import { preferences } from '../core/preferences.ts';
import type { Hardware, Phase } from '../core/ai.ts';
import type { Mode } from './modes.ts';
import { APPLIED, cancelRun, EDITED, noteHash, passesFor, revisionPasses, runningFor, runPipeline, subscribe, type PipelineProgress } from './pipeline.ts';
import { keepResult, keptFor } from './results.ts';

/**
 * One note's text in one mode - formatted, summarized or enhanced - as the
 * screen sees it: the draft arriving, the revision under way, the kept
 * text, and whether the note has moved on.
 *
 * The running is the pipeline's (format/pipeline.ts) and outlives this hook:
 * a run started here keeps going when the note is left, and one started by
 * the background queue is picked up when the note is opened. This hook only
 * watches, and asks for passes. Changing the mode starts it over on the
 * other mode's kept text; a run in another mode goes on unseen and is found
 * again when that mode is shown.
 *
 * The text is saved with a hash of the exact body it was written from
 * (`formattedFor`), not the body's time: the editor saves on a debounce, so
 * "the time the body last changed" and "the body the model read" can name
 * different texts inside the same second. A hash of the text itself cannot.
 */

/** A revision running behind a draft that is already on screen. */
export interface Revising {
  model: string;
  pass: number;
  passes: number;
  phase: Phase;
  tokensPerSecond: number;
  elapsedMs: number;
}

export type FormatState =
  | { kind: 'none' }
  | {
      kind: 'running';
      phase: Phase;
      text: string;
      model: string;
      pass: number;
      passes: number;
      promptTokens: number;
      promptTokensDone: number;
      outputTokens: number;
      tokensPerSecond: number;
      elapsedMs: number;
      hardware: Hardware | null;
    }
  | { kind: 'done'; text: string; model: string; ms: number | null; truncated: boolean; revising: Revising | null }
  | { kind: 'stopped'; text: string }
  | { kind: 'failed'; message: string; text: string };

export interface Kept {
  formatted?: string | null;
  formattedFor?: number | null;
  formattedModel?: string | null;
}

/**
 * FNV-1a over the UTF-16 code units, folded to 52 bits so it survives JSON and
 * an i64 column unchanged. Not cryptographic: it only has to tell two texts
 * apart, and a collision costs one missing "changed since" hint.
 */
export function bodyHash(text: string): number {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return Number(hash & 0xfffffffffffffn);
}

export interface Formatter {
  state: FormatState;
  mode: Mode;
  /** Whether the kept text has been looked up yet; nothing starts before it has. */
  ready: boolean;
  /** Whether the kept text was written from something other than `body`. */
  stale: (body: string) => boolean;
  /** The passes `body` still needs, given the models on the phone: none means nothing to do. */
  owed: (body: string, present: readonly string[]) => string[];
  /** Runs the passes `body` needs, or all of them again when `all`. */
  start: (body: string, present: readonly string[], all?: boolean) => void;
  stop: () => void;
  /**
   * Keeps the person's own edit of the text, in place of the model's: it
   * stands for the same body (`body` is the note now, for when nothing was
   * kept yet), and no pass revises it until the note changes.
   */
  keep: (text: string, body: string) => void;
  /**
   * The text has been put into the note (the screen does that part: in place
   * of the note, or above or below it), and `body` is the note now. The text
   * is kept against that body's hash, marked applied so nothing formats it
   * again. Answers the undo, which keeps it as it was before.
   */
  apply: (text: string, body: string) => () => void;
  /** The model chosen in Settings, the last pass. */
  model: string;
  noteId: string;
}

function running(progress: PipelineProgress): FormatState {
  return {
    kind: 'running',
    phase: progress.phase,
    text: progress.text,
    model: progress.model,
    pass: progress.pass,
    passes: progress.passes,
    promptTokens: progress.promptTokens,
    promptTokensDone: progress.promptTokensDone,
    outputTokens: progress.outputTokens,
    tokensPerSecond: progress.tokensPerSecond,
    elapsedMs: progress.elapsedMs,
    hardware: progress.hardware ?? null,
  };
}

function revising(progress: PipelineProgress): Revising {
  return { model: progress.model, pass: progress.pass, passes: progress.passes, phase: progress.phase, tokensPerSecond: progress.tokensPerSecond, elapsedMs: progress.elapsedMs };
}

export function useFormatter(noteId: string, mode: Mode): Formatter {
  const [state, setState] = useState<FormatState>({ kind: 'none' });
  const [ready, setReady] = useState(false);
  const madeFrom = useRef<number | null>(null);
  const keptModel = useRef<string | null>(null);

  // The kept text for this note in this mode, looked up once per mode and
  // adopted only while nothing else has happened, so it can never overwrite
  // a run. A run already going for this mode is picked up the same way.
  useEffect(() => {
    let alive = true;
    madeFrom.current = null;
    keptModel.current = null;
    setReady(false);
    const already = runningFor(noteId);
    setState(already && already.mode === mode ? running(already) : { kind: 'none' });
    void keptFor(noteId, mode).then((kept) => {
      if (!alive) return;
      if (kept?.formatted) {
        madeFrom.current = kept.formattedFor ?? null;
        keptModel.current = kept.formattedModel ?? null;
        setState((previous) =>
          previous.kind === 'none' ? { kind: 'done', text: kept.formatted ?? '', model: kept.formattedModel ?? '', ms: null, truncated: false, revising: null } : previous,
        );
      }
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [noteId, mode]);

  // The pipeline's word, for this note in this mode: a draft streaming, a
  // revision's pace, a pass landing, the run ending.
  useEffect(() => {
    return subscribe((event) => {
      if (event.kind === 'progress') {
        const { progress } = event;
        if (progress.id !== noteId || progress.mode !== mode) return;
        setState((previous) => {
          // A revision keeps the landed draft on screen and reports its pace.
          if (progress.pass > 1 && previous.kind === 'done') return { ...previous, revising: revising(progress) };
          return running(progress);
        });
      } else if (event.kind === 'landed') {
        const { landed } = event;
        if (landed.id !== noteId || landed.mode !== mode) return;
        madeFrom.current = landed.hash;
        keptModel.current = landed.model;
        setState({
          kind: 'done',
          text: landed.text,
          model: landed.model,
          ms: landed.ms,
          truncated: landed.truncated,
          revising: landed.next ? { model: landed.next, pass: 0, passes: 0, phase: 'loading', tokensPerSecond: 0, elapsedMs: 0 } : null,
        });
      } else if (event.id === noteId && event.mode === mode) {
        const { reason, message } = event;
        setState((previous) => {
          if (previous.kind === 'done') return { ...previous, revising: null };
          const text = previous.kind === 'running' ? previous.text : '';
          if (reason === 'done') return previous;
          if (reason === 'stopped') return { kind: 'stopped', text };
          return { kind: 'failed', message: message ?? 'The model stopped.', text };
        });
      }
    });
  }, [noteId, mode]);

  // What is kept, as the pipeline's rules want it: the hash and the model,
  // the text itself not needed for the decision.
  const keptNow = useCallback(
    (): Kept | null => (madeFrom.current === null ? null : { formatted: 'kept', formattedFor: madeFrom.current, formattedModel: keptModel.current }),
    [],
  );

  const owed = useCallback(
    (body: string, present: readonly string[]) => revisionPasses(keptNow(), noteHash(noteId, body), passesFor(present, preferences().formatModel)),
    [noteId, keptNow],
  );

  const start = useCallback(
    (body: string, present: readonly string[], all = false) => {
      // Nothing to write from: a model given an empty note invents one.
      if (!body.trim()) return;
      const passes = passesFor(present, preferences().formatModel);
      const wanted = all ? passes : revisionPasses(keptNow(), noteHash(noteId, body), passes);
      if (!wanted.length) return;
      // A run already going ends first: the pipeline would otherwise answer
      // with it instead of starting the new one.
      void cancelRun(noteId).then(() => runPipeline(noteId, body, wanted, mode));
    },
    [noteId, mode, keptNow],
  );

  const stop = useCallback(() => void cancelRun(noteId), [noteId]);

  const stale = useCallback((body: string) => madeFrom.current !== null && madeFrom.current !== noteHash(noteId, body), [noteId]);

  const keep = useCallback(
    (text: string, body: string) => {
      const hash = madeFrom.current ?? noteHash(noteId, body);
      madeFrom.current = hash;
      keptModel.current = EDITED;
      setState({ kind: 'done', text, model: EDITED, ms: null, truncated: false, revising: null });
      void keepResult(noteId, mode, text, hash, EDITED).catch((failure: unknown) => console.warn('[glyph] edit not kept:', failure));
    },
    [noteId, mode],
  );

  const apply = useCallback(
    (text: string, body: string) => {
      const before = { hash: madeFrom.current, model: keptModel.current };
      const settle = (hash: number | null, model: string | null) => {
        madeFrom.current = hash;
        keptModel.current = model;
        setState({ kind: 'done', text, model: model ?? '', ms: null, truncated: false, revising: null });
        void keepResult(noteId, mode, text, hash, model).catch((failure: unknown) => console.warn('[glyph] result not kept:', failure));
      };
      settle(noteHash(noteId, body), APPLIED);
      return () => settle(before.hash, before.model);
    },
    [noteId, mode],
  );

  return { state, mode, ready, stale, owed, start, stop, keep, apply, model: preferences().formatModel, noteId };
}

/**
 * What a model still gets wrong at the edges: a code fence around the whole
 * note, and blank lines at either end. The words are left alone.
 */
export function tidy(text: string): string {
  let out = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(out);
  if (fenced?.[1]) out = fenced[1].trim();
  return `${out}\n`;
}
