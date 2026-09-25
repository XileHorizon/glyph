/**
 * "Add to Weekend trip": sending what is being said to a note by naming it.
 *
 * Two halves, both pure so they are tested without a microphone:
 *
 * - `parseRoute` finds the spoken command in a phrase. It accepts the ways
 *   people say it ("add to", "add this to", "put that in", "move it to my",
 *   "switch to", "go to … note", "leave a note for … that says") at the start
 *   or the end of a phrase, and
 *   hands back the words around it so they can be kept. "New note" said on
 *   its own is the other command. A phrase still being guessed is read
 *   leniently (`partial`), so the recorder can show the note it thinks you
 *   mean before you finish saying its name.
 *
 * - `matchNote` finds the note a spoken name means. Speech recognition hears
 *   "week end trip", "weekend trips" and "the weekend trip note", so titles
 *   are compared by their words and by their letters, and the best one only
 *   counts when it clearly wins. "Put it in the oven" routes nowhere unless
 *   there is a note called Oven: a command that moves words to the wrong
 *   note is worse than one that is missed, which only means saying it again.
 */

export type RouteCommand =
  | {
      kind: 'note';
      /** The name as heard, cleaned of "my", "the" and a trailing "note". */
      name: string;
      /** What was said before and after the command in the same phrase. */
      rest: string;
    }
  | {
      /** "New item for AttackFM": an item for that note's list, not the whole take. */
      kind: 'item';
      name: string;
      /** The item, when it was said in the same phrase ("new item for AttackFM, fix login"). */
      rest: string;
      /** "task" or "to-do" was said: a note with no list starts a to-do list. */
      task: boolean;
      /** "items" or "tasks": every phrase until a pause is an item, not just the next one. */
      many: boolean;
      /**
       * "…in Notion": a plugin's word the note's name ended with (plugins/types.ts
       * `ItemTarget`), whose plugin takes the items once they are in the list.
       */
      target: string | null;
    }
  /**
   * "Leave a note on the page for AttackFM that says …": the words go into
   * that note where they fit, into its list when it has one. With nothing
   * after the name, the next phrase is the note.
   */
  | { kind: 'leave'; name: string; rest: string }
  | { kind: 'new'; rest: string };

const VERB = String.raw`(?:add|put|send|save|move|stick|file|append)`;
const OBJECT = String.raw`(?:\s+(?:this|that|it|these|those|them|everything)(?:\s+(?:bit|part|stuff))?)?`;
const PREP = String.raw`\s+(?:to|in|into|onto|on)`;
const SWITCH = String.raw`(?:switch|go|jump|change)\s+(?:back\s+)?to`;
const OPENER = String.raw`(?:${VERB}${OBJECT}${PREP}|${SWITCH})`;
/** "my", "the", "our" before a name, "note" or "notes" after it. */
const FILLER_BEFORE = /^(?:(?:the|my|our|a)\s+)+/i;
const FILLER_AFTER = /\s+(?:note|notes|list|page)$/i;

/** The command and the name after it, running to the end of the phrase. */
const AT_END = new RegExp(String.raw`(?:^|[.,;!?]\s+|\s+and\s+|\s+)${OPENER}\s+(.+?)[.!?]*\s*$`, 'i');
/** The command at the start, its name ending at the first stop or comma. */
const AT_START = new RegExp(String.raw`^\s*${OPENER}\s+([^.,;!?]+)[.,;!?]\s*(.+)$`, 'i');
/** "New note", and what base.en writes for it said quickly: "new notes", "new node". */
const NEW_NOTE = /^\s*(?:new|start\s+a\s+new|another)\s+(?:notes?|node)[.!]?\s*$/i;

/*
 * "New item for AttackFM", "add a task to the backlog", "new to-dos for work:
 * call Sam, email Jo". The name runs to the first stop or comma; the item, if
 * it came in the same phrase, is what follows. A command at the START of the
 * phrase only: "the new item for AttackFM is great" is a sentence.
 */
