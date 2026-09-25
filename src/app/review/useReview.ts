import { useCallback, useEffect, useRef, useState } from 'react';
import { generate, listModels, modelName, splitThought, type Run } from '../core/ai.ts';
import { preferences } from '../core/preferences.ts';
import { invoke, isTauri } from '../core/tauri.ts';
import { getNote, listNotes, noteTitle, updateNote, type Note } from '../core/store.ts';
import { enqueueRefine, holdRefining, keepBetterPhrases, listenAgain, type RefineJob } from '../capture/refine.ts';
import { renderNote, type Segment } from '../capture/markdown.ts';
import { enqueueFormat, setFormattingPaused } from '../format/queue.ts';
import { pluginContextFor } from '../plugins/registry.ts';
import { wordChanges, type WordChange } from './diff.ts';
import { applyFindings, locate, readFindings, type Finding, type NoteText } from './findings.ts';
import { REVIEW_PROMPT, reviewBudget, reviewMessage } from './prompt.ts';

/**
 * The review after a recording, run: listen again, compare, think, decide.
 *
 * Matt: "show the AI reasoning dissecting and parsing the note after we hit
 * stop, use slower more detailed models to check if the fast model got stuff
 * right and work with the user to resolve and commit". The recording is
 * already saved when this starts, so leaving at any point loses nothing: the
 * note is as the fast pipeline left it, and the better words and formatting
 * that would have run anyway are queued as before.
 *
 * 1. Listening again: the larger speech model over this take (capture/refine.ts).
 * 2. Comparing: where it and the fast model heard different words (diff.ts).
 * 3. Thinking: the formatting model, reasoning on, with everything above,
 *    streaming its thought to the screen (prompt.ts).
 * 4. Deciding: its findings, each checked against the notes (findings.ts),
 *    accepted or not by the person, and committed.
 */

/** The binary generation whose model can think out loud (`ai_generate` `think`). */
export const REVIEW_GENERATION = 13;

let generation: Promise<number> | null = null;

/**
 * `?review` in a browser: the review runs with its models played by a script
 * (listening again turns "seat" into "seek", the thinking streams a canned
 * thought), so the screen can be built and checked without a phone.
 */
function simulating(): boolean {
  return !isTauri() && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('review');
}

/** Whether this binary can run the review: an older one saves as it always did, and never shows it. */
export async function reviewAvailable(): Promise<boolean> {
  if (simulating()) return true;
  if (!isTauri() || !preferences().review) return false;
  generation ??= invoke<{ nativeGeneration?: number }>('ota_status').then(
    (status) => status.nativeGeneration ?? 0,
    () => 0,
  );
  return (await generation) >= REVIEW_GENERATION;
}

/** What the recorder hands over when Stop saves a take (CaptureScreen). */
export interface ReviewHandoff {
  noteId: string;
  /** The better-words pass the queue would have run for this take, or null (no recording kept). */
  job: Omit<RefineJob, 'tries'> | null;
  /** Every phrase the fast model heard, commands and all, in order. */
  heard: string;
  /** What the take's commands did, in words. */
  commands: string[];
  /** Notes other than this one that a command changed. */
  touched: string[];
}

export type StepState = 'waiting' | 'running' | 'done' | 'skipped' | 'failed';

export interface ReviewState {
  title: string;
  listen: { state: StepState; percent: number; detail: string };
  compare: { state: StepState; detail: string; changes: WordChange[] };
  think: { state: StepState; detail: string; thought: string; answering: boolean; tokensPerSecond: number; model: string | null; canShowThought: boolean };
  findings: Finding[] | null;
  /** Which findings the person has accepted, by id. */
  accepted: Set<string>;
  committing: boolean;
}

const INITIAL: ReviewState = {
  title: '',
  listen: { state: 'waiting', percent: 0, detail: '' },
  compare: { state: 'waiting', detail: '', changes: [] },
  think: { state: 'waiting', detail: '', thought: '', answering: false, tokensPerSecond: 0, model: null, canShowThought: true },
  findings: null,
  accepted: new Set(),
  committing: false,
};

