import { preferences } from '../core/preferences.ts';
import { invoke, isTauri } from '../core/tauri.ts';
import type { Placement } from './command.ts';
import { listTitle } from './instructionMutation.ts';
import { resolveTarget, type Candidate } from './route.ts';

/**
 * Reading a finished recording with the on-device model, in two small steps
 * (native `ai_voice_step`, prompts and grammars in llm/command.rs):
 *
 * 1. sort: is this a note, an addition, a new list, or both talk and a request?
 * 2. plan: the actions, each with its items as a real list, plus whatever else
 *    was said worth keeping as a note.
 *
 * The model proposes; this file checks. Every field is validated by shape, a
 * note to add to must be one of the person's notes, and every item, title and
 * note must be made of words they actually said (`grounded`), so a small model
 * that invents "Superman III" loses that item rather than writing it. Text is
 * escaped so it cannot become Markdown structure.
 */

export type SortKind = 'note' | 'add' | 'new' | 'mixed';

export type StepResult =
  | { status: 'answer'; answer: unknown; raw: string; model: string }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string };

export type VoiceStep = (stage: 'sort' | 'plan', kind: SortKind | null, transcript: string, titles: readonly string[]) => Promise<StepResult>;

/** One change a recording asks for, checked and ready to show on the card. */
export type VoiceAction<N extends Candidate> =
  | { do: 'append'; note: N; text: string; placement: Placement }
  | { do: 'create'; title: string; items: readonly string[]; tasks: boolean };

let sequence = 0;

/** The native step. In a browser there is no model: unavailable. */
export const runVoiceStep: VoiceStep = async (stage, kind, transcript, titles) => {
  if (!isTauri()) return { status: 'unavailable', reason: 'The on-device model runs in the installed app.' };
  const id = `voice-${Date.now().toString(36)}-${(sequence += 1)}`;
  try {
    const value = await invoke<unknown>('ai_voice_step', {
      request: { id, transcript, titles: titles.slice(0, 60), stage, kind, preferredModel: preferences().formatModel },
    });
    const result = value as Partial<{ status: string; answer: unknown; raw: unknown; model: unknown; reason: unknown }>;
    if (result?.status === 'answer' && typeof result.raw === 'string' && typeof result.model === 'string') {
      return { status: 'answer', answer: result.answer, raw: result.raw, model: result.model };
    }
    if ((result?.status === 'refused' || result?.status === 'unavailable') && typeof result.reason === 'string') {
      return { status: result.status, reason: result.reason };
    }
    return { status: 'unavailable', reason: 'The on-device model returned something unexpected.' };
  } catch (failure) {
    return { status: 'unavailable', reason: failure instanceof Error ? failure.message : String(failure) };
  }
};

const KINDS: readonly SortKind[] = ['note', 'add', 'new', 'mixed'];

export function readSort(answer: unknown): SortKind | null {
  const kind = (answer as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' && (KINDS as readonly string[]).includes(kind) ? (kind as SortKind) : null;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && [...value].length <= max && ![...value].some((c) => (c.codePointAt(0) ?? 0) < 32) ? value.replace(/\s+/g, ' ').trim() : null;

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** The words of `said`, lower-cased, for checking that something was said. */
export function wordsOf(said: string): Set<string> {
  const words = said.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  const all = new Set<string>();
  for (const word of words) {
    all.add(word);
    // "part two" said, "Part 2" written, and the other way round.
    const spelled = NUMBERS.indexOf(word);
    if (spelled >= 0) all.add(String(spelled));
    if (/^\d+$/.test(word) && NUMBERS[Number(word)]) all.add(NUMBERS[Number(word)] ?? word);
    // "spiderman" said, "Spider-Man" written: the joined and the split forms both count.
    all.add(word.replace(/s$/, ''));
  }
  // Two words said together also count as their joined form: "spider man" is "spiderman".
  for (let i = 0; i + 1 < words.length; i += 1) all.add(`${words[i]}${words[i + 1]}`);
  return all;
}

/** Whether every word of `written` (three letters or more, and every number) was said. Small joining words may be added. */
export function grounded(written: string, said: Set<string>): boolean {
  const words = written.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  const joined = words.join('');
  if (joined && said.has(joined)) return true;
  return words.every((word) => (word.length < 3 && !/\d/.test(word)) || said.has(word) || said.has(word.replace(/s$/, '')) || /^(?:the|and|for|with)$/.test(word));
}

/**
 * Model text as literal note text: what it says stays, but it cannot open a
 * heading, quote, list, link, code or HTML. Lighter than escaping every mark,
 * so "St. Louis" and "Spider-Man" read as they are in the editor.
 */
export function plainText(said: string): string {
  return said
    .replace(/[\\`*_[\]<>|]/g, '\\$&')
    .replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/, '$1\\$2');
}

export interface ReadPlan<N extends Candidate> {
  actions: VoiceAction<N>[];
  /** The rest of what was said, worth its own note; null for none. */
  note: string | null;
  /** What the checks set aside, for the voice log and the notice. */
  problems: string[];
}

/** The model's plan, checked against the recording and the person's notes. */
export function readPlan<N extends Candidate>(answer: unknown, transcript: string, notes: readonly N[]): ReadPlan<N> | null {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const { actions, note } = answer as { actions?: unknown; note?: unknown };
  if (!Array.isArray(actions) || actions.length > 3) return null;
  const said = wordsOf(transcript);
  const problems: string[] = [];
  const out: VoiceAction<N>[] = [];

  const itemsOf = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const items: string[] = [];
    for (const raw of value.slice(0, 50)) {
      const item = text(raw, 200);
      if (!item) continue;
      if (!grounded(item, said)) {
        problems.push(`dropped “${item}”: not something you said`);
        continue;
      }
      items.push(plainText(item));
    }
    return items;
  };

  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const action = raw as Record<string, unknown>;
    const as = action.as === 'tasks' ? 'tasks' : action.as === 'text' ? 'text' : 'list';
    if (action.do === 'append') {
      const title = text(action.note, 120);
      if (!title) continue;
      const target = resolveTarget(title, notes);
      if (target.status !== 'resolved') {
        problems.push(target.status === 'ambiguous' ? `“${title}” matches more than one note` : `no note called “${title}”`);
        continue;
      }
      const items = itemsOf(action.items);
      const words = text(action.text, 4_000);
      if (as === 'text' || (!items.length && words)) {
        if (!words || !grounded(words, said)) {
          problems.push(words ? `dropped text for ${title}: not what you said` : `nothing to add to ${title}`);
          continue;
        }
        out.push({ do: 'append', note: target.note, text: plainText(words), placement: { how: 'leave', task: false, many: false, target: null } });
        continue;
      }
      if (!items.length) {
        problems.push(`nothing to add to ${title}`);
        continue;
      }
      out.push({
        do: 'append',
        note: target.note,
        text: items.join(', '),
        placement: { how: 'item', task: as === 'tasks', many: items.length > 1, target: null, items },
      });
    } else if (action.do === 'create') {
      const title = text(action.title, 120);
      if (!title || !grounded(title, said)) {
        problems.push(title ? `dropped the new list “${title}”: not a name you said` : 'a new list with no name');
        continue;
      }
      out.push({ do: 'create', title: plainText(listTitle(title)), items: itemsOf(action.items), tasks: as === 'tasks' });
    }
  }

  let rest = note === null ? null : text(note, 4_000);
  if (rest && !grounded(rest, said)) {
    problems.push('dropped the note text: not what you said');
    rest = null;
  }
  return { actions: out, note: rest ? plainText(rest) : null, problems };
}