const ITEM_COMMAND =
  /^\s*(?:(?:ok(?:ay)?|so|and)[,\s]+)?(?:(?:add|put|make)\s+(?:a|an|another|some)?\s*|(?:a\s+|an\s+)?(?:new|another)\s+)(items?|tasks?|to-?\s?dos?|entry|entries|points?|things?)\s+(?:for|to|on|in(?:to)?)\s+(?:the\s+|my\s+|our\s+)?([^.,;:!?]+?)(?:\s+(?:note|list))?(?:[.,;:!?]\s*(.*))?\s*$/i;

/** "…in <word>" at the end of a note's name in an item command, for a plugin's `ItemTarget` word. */
function targetSuffix(words: readonly string[]): RegExp | null {
  const safe = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  return safe.length ? new RegExp(String.raw`\s+(?:in|on|to|into)\s+(${safe.join('|')})\s*$`, 'i') : null;
}

/*
 * "Leave a note on the page for AttackFM that says the login is broken",
 * "add a note to shopping saying we're out of eggs", "write a line in work:
 * call Sam". The name runs to what introduces the note ("that says",
 * "saying", "that", a comma or colon); a phrase that stops after the name is
 * waiting for the note to be said. A command at the START of a phrase only.
 */
const LEAVE =
  /^\s*(?:(?:ok(?:ay)?|so|and|please|hey)[,\s]+)?(?:(?:can|could|would)\s+you\s+)?(?:leave|add|put|write|drop|make|jot(?:\s+down)?|stick|pop)\s+(?:(?:a|an|another|one\s+more)\s+)?(?:quick\s+|little\s+|short\s+)?(?:note|line|comment|reminder|memo)\s+(?:on|in|to|for|into|onto|under)\s+(?:(?:the|my|our)\s+)?(?:(?:page|note)\s+(?:for|called|named|titled|about)\s+)?(?:(?:the|my|our)\s+)?([^.,;:!?]+?)(?:\s+(?:page|note))?(?:\s*(?:[,:;]|\s(?:that\s+says|which\s+says|that\s+reads|saying|to\s+say|that))\s*(.*?))?[.!?]*\s*$/i;