/** The model to think with: the one chosen for formatting if it reasons and is here, else the largest Qwen here. */
export async function thinkingModel(): Promise<string | null> {
  const present = (await listModels().catch(() => [])).filter((m) => m.present);
  const chosen = preferences().formatModel;
  if (present.some((m) => m.id === chosen) && chosen.startsWith('qwen')) return chosen;
  const qwen = present.filter((m) => m.id.startsWith('qwen')).sort((a, b) => b.bytes - a.bytes)[0];
  return qwen?.id ?? present.find((m) => m.id === chosen)?.id ?? null;
}

/** Without a model to think, the careful model's words alone: each change the note still has, offered as it heard it. */
function wordsOnly(changes: readonly WordChange[], note: NoteText): Finding[] {
  return changes.flatMap((change, i) => {
    if (!change.heard || !change.careful) return [];
    const find = locate(note.body, change.heard.replace(/[.,;:!?]+$/, ''));
    if (!find) return [];
    return [
      {
        id: `w${i}`,
        check: 'words' as const,
        what: `“${change.careful.replace(/[.,;:!?]+$/, '')}”, not “${find}”`,
        why: 'The slower speech model heard it this way.',
        noteId: note.id,
        noteTitle: note.title,
        change: { kind: 'replace' as const, find, replace: change.careful.replace(/[.,;:!?]+$/, '') },
      },
    ];
  });
}

