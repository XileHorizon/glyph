import { preferences } from '../core/preferences.ts';
import { invoke, isTauri } from '../core/tauri.ts';
import { planCommand, type Plan } from './command.ts';
import type { InstructionArea } from './listAppend.ts';
import { resolveTarget, type Candidate } from './route.ts';

export type InstructionIntent =
  | { action: 'append'; target: string; content: string; placement: InstructionArea }
  | { action: 'create'; target: string; content: string | null }
  | { action: 'none'; reason: 'unsupported' | 'destructive' | 'compound' | 'unclear' };

export type InferenceResult =
  | { status: 'intent'; intent: InstructionIntent; model: string }
  | { status: 'unavailable'; reason: string };

const keysAre = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const safeText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  [...value].length <= max &&
  [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  });

/** Strict runtime validation at the IPC boundary, independent of TypeScript types. */
export function validateInference(value: unknown): InferenceResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.status === 'unavailable') {
    return keysAre(result, ['reason', 'status']) && safeText(result.reason, 500)
      ? { status: 'unavailable', reason: result.reason }
      : null;
  }
  if (result.status !== 'intent' || !keysAre(result, ['intent', 'model', 'status']) || typeof result.model !== 'string') return null;
  if (!result.intent || typeof result.intent !== 'object' || Array.isArray(result.intent)) return null;
  const intent = result.intent as Record<string, unknown>;
  if (intent.action === 'append') {
    const placements: InstructionArea[] = ['bugs', 'tasks', 'list', 'notes', null];
    if (
      keysAre(intent, ['action', 'content', 'placement', 'target']) &&
      safeText(intent.target, 120) &&
      safeText(intent.content, 4_000) &&
      placements.includes(intent.placement as InstructionArea)
    ) {
      return { status: 'intent', model: result.model, intent: { action: 'append', target: intent.target.trim(), content: intent.content.trim(), placement: intent.placement as InstructionArea } };
    }
  }
  if (intent.action === 'create') {
    if (
      keysAre(intent, ['action', 'content', 'target']) &&
      safeText(intent.target, 120) &&
      (intent.content === null || safeText(intent.content, 4_000))
    ) {
      return { status: 'intent', model: result.model, intent: { action: 'create', target: intent.target.trim(), content: typeof intent.content === 'string' ? intent.content.trim() : null } };
    }
  }
  if (intent.action === 'none') {
    const reasons = ['unsupported', 'destructive', 'compound', 'unclear'] as const;
    if (keysAre(intent, ['action', 'reason']) && reasons.includes(intent.reason as (typeof reasons)[number])) {
      return { status: 'intent', model: result.model, intent: { action: 'none', reason: intent.reason as (typeof reasons)[number] } };
    }
  }
  return null;
}

let sequence = 0;

export interface InferenceRun {
  done: Promise<InferenceResult>;
  cancel: () => void;
}

export type InterpretedCommand<N extends Candidate> =
  | { source: 'deterministic'; plan: Plan<N> }
  | { source: 'inferred'; intent: Extract<InstructionIntent, { action: 'append' }>; note: N }
  | { source: 'inferred'; intent: Extract<InstructionIntent, { action: 'create' }> }
  | { source: 'rejected'; reason: string };

/** Native-only inference. It never downloads a model or calls a remote service. */
export function inferInstruction(utterance: string, titles: readonly string[] = []): InferenceRun {
  const id = `command-${Date.now().toString(36)}-${(sequence += 1)}`;
  if (!isTauri()) {
    return { done: Promise.resolve({ status: 'unavailable', reason: 'Instruction inference is available in the installed Android app.' }), cancel: () => undefined };
  }
  const done = invoke<unknown>('ai_infer_command', { request: { id, utterance, titles: titles.slice(0, 60), preferredModel: preferences().formatModel } })
    .then((value) => {
      const checked = validateInference(value);
      return checked ?? { status: 'unavailable' as const, reason: 'The on-device model returned an invalid command.' };
    })
    .catch((failure: unknown) => ({
      status: 'unavailable' as const,
      reason: failure instanceof Error ? failure.message : String(failure),
    }));
  return {
    done,
    cancel: () => void invoke<boolean>('ai_cancel', { id }).catch(() => undefined),
  };
}

/** Deterministic parser has absolute precedence; inference is fallback only. */
export function interpretWakeCommand<N extends Candidate>(
  utterance: string,
  options: { notes: readonly N[]; targets?: readonly string[] },
  startInference: (words: string) => InferenceRun = inferInstruction,
): { done: Promise<InterpretedCommand<N>>; cancel: () => void } {
  const deterministic = planCommand(utterance, options);
  if (deterministic) {
    return { done: Promise.resolve({ source: 'deterministic', plan: deterministic }), cancel: () => undefined };
  }
  const run = startInference(utterance);
  return {
    cancel: run.cancel,
    done: run.done.then((result): InterpretedCommand<N> => {
      if (result.status === 'unavailable') return { source: 'rejected', reason: result.reason };
      if (result.intent.action === 'none') return { source: 'rejected', reason: `That ${result.intent.reason} request was not changed.` };
      if (result.intent.action === 'create') return { source: 'inferred', intent: result.intent };
      const target = resolveTarget(result.intent.target, options.notes);
      if (target.status === 'not-found') return { source: 'rejected', reason: `No note called “${result.intent.target}”.` };
      if (target.status === 'ambiguous') return { source: 'rejected', reason: `“${result.intent.target}” matches more than one note.` };
      return { source: 'inferred', intent: result.intent, note: target.note };
    }),
  };
}