function cleanName(raw: string): string {
  return raw.replace(/[.,;:!?"“”]+/g, ' ').replace(/\s+/g, ' ').trim().replace(FILLER_BEFORE, '').replace(FILLER_AFTER, '').trim();
}

function tidyRest(text: string): string {
  return text
    .replace(/\s+and\s*$/i, '')
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .trim();
}

/**
 * The route command in `text`, if there is one. `partial` reads a phrase that
 * may still be growing, so a command whose name has only just begun still
 * counts (for showing a guess, never for moving words).
 */
export function parseRoute(
  text: string,
  { partial = false, targets = [] }: { partial?: boolean; targets?: readonly string[] } = {},
): RouteCommand | null {
  if (NEW_NOTE.test(text)) return { kind: 'new', rest: '' };
  const leave = LEAVE.exec(text);
  if (leave?.[1]) {
    const name = cleanName(leave[1]);
    const said = leave[2]?.trim() ?? '';
    // "Leave a note for attack" may still be growing into its name: a guess
    // until the phrase ends or the note itself follows.
    const ended = said !== '' || /[.!?]\s*$/.test(text);
    if (name.length >= (partial ? 2 : 3) && (partial || ended)) return { kind: 'leave', name, rest: said };
  }
  const item = ITEM_COMMAND.exec(text);
  if (item?.[1] && item[2]) {
    const suffix = targetSuffix(targets);
    const target = suffix?.exec(item[2])?.[1]?.toLowerCase() ?? null;
    const name = cleanName(suffix ? item[2].replace(suffix, '') : item[2]);
    const noun = item[1].toLowerCase().replace(/\s+/g, '');
    // A finished phrase with no stop after the name ("new item for attack")
    // may still be growing; only a guess until it ends or the item follows.
    const ended = item[3] !== undefined || /[.!?]\s*$/.test(text);
    if (name.length >= (partial ? 2 : 3) && (partial || ended)) {
      return {
        kind: 'item',
        name,
        rest: tidyRest(item[3] ?? ''),
        task: /^(?:task|to-?do)/.test(noun),
        many: /s$/.test(noun),
        target,
      };
    }
  }
  const start = AT_START.exec(text);
  if (start?.[1] && start[2]) {
    const name = cleanName(start[1]);
    if (name) return { kind: 'note', name, rest: tidyRest(start[2]) };
  }
  const end = AT_END.exec(text);
  if (end?.[1]) {
    const name = cleanName(end[1]);
    // A finished phrase needs a name of real length; a growing one can show a
    // guess from its first letters.
    if (name.length >= (partial ? 2 : 3)) {
      return { kind: 'note', name, rest: tidyRest(text.slice(0, end.index)) };
    }
  }
  return null;
}

// ---- matching a name to a note -----------------------------------------------------------

export interface Candidate {
  id: string;
  title: string;
}

export interface Match<T extends Candidate> {
  note: T;
  /** 0 to 1. */
  score: number;
}

export type TargetResolution<T extends Candidate> =
  | { status: 'resolved'; note: T; score: number }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'not-found' };

/** Lowercase words with punctuation and filler gone, and a plural's s dropped. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['the', 'my', 'a', 'our', 'note', 'notes'].includes(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function bigrams(text: string): Map<string, number> {
  const squashed = text.replace(/\s+/g, '');
  const counts = new Map<string, number>();
  for (let i = 0; i < squashed.length - 1; i += 1) {
    const pair = squashed.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen-Dice over letter pairs, spaces ignored: "week end trip" and "weekend trip" score 1. */
function dice(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let total = 0;
  x.forEach((n) => (total += n));
  y.forEach((n) => (total += n));
  if (!total) return a === b ? 1 : 0;
  let shared = 0;
  x.forEach((n, pair) => (shared += Math.min(n, y.get(pair) ?? 0)));
  return (2 * shared) / total;
}

/** How well a spoken `name` fits a note `title`, 0 to 1. */
export function similarity(name: string, title: string): number {
  const said = wordsOf(name);
  const titled = wordsOf(title);
  if (!said.length || !titled.length) return 0;
  const letters = dice(said.join(' '), titled.join(' '));
  const shared = said.filter((w) => titled.includes(w)).length;
  const words = shared / Math.max(said.length, titled.length);
  // A name that is the whole start of the title ("weekend" for "Weekend trip
  // to the lake") is a fair pick, a little below an exact one.
  const prefix = titled.slice(0, said.length).join(' ') === said.join(' ') ? 0.85 : 0;
  return Math.max(letters, words, prefix);
}

/**
 * The note `name` means, if one clearly does: the best score must reach
 * `threshold` and beat the runner-up by `margin`. Ties go to the earlier
 * candidate, so pass them most recent first.
 */
export function matchNote<T extends Candidate>(name: string, notes: readonly T[], options: { threshold?: number; margin?: number } = {}): Match<T> | null {
  const resolved = resolveTarget(name, notes, options);
  return resolved.status === 'resolved' ? { note: resolved.note, score: resolved.score } : null;
}

/** Resolve a spoken title without throwing away why it was unsafe to choose. */
export function resolveTarget<T extends Candidate>(
  name: string,
  notes: readonly T[],
  { threshold = 0.72, margin = 0.08 }: { threshold?: number; margin?: number } = {},
): TargetResolution<T> {
  const ranked = notes
    .filter((note) => note.title.trim())
    .map((note) => ({ note, score: similarity(name, note.title) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < threshold) return { status: 'not-found' };
  const exact = ranked.filter((candidate) => candidate.score >= 0.99);
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact.map((candidate) => candidate.note) };
  const close = ranked.filter((candidate) => best.score - candidate.score < margin);
  if (close.length > 1 && best.score < 0.99) return { status: 'ambiguous', candidates: close.map((candidate) => candidate.note) };
  return { status: 'resolved', note: best.note, score: best.score };
}
