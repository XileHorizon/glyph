import { planCommand, type Plan } from './command.ts';
import { scanForCommand } from './commandScan.ts';
import type { Candidate } from './route.ts';
import { spokenListItems } from './spokenList.ts';
import { readPlan, readSort, runVoiceStep, type VoiceAction, type VoiceStep } from './voicePlan.ts';
import { traceRecording, type VoiceTrace } from './voiceLog.ts';
import { withoutTrailingEcho } from './trailingEcho.ts';

export type { VoiceAction } from './voicePlan.ts';

export type FinalInstruction<N extends Candidate> =
  | { kind: 'ordinary'; notice: string | null; trace?: number }
  /**
   * The changes the recording asks for, and the rest of what was said as its
   * own note. `conversational`: found inside the recording, not at its start;
   * declined, the recording is kept as a note.
   */
  | { kind: 'offer'; actions: VoiceAction<N>[]; note: string | null; conversational: boolean; trace?: number }
  | { kind: 'rejected'; reason: string; trace?: number };

/** A spoken command that says it is about a list. */
const LIST_WORDS = /\b(?:list|lists|items?|bullets?|bullet\s+points?|tasks?|to-?\s?dos?|check\s?list)\b/i;
/** A Markdown list line: the note already keeps a list. */
const LIST_LINE = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)\S/m;
/** The most words an item has when nobody said "list": longer pieces are a sentence with commas in it. */
const SHORT_ITEM_WORDS = 4;
/** "We should…", "it was…": a piece that starts like a sentence is not an item. */
const SENTENCE_START = /^(?:i|i'm|we|we're|you|he|she|it|it's|they|this|that|there|so|if|when|because|after|before|with)\b/i;

/**
 * Items, when what is added is a list: the command asked for one, or the note
 * already is one and the words are several short things. The app decides this
 * from the person's words and the note, not from the model's answer, so a
 * small model that leaves its placement empty cannot turn a list into a block
 * of text.
 */
function listItems(words: string, content: string, body: string | undefined, asked: boolean): string[] | null {
  const wanted = asked || LIST_WORDS.test(words);
  if (!wanted && !LIST_LINE.test(body ?? '')) return null;
  const items = spokenListItems(content);
  if (items.length < 2) return null;
  if (!wanted && items.some((item) => item.split(/\s+/).length > SHORT_ITEM_WORDS || SENTENCE_START.test(item))) return null;
  return items;
}

/**
 * Words that could be a request, anywhere: worth asking the model to sort.
 * Loose on purpose - the sort step decides - but a recording with none of
 * them is plainly dictation and costs no model time.
 */
const HINT =
  /\b(?:add|put|append|make|create|start|throw|stick|toss|include|insert|jot|write|save|list|lists|checklist|to-?\s?dos?|keep\s+track|track\s+of|remember|remind|note\s+down|could\s+use|(?:need|want)\s+(?:a|an|some)\s+(?:new\s+)?(?:list|note|place|spot|way))\b/i;

const escapeTitle = (title: string) => title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`[\s\p{P}]+`);
const namesATitle = (said: string, titles: readonly string[]) =>
  titles.some((title) => title.trim().length > 1 && new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${escapeTitle(title)}(?=$|[^\p{L}\p{N}])`, 'iu').test(said));

/** The rules' plan as actions: what the card shows and confirming carries out. */
function actionsOf<N extends Candidate>(plan: Plan<N>): VoiceAction<N>[] {
  if (plan.kind === 'place') {
    const { note, text, how, task, many, target, near, items } = plan;
    return [{ do: 'append', note, text, placement: { how, task, many, target, ...(near ? { near } : {}), ...(items ? { items } : {}) } }];
  }
  if (plan.kind === 'create-list') return [{ do: 'create', title: plan.title, items: plan.items ?? [], tasks: false }];
  return [];
}

function describe<N extends Candidate>(actions: readonly VoiceAction<N>[], note: string | null): string {
  const parts = actions.map((action) =>
    action.do === 'create' ? `create “${action.title}” (${action.items.length} items)` : `add to ${action.note.title}: ${action.placement.items?.length ?? 1} ${action.placement.how === 'item' ? 'item(s)' : 'paragraph'}`,
  );
  if (note) parts.push('keep the rest as a note');
  return `offer: ${parts.join('; ')}`;
}

/**
 * Read one stopped recording. Live phrase commits never call this: an action
 * is possible only after Whisper has supplied the complete transcript.
 *
 * 1. The rules (command.ts), on a request found anywhere in it: instant and
 *    exact for the phrasings they know.
 * 2. Otherwise, when anything in it could be a request, the on-device model in
 *    two steps (voicePlan.ts): sort, then plan with real item lists.
 * Every step is written to the voice log (voiceLog.ts).
 */
export async function classifyFinalTranscript<N extends Candidate & { note?: { body: string } }>(
  heard: string,
  notes: readonly N[],
  step: VoiceStep = runVoiceStep,
  trace: VoiceTrace = traceRecording(heard),
): Promise<FinalInstruction<N>> {
  const transcript = withoutTrailingEcho(heard);
  if (transcript !== heard.trim()) trace.step(`dropped Whisper's echo at the end: “${heard.slice(transcript.length).trim()}”`);
  const titles = notes.map((note) => note.title).filter((title) => title.trim());
  const scan = scanForCommand(transcript, titles);
  const conversational = !scan?.anchored;
  const finish = (result: FinalInstruction<N>): FinalInstruction<N> => {
    trace.decide(result.kind === 'offer' ? describe(result.actions, result.note) : result.kind === 'rejected' ? `rejected: ${result.reason}` : `note${result.notice ? ` (${result.notice})` : ''}`);
    return { ...result, trace: trace.at };
  };
  /**
   * A request that cannot be carried out. One the recording began with is
   * rejected: its words are a command, not a note. One found inside talk
   * leaves the recording as a note, with why.
   */
  const fail = (reason: string) =>
    finish(conversational ? { kind: 'ordinary', notice: `${reason} Saved this recording as a note.` } : { kind: 'rejected', reason: `${reason} Nothing changed.` });

  // 1. The rules.
  let unmatched: string | null = null;
  if (scan) {
    trace.step(`request found (${scan.anchored ? 'at the start' : 'inside the talk'}): “${scan.words.slice(0, 200)}”`);
    const plan = planCommand(scan.words, { notes });
    if (plan?.kind === 'no-note') unmatched = `No note matches “${plan.name}”.`;
    if (plan?.kind === 'place' || plan?.kind === 'create-list') {
      let ruled: Plan<N> = plan;
      if (plan.kind === 'place' && plan.how === 'leave') {
        // "Add to Movies Jaws, Alien and Heat": a list note takes several things as several items.
        const items = listItems(scan.words, plan.text, plan.note.note?.body, false);
        if (items) ruled = { ...plan, how: 'item', many: true, items };
      }
      trace.step(`rules: ${ruled.kind === 'place' ? `add to ${ruled.note.title}` : `create ${ruled.title}`}`);
      return finish({ kind: 'offer', actions: actionsOf(ruled), note: null, conversational });
    }
    trace.step(plan ? `rules: ${plan.kind}${unmatched ? ` (${unmatched})` : ''}` : 'rules: no known phrasing');
  } else if (!HINT.test(transcript) && !namesATitle(transcript, titles)) {
    trace.step('no request words: dictation');
    return finish({ kind: 'ordinary', notice: null });
  } else {
    trace.step('request words, no request shape: asking the model');
  }

  // 2. The model: sort.
  const sorted = await step('sort', null, transcript, titles);
  if (sorted.status !== 'answer') {
    trace.step(`sort ${sorted.status}: ${sorted.reason}`);
    if (sorted.status === 'refused') return fail(sorted.reason);
    if (unmatched) return fail(unmatched);
    return finish({ kind: 'ordinary', notice: scan ? 'Command understanding was unavailable; saved this recording as a note.' : null });
  }
  trace.step(`sort (${sorted.model}): ${sorted.raw}`);
  const kind = readSort(sorted.answer);
  if (!kind) return unmatched ? fail(unmatched) : finish({ kind: 'ordinary', notice: scan ? 'The model’s answer could not be read; saved this recording as a note.' : null });
  if (kind === 'note') return scan?.anchored && unmatched ? fail(unmatched) : finish({ kind: 'ordinary', notice: null });

  // 3. The model: plan.
  const planned = await step('plan', kind, transcript, titles);
  if (planned.status !== 'answer') {
    trace.step(`plan ${planned.status}: ${planned.reason}`);
    return fail(planned.status === 'refused' ? planned.reason : unmatched ?? 'Command understanding was unavailable.');
  }
  trace.step(`plan (${planned.model}): ${planned.raw}`);
  const read = readPlan(planned.answer, transcript, notes);
  if (!read) return fail(unmatched ?? 'The model’s plan could not be read.');
  for (const problem of read.problems) trace.step(`check: ${problem}`);
  if (!read.actions.length) {
    const why = read.problems[0] ? `${read.problems[0].charAt(0).toUpperCase()}${read.problems[0].slice(1)}.` : null;
    return why || unmatched ? fail(why ?? unmatched ?? '') : finish({ kind: 'ordinary', notice: null });
  }
  return finish({ kind: 'offer', actions: read.actions, note: read.note, conversational });
}