export function useReview(handoff: ReviewHandoff) {
  const [state, setState] = useState<ReviewState>(INITIAL);
  const patch = useCallback((next: (s: ReviewState) => Partial<ReviewState>) => setState((s) => ({ ...s, ...next(s) })), []);
  const run = useRef<Run | null>(null);
  const refined = useRef<Segment[] | null>(null);
  const listened = useRef(false);
  const notes = useRef<{ self: NoteText; others: NoteText[] } | null>(null);
  const ended = useRef(false);
  const mounts = useRef(0);

  useEffect(() => {
    let alive = true;
    // Counted so a development remount (StrictMode runs effects twice) is not taken for leaving.
    const mount = (mounts.current += 1);
    ended.current = false;
    // While the review is on screen, nothing queued competes for the cores.
    holdRefining(true);
    setFormattingPaused(true);

    void (async () => {
      const note = await getNote(handoff.noteId);
      if (!alive || !note) return;
      const self: NoteText = { id: note.id, title: noteTitle(note.body) || 'This note', body: note.body };
      const others = (await Promise.all(handoff.touched.filter((id) => id !== note.id).map((id) => getNote(id).catch(() => null))))
        .filter((n): n is Note => Boolean(n))
        .map((n) => ({ id: n.id, title: noteTitle(n.body) || 'Untitled', body: n.body }));
      notes.current = { self, others };
      patch(() => ({ title: self.title }));

      // 1. Listening again.
      let careful: string | null = null;
      if (simulating()) {
        patch((s) => ({ listen: { ...s.listen, state: 'running', detail: 'The slower speech model is listening to the recording again' } }));
        for (let percent = 10; percent <= 100 && alive; percent += 15) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          patch((s) => ({ listen: { ...s.listen, percent } }));
        }
        careful = handoff.heard.replace(/\bseat\b/gi, 'seek').replace(/\bhello trade\b/gi, 'HelloTrade');
        patch((s) => ({ listen: { ...s.listen, state: 'done', percent: 100, detail: 'Heard it again with the slower model (simulated)' } }));
      } else if (handoff.job) {
        patch((s) => ({ listen: { ...s.listen, state: 'running', detail: 'The slower speech model is listening to the recording again' } }));
        try {
          const better = await listenAgain(handoff.job, (percent) => alive && patch((s) => ({ listen: { ...s.listen, percent } })));
          if (!alive) return;
          if (better) {
            refined.current = better;
            listened.current = true;
            careful = renderNote(better).plain;
            patch((s) => ({ listen: { ...s.listen, state: 'done', percent: 100, detail: 'Heard it again with the slower model' } }));
          } else {
            patch((s) => ({ listen: { ...s.listen, state: 'skipped', detail: 'The slower speech model isn’t on this phone, so only the words as first heard are checked' } }));
          }
        } catch (failure) {
          if (!alive) return;
          patch((s) => ({ listen: { ...s.listen, state: 'failed', detail: failure instanceof Error ? failure.message : String(failure) } }));
        }
      } else {
        patch((s) => ({ listen: { ...s.listen, state: 'skipped', detail: 'No recording was kept for this take' } }));
      }

      // 2. Comparing.
      const changes = careful !== null ? wordChanges(handoff.heard, careful) : [];
      patch(() => ({
        compare: {
          state: careful !== null ? 'done' : 'skipped',
          changes,
          detail: careful === null ? 'Nothing to compare against' : changes.length ? `${changes.length} ${changes.length === 1 ? 'place' : 'places'} where the two models heard different words` : 'Both models heard the same words',
        },
      }));

      // 3. Thinking.
      const model = simulating() ? 'qwen3.5-4b' : await thinkingModel();
      if (!alive) return;
      if (!model) {
        const findings = wordsOnly(changes, self);
        patch(() => ({
          think: { ...INITIAL.think, state: 'skipped', detail: 'No language model on this phone to think it through. Get one in Settings > Formatting.' },
          findings,
          accepted: new Set(findings.map((f) => f.id)),
        }));
        return;
      }
      const titles = (await listNotes().catch(() => [])).map((n) => noteTitle(n.body)).filter(Boolean);
      const prompt = reviewMessage({ title: self.title, body: self.body, heard: handoff.heard, careful, changes, commands: handoff.commands, titles, touched: others });
      const budget = reviewBudget(model, prompt.length);
      patch(() => ({ think: { ...INITIAL.think, state: 'running', model, detail: `${modelName(model)} is reading the note` } }));
      const started = (simulating() ? simulatedRun : generate)({
        model,
        system: REVIEW_PROMPT,
        context: pluginContextFor(self.id) ?? undefined,
        prompt,
        maxTokens: budget.total,
        temperature: 0.2,
        think: true,
        thinkBudget: budget.think,
        onProgress: (progress) => {
          if (!alive) return;
          const split = splitThought(progress.partial, progress.thinking ?? false);
          patch((s) => ({
            think: {
              ...s.think,
              thought: split.thought,
              answering: split.answering,
              tokensPerSecond: progress.tokensPerSecond || s.think.tokensPerSecond,
              detail:
                progress.phase === 'loading'
                  ? `Loading ${modelName(model)}`
                  : progress.phase === 'prefill'
                    ? `${modelName(model)} is reading the note`
                    : split.answering
                      ? `${modelName(model)} is writing what it found`
                      : `${modelName(model)} is thinking`,
            },
          }));
        },
      });
      run.current = started;
      try {
        const output = await started.done;
        if (!alive) return;
        const split = splitThought(output.text, output.thinking ?? false);
        const findings = readFindings(split.answer, self, others);
        patch((s) => ({
          think: {
            ...s.think,
            state: 'done',
            thought: split.thought,
            answering: true,
            canShowThought: output.thinking ?? false,
            detail: findings.length ? `${modelName(model)} found ${findings.length} ${findings.length === 1 ? 'thing' : 'things'} to look at` : `${modelName(model)} found nothing to change`,
          },
          findings,
          accepted: new Set(findings.map((f) => f.id)),
        }));
      } catch (failure) {
        if (!alive) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        const findings = wordsOnly(changes, self);
        patch((s) => ({
          think: { ...s.think, state: /cancel/i.test(message) ? 'skipped' : 'failed', detail: /cancel/i.test(message) ? 'Stopped' : message },
          findings,
          accepted: new Set(findings.map((f) => f.id)),
        }));
      } finally {
        run.current = null;
      }
    })();

    return () => {
      alive = false;
      run.current?.cancel();
      holdRefining(false);
      setFormattingPaused(false);
      // Left without Keep or Commit (the side key started another recording):
      // what would have run anyway still runs. Checked a tick later, so an
      // immediate remount of the same review is not mistaken for leaving it.
      window.setTimeout(() => {
        if (mounts.current !== mount || ended.current) return;
        ended.current = true;
        if (handoff.job && refined.current && listened.current) void keepBetterPhrases(handoff.job, refined.current);
        else if (handoff.job) enqueueRefine(handoff.job);
        enqueueFormat(handoff.noteId);
      }, 0);
    };
    // The review runs once for its handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A finding used (its change goes in on Commit) or skipped. */
  const decide = useCallback((id: string, use: boolean) => patch((s) => {
    const accepted = new Set(s.accepted);
    if (use) accepted.add(id);
    else accepted.delete(id);
    return { accepted };
  }), [patch]);

  /** A finding's replacement, edited by the person before committing. */
  const edit = useCallback((id: string, replacement: string) => patch((s) => ({
    findings: (s.findings ?? []).map((f) => (f.id !== id ? f : f.change.kind === 'add' ? { ...f, change: { kind: 'add', line: replacement } } : { ...f, change: { ...f.change, replace: replacement } })),
  })), [patch]);

  /** Leaving: the accepted findings written (none when skipping), and what would have run anyway queued. */
  const finish = useCallback(async (commit: boolean): Promise<void> => {
    if (ended.current) return;
    ended.current = true;
    run.current?.cancel();
    patch(() => ({ committing: true }));
    const current = notes.current;
    if (commit && current) {
      const accepted = (state.findings ?? []).filter((f) => state.accepted.has(f.id));
      // Read again: nothing should have changed them, but a commit writes over what is there.
      const fresh = await Promise.all([current.self, ...current.others].map(async (n) => {
        const now = await getNote(n.id).catch(() => null);
        return now ? { ...n, body: now.body } : n;
      }));
      const changed = applyFindings(fresh, accepted);
      for (const [id, body] of changed) {
        const note = await getNote(id).catch(() => null);
        if (note) await updateNote(id, body, note.revision ?? 1);
      }
    }
    if (handoff.job && refined.current && listened.current) await keepBetterPhrases(handoff.job, refined.current);
    // Left before listening again finished: the better words come later, as they always did.
    else if (handoff.job) enqueueRefine(handoff.job);
    holdRefining(false);
    setFormattingPaused(false);
    enqueueFormat(handoff.noteId);
  }, [handoff, patch, state.accepted, state.findings]);

  const stopThinking = useCallback(() => run.current?.cancel(), []);

  return { state, decide, edit, finish, stopThinking };
}

/** The review's model, played by a script in a browser (`?review`): a thought streamed, then findings from the word changes. */
function simulatedRun(options: Parameters<typeof generate>[0]): Run {
  let cancelled = false;
  const thought = [
    'Thinking Process:',
    '',
    '1. Words. The two transcripts disagree in a few places. The slower model heard "seek bar" where the fast one heard "seat bar"; a seek bar is the scrubber in a player, so "seek" is right.',
    '2. Structure. The heading names the note, the to-dos are things to do, nothing else looks like a list.',
    '3. Commands. Each "hey Ghost" command landed where its words said.',
    '4. Names. HelloTrade is written as one word in the note titles.',
  ].join('\n');
  const changes = options.prompt.match(/\[([^\]]*?) → ([^\]]*?)\]/g) ?? [];
  const note = /AS SAVED:\n([\s\S]*)$/.exec(options.prompt)?.[1] ?? '';
  const findings = changes.flatMap((pair) => {
    const [, heard = '', careful = ''] = /\[([^\]]*?) → ([^\]]*?)\]/.exec(pair) ?? [];
    const find = heard.replace(/[.,;:!?]+$/, '');
    const line = note.split('\n').find((l) => l.toLowerCase().includes(find.toLowerCase()));
    if (!find || !line) return [];
    return [{ check: 'words', what: `“${careful.replace(/[.,;:!?]+$/, '')}”, not “${find}”`, why: 'The slower speech model heard it this way, and it fits the note.', find: line, replace: line.replace(new RegExp(find, 'i'), careful.replace(/[.,;:!?]+$/, '')) }];
  });
  const text = `<think>\n${thought}\n</think>\n\n${JSON.stringify(findings)}`;
  const done = (async () => {
    const started = Date.now();
    for (let at = 0; at <= text.length; at += 6) {
      if (cancelled) throw new Error('cancelled');
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      options.onProgress({ id: 'sim', phase: 'generating', promptTokens: 0, promptTokensDone: 0, outputTokens: Math.round(at / 4), tokensPerSecond: 11, elapsedMs: Date.now() - started, partial: text.slice(0, at), thinking: true });
    }
    return { text, promptTokens: 0, outputTokens: Math.round(text.length / 4), ms: Date.now() - started, cachedTokens: 0, prefillMs: 0, loadMs: 0, tokensPerSecond: 11, truncated: false, thinking: true };
  })();
  return { done, cancel: () => (cancelled = true) };
}
