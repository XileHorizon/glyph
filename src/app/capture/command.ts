import { addToLane, lanesOf, matchLane, moveToLane, type Lane } from '../core/boards.ts';
import { matchNote, parseRoute, type Candidate } from './route.ts';
import { cellsOf } from './table.ts';
import { spokenListItems } from './spokenList.ts';

/**
 * "Glyph, add buy milk to HelloTrade": commands while recording, which only
 * count after the keyword, and which ask before they act.
 *
 * Matt, after "add a note to hello trade" became a new note called "To the
 * hello trade": "have it listen for keywords and not do anything until it
 * hears the keyword and confirms the action". Commands used to be read out of
 * every phrase, in a handful of exact phrasings, and a pause in the middle of
 * one split it into two phrases that were each just words. So:
 *
 * - Nothing is a command until "Glyph" is heard (`findKeyword`). What comes
 *   before it in the phrase stays in the note; what comes after, across as many
 *   phrases as it takes, is the command and never lands in the note.
 * - The command is read more loosely than before (`planCommand`), since the
 *   keyword already says it is one: "add buy milk to hello trade", "add a list
 *   item to HelloTrade", "put call Sam on the work list", plus every phrasing
 *   route.ts knew. A command that names its note but not yet what to add waits
 *   for the next phrase.
 * - Then it asks: the recorder shows what it is about to do, and "yes" or "no"
 *   (`reply`), or a tap, decides. Nothing changes until then.
 *
 * Pure, so every phrasing is a test.
 */

// ---- the keyword ------------------------------------------------------------------------------

/**
 * The word a command follows, and what speech recognition writes for it. "Glyph" is a rare word, so the small model
 * sometimes spells it the way it sounds, and "hey" or "OK" before it are part of the keyword but not needed. "Ghost"
 * - the app's name since it became Ghost.md - is a common word, so a note that begins "Ghost stories…" would have
 * been a command with no command in it; Matt chose "hey Ghost": the new word only counts after "hey", "hi", "OK" or
 * "so", and the old word keeps working as it always did.
 */
const KEYWORD =
  /(^|[\s,.;:!?"“])(?:(?:hey|hi|ok(?:ay)?|so)[,\s]+(?:ghost|ghosts|goast|gost|ghos|ghoast|ghossed|ghosed)|(?:(?:hey|hi|ok(?:ay)?|so)[,\s]+)?(?:glyph|glyphs|glyphe|glyf|glif|gliff|glyff|gliph|glyth|glith|glithe|clith|clyph|gleef|gliv|glive|glit|bliff))(?=$|[\s,.;:!?"”'])[,.;:!?"”]*\s*/i;

/**
 * What base.en writes for "Glyph" that is a word of its own: "Life. Add eggs to my list", "Live, new note", "Head
 * life, put call Sam on the work list". Twelve synthesised voices were run through the phone's model saying
 * "Glyph, …"; half came back as one of these. They are
 * ordinary words, so one only counts at the very start of a phrase, followed by a stop or a comma, and only when what
 * follows reads as a command (`findSoundAlike`); "We climbed the cliff at dawn" and "Life is short" stay words.
 */
const SOUND_ALIKE = /^\s*(?:(?:hey|hi|ok(?:ay)?|so|a|add|head|hade|hate|take|tag)[,\s]+)?(?:life|live|lift|lip|cliff|clip|glide|slip)[,.;:!?]+\s*/i;

/**
 * "…to the Glyph note": the word as a note's name, not the keyword. Matt has a
 * note called Glyph, and "add a note to the Glyph note saying testing if this
 * works", said without the keyword first, took the name for the keyword: the
 * words before it became a note titled "Add a note to" and the rest was lost.
 * A preposition before and "note" or "page" after say it is a name.
 */
const NAMED_BEFORE = /(?:^|\s)(?:to|in|into|on|onto|for|under|about|called|named|titled)\s+(?:(?:the|my|our|a)\s+)?$/i;
const NAMED_AFTER = /^\s*(?:notes?|pages?|list)\b/i;

/** The keyword in `text`: the words before it (kept as words) and after it (the command). */
export function findKeyword(text: string): { before: string; after: string } | null {
  const all = new RegExp(KEYWORD.source, 'gi');
  for (const found of text.matchAll(all)) {
    const at = found.index + (found[1]?.length ?? 0);
    const end = found.index + found[0].length;
    if (NAMED_BEFORE.test(text.slice(0, at)) && NAMED_AFTER.test(text.slice(end))) continue;
    return {
      before: text.slice(0, at).replace(/[\s,;:]+$/, '').trim(),
      after: text.slice(end).trim(),
    };
  }
  return null;
}

/**
 * A sound-alike of the keyword at the start of `text` ("Life. Add eggs to work."), when `reads` says the rest is a
 * command: the same shape as `findKeyword`, nothing before it.
 */
export function findSoundAlike(text: string, reads: (words: string) => boolean): { before: string; after: string } | null {
  const found = SOUND_ALIKE.exec(text);
  if (!found) return null;
  const after = text.slice(found[0].length).trim();
  return after && reads(after) ? { before: '', after } : null;
}

/** Whether a plan is something to do: a note to add to or move to, a new note, a table, or a note named and waiting. */
export function actionable(plan: Plan | null): boolean {
  return plan !== null && plan.kind !== 'no-note';
}

// ---- yes or no --------------------------------------------------------------------------------

const YES = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|confirm(?:ed)?|correct|right|do it|go ahead|go for it|add it|send it|move it|please(?: do)?|that's right|that is right|sounds good|perfect)\b/i;
const NO = /^(?:no|nope|nah|cancel|never ?mind|stop|don't|do not|wrong|scratch that|forget it|not that)\b/i;

/** A reply to "shall I?": yes, no, or neither. Short phrases only, so a sentence starting "No problem with the invoice" is a sentence. */
export function reply(text: string): 'yes' | 'no' | null {
  const said = text.trim().replace(/^(?:um+|uh+|er+|oh)[,\s]+/i, '').replace(/[.!?,]+$/, '').trim();
  if (!said || said.split(/\s+/).length > 5) return null;
  if (NO.test(said)) return 'no';
  if (YES.test(said)) return 'yes';
  return null;
}

// ---- the plan ---------------------------------------------------------------------------------

export interface Placement {
  /** "leave": into the list it fits, or a paragraph (listAppend.ts `leaveNote`). "item": always a list item. "paragraph": always its own paragraph. */
  how: 'leave' | 'item' | 'paragraph';
  task: boolean;
  /** "Items", "tasks": every phrase until a pause is one. */
  many: boolean;
  /** A plugin's word after the note's name ("…in Notion"). */
  target: string | null;
  /** Semantic list area named explicitly by the command. */
  near?: 'bugs';
  /** The items already told apart ("a list with…"), so a comma inside one ("Parkersburg, West Virginia") stays in it. */
  items?: readonly string[];
}

export type Plan<N extends Candidate = Candidate> =
  /** Words into a note. */
  | ({ kind: 'place'; note: N; text: string } & Placement)
  /** A note named, but not yet what goes in it: the next phrase is that. */
  | ({ kind: 'await'; note: N } & Placement)
  /** This take's words move to a note and carry on there. */
  | { kind: 'move'; note: N }
  /** This take becomes a new note. */
  | { kind: 'new' }
  /** A standalone Speak request creates a separately titled list note, with the items said for it. */
  | { kind: 'create-list'; title: string; items?: readonly string[] }
  /** A table, asked for a piece at a time (capture/table.ts): in a named note, or this one when none is named. */
  | { kind: 'table'; note: N | null; columns: string[] }
  /** A card for a board's lane: "Glyph, add fix the login bug to Doing" (core/boards.ts). */
  | { kind: 'lane'; note: N; lane: string; words: string; change: (body: string) => string | null }
  /** A card moved to a lane: "Glyph, move the pricing page to Done". */
  | { kind: 'card'; note: N; lane: string; words: string; change: (body: string) => string | null }
  /** "Glyph, make this a board": the note being recorded is written as a board. */
  | { kind: 'board' }
  /** A note was named that there is no note for. */
  | { kind: 'no-note'; name: string };

const LEAD = /^\s*(?:(?:please|can you|could you|would you|and|so|ok(?:ay)?|um+|uh+)[,\s]+)+/i;
const MOVERS = /^\s*(?:switch|go|jump|change|move|carry on|continue)\b/i;

/** "a list item", "a task", "a note that says" at the front of what is being added: the kind of thing, not the thing. */
const OBJECT_NOUN = /^(?:(?:a|an|another|one more|some|new)\s+)?(?:quick\s+)?(?:(list\s+)?(items?|entry|entries|bullets?|points?)|(tasks?|to-?\s?dos?|check\s?box(?:es)?)|(notes?|lines?|reminders?|comments?|memos?)|(bugs?|issues?|defects?))(?:\s+(?:about|that\s+says|saying|which\s+says|called|:|,))?\s*/i;

const TABLE = /^(?:add|make|create|start|put|insert|draw|build|new)\s+(?:(?:a|an|another|one)\s+)?(?:new\s+)?table\b(.*)$/i;
const CREATE_LIST = /^(?:(?:please\s+)?(?:make|create|start)\s+(?:(?:me\s+)?(?:a|another)\s+)?(?:new\s+)?list|(?:i\s+(?:need|want|would\s+like))\s+(?:a\s+)?new\s+list)\s+(?:called|named|titled)\s+(.+)$/i;
const ADD_TO_LIST = /^(?:please\s+)?(?:add|put|append)\s+(?:these\s+)?(?:items?\s+)?(?:to|in|into|on)\s+(?:the\s+)?(.+?)\s+list(?:\s+(?:that\s+)?(?:i\s+(?:need|want)|with|containing|:))?\s+(.+)$/i;
const DIRECT_APPEND = /^(?:please\s+)?(?:add|put|append)\s+(?:(?:this|these|the\s+following)\s+)?to\s+(?:(?:the|my|our)\s+)?(?:(?:note|list|page)\s+(?:that(?:'s|\s+is)\s+)?(?:label(?:ed|led)|called|named|titled)\s+|note\s+)?(.+)$/i;

/**
 * What is added, when it says it is a list: "a list with…", "a to-do list of…", "the following items:", "these
 * tasks…". The words after it are the items, told apart by `spokenListItems`.
 */
const LIST_INTRO = /^(?:(?:a|an|the|this|my)\s+)?(?:(?:new|short|quick)\s+)?(?:(?:bullet(?:ed)?|bulleted|numbered|check(?:ed)?|(to-?\s?do|task|check)|shopping|grocery)\s+)?(?:list|items?|(tasks?|to-?\s?dos?|check\s?list))\s*(?:(?:of|with|containing|including|that\s+(?:has|says|includes)|saying|for)\b|:|,|-)\s*|^(?:the\s+following(?:\s+(?:items?|things|places|(tasks?|to-?\s?dos?)))?|(?:these|those)\s+(?:items?|things|places|(tasks?|to-?\s?dos?)))\s*(?::|,|-)?\s*/i;

/** "…and add to the list", "…then put", ", add these": where a new list's title ends and its items begin. */
const THEN_ADD = /(?:\s*[,.;:]\s*|\s+)(?:(?:and|then|and\s+then)\s+)?(?:add|put)\s+/i;
/** "…with", "…containing", "…:": the same, when what follows is plainly several items. */
const WITH_ITEMS = /\s+(?:with|containing|including|that\s+has|of)\s+|\s*:\s*/i;
const THE_LIST = String.raw`(?:(?:the|that|this|my)\s+)?(?:new\s+)?(?:list|note|it)`;
const INTO_LIST_FIRST = new RegExp(String.raw`^(?:to|in|on|into|onto)\s+${THE_LIST}\b\s*[,:]?\s*`, 'i');
const INTO_LIST_LAST = new RegExp(String.raw`\s+(?:to|in|on|into|onto)\s+${THE_LIST}\s*$`, 'i');
const THESE = /^(?:(?:these|the\s+following)(?:\s+(?:items?|things))?|items?)\s*[,:]?\s+/i;

/**
 * "Comic books and add to the list Spider-Man, Batman and Superman": the new list's title, and its items when some
 * were said. A title that merely contains "with" ("Books with pictures") stays a title: only several items split it.
 */
function titleAndItems(said: string): { title: string; items: string[] } {
  const added = THEN_ADD.exec(said);
  if (added && added.index > 0) {
    const rest = said
      .slice(added.index + added[0].length)
      .replace(INTO_LIST_FIRST, '')
      .replace(INTO_LIST_LAST, '')
      .replace(THESE, '')
      .trim();
    const items = spokenListItems(rest);
    if (items.length) return { title: said.slice(0, added.index).trim(), items };
  }
  const listed = WITH_ITEMS.exec(said);
  if (listed && listed.index > 0) {
    const items = spokenListItems(said.slice(listed.index + listed[0].length).replace(THESE, ''));
    if (items.length > 1) return { title: said.slice(0, listed.index).trim(), items };
  }
  return { title: said, items: [] };
}

/** A named note's words, as a list when they say they are one. */
function directPayload(text: string): Pick<Placement, 'how' | 'task' | 'many' | 'items'> & { text: string } {
  const intro = LIST_INTRO.exec(text);
  const rest = intro ? text.slice(intro[0].length).trim() : '';
  if (!intro || !rest) return { text, how: 'leave', task: false, many: false };
  const items = spokenListItems(rest);
  const task = Boolean(intro[1] || intro[2] || intro[3] || intro[4]);
  return { text: items.join(', '), how: 'item', task, many: items.length > 1, items };
}

/** A terminal voice stop cue is control, never command content. */
export function isStopCue(text: string): boolean {
  return /^\s*(?:end|stop)\s*[.!?]*\s*$/i.test(text);
}

export function stripStopCue(text: string): string {
  return text.replace(/(?:[.!?]\s*)?\b(?:end|stop)\s*[.!?]*\s*$/i, '').trim();
}

/**
 * The command in a finished recording, or null when it is not one: what is left once a leading "hey Ghost", "okay",
 * "um" or "can you" is gone, if that starts like a command. Only the very start counts, so a command said inside a
 * sentence ("I told Sam, add to…") stays words.
 */
export function finalCommandWords(text: string): string | null {
  let words = stripStopCue(text.trim()).replace(/^[\s.,;:!?…"“]+/, '');
  for (let pass = 0; pass < 3; pass += 1) {
    const before = words;
    const keyword = findKeyword(words);
    if (keyword && !keyword.before.trim()) words = keyword.after;
    words = words.replace(/^\s*(?:(?:hey|hi|please|can you|could you|would you|will you|and|so|ok(?:ay)?|alright|all right|um+|uh+|er+|hmm+)[,.\s]+)+/i, '').trim();
    if (words === before) break;
  }
  return isStandaloneCommandLike(words) ? words : null;
}

/** Narrow gate for no-wake commands in a fresh main Speak capture. */
export function isStandaloneCommandLike(text: string): boolean {
  return /^(?:please\s+)?(?:make|create|new|add|put|append|i\s+(?:need|want|would\s+like)\s+(?:a\s+)?new)\b/i.test(stripStopCue(text));
}

/** Split only unmistakable short enumerations; preserve ordinary phrases. */
export function splitSpokenItems(text: string, allowBareWords = false): string[] {
  const cleaned = text.trim().replace(/^(?:that\s+)?i\s+(?:need|want)\s+/i, '').replace(/[.!?]+$/, '').trim();
  const punctuated = cleaned.split(/\s*(?:,|;|\band\b)\s*/i).filter(Boolean);
  if (punctuated.length > 1) return punctuated;
  const words = cleaned.split(/\s+/).filter(Boolean);
  return allowBareWords && words.length >= 2 && words.length <= 8 && words.every((word) => /^[\p{L}\p{N}'-]+$/u.test(word)) ? words : [cleaned];
}
/** "…with columns bug, owner and status": the labels said up front, so the first question is skipped. */
const TABLE_COLUMNS = /\s*,?\s*(?:with|using|that has|having)\s+(?:the\s+)?(?:columns?|column labels?|headings?|headers?|labels?)\s*(?:of|:|,)?\s*(.+)$/i;

/** A preposition that can end what is added and start the note's name. */
const INTO = /(?:^|\s+)(?:to|in|into|onto|on|under|for)\s+/gi;

/** The note a spoken name means, leniently: "the", "my" and a trailing "note" or "list" gone. */
function noteNamed<N extends Candidate>(raw: string, notes: readonly N[]): { note: N; score: number } | null {
  const name = raw
    .replace(/[.,;:!?"“”]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:the|my|our|a)\s+)+/i, '')
    .replace(/\s+(?:note|notes|node|list|page)$/i, '')
    .trim();
  if (name.length < 2) return null;
  return matchNote(name, notes);
}

/** Match an actual title at the start of a spoken tail, case/punctuation-insensitively. */
function titledPrefix<N extends Candidate>(tail: string, notes: readonly N[]): { note: N; text: string } | null {
  const found = notes
    .map((note) => {
      const words = note.title.trim().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
      if (!words.length) return null;
      const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(String.raw`[\s\p{P}_]+`);
      const match = new RegExp(String.raw`^\s*${pattern}(?:[\s\p{P}_]+)(.+)$`, 'iu').exec(tail);
      return match?.[1]?.trim() ? { note, text: match[1].trim() } : null;
    })
    .filter((value): value is { note: N; text: string } => value !== null);
  return found.length === 1 ? (found[0] ?? null) : null;
}

function placementOf(noun: RegExpExecArray | null): Placement {
  if (noun?.[3]) return { how: 'item', task: true, many: /s$|es$/i.test(noun[3]), target: null };
  // Group 2 is "items"/"bullets", group 5 is "bugs"/"issues": both are list
  // items. A bug request also carries its semantic area to list placement.
  if (noun?.[5]) return { how: 'item', task: false, many: /s$|ies$/i.test(noun[5]), target: null, near: 'bugs' };
  if (noun?.[2]) return { how: 'item', task: false, many: /s$|ies$/i.test(noun[2]), target: null };
  return { how: 'leave', task: false, many: false, target: null };
}

/**
 * What the words after the keyword ask for, or null when they don't say yet.
 * `notes` are the notes that can be named; `targets` the words plugins offer
 * after a note's name.
 */
export interface PlanOptions<N extends Candidate & { note?: { body: string } }> {
  notes: readonly N[];
  targets?: readonly string[];
  /** The note being recorded into, when it has a board: its lanes can be named (core/boards.ts). */
  board?: N | null;
}

export function planCommand<N extends Candidate & { note?: { body: string } }>(words: string, options: PlanOptions<N>): Plan<N> | null {
  const plan = readCommand(words, options);
  // What is added is words, not the end of a spoken sentence. Spoken quote
  // cues are user punctuation, not literal command prose.
  return plan?.kind === 'place'
    ? { ...plan, text: plan.text.replace(/\bquote\s+(.+?)\s+quote\b/gi, '"$1"').replace(/[\s.,;:!?]+$/, '') }
    : plan;
}

/** "Make this a board", "turn the list into a kanban board". */
const MAKE_BOARD = /^(?:make|turn|change)\s+(?:this|it|this\s+note|the\s+note|this\s+list|the\s+list)\s+(?:into\s+)?(?:a\s+)?(?:kanban\s+)?(?:board|kanban)[.!]?$/i;
/** "Move the pricing page to Done", "drag call Sam into doing". */
const MOVE_CARD = /^(?:move|drag|shift|put)\s+(.+?)\s+(?:to|into|in|onto|over\s+to)\s+(.+?)[.!?]*$/i;

/** A lane of `board`'s note by spoken name, with the score it won by. */
function laneNamed<N extends Candidate & { note?: { body: string } }>(name: string, board: N | null | undefined): { lane: Lane; score: number } | null {
  const body = board?.note?.body;
  if (!body) return null;
  return matchLane(name.replace(/[.,;:!?"“”]+/g, ' ').trim(), lanesOf(body));
}

/** A change to a lane, found again by name in the body it is given, which is the fresh one when it runs. */
function laneChange(lane: Lane, act: (body: string, lane: Lane) => string | null): (body: string) => string | null {
  return (body) => {
    const fresh = lanesOf(body).find((l) => l.name === lane.name && l.board === lane.board) ?? lanesOf(body).find((l) => l.name === lane.name);
    return fresh ? act(body, fresh) : null;
  };
}

function readCommand<N extends Candidate & { note?: { body: string } }>(words: string, { notes, targets = [], board = null }: PlanOptions<N>): Plan<N> | null {
  const text = stripStopCue(words.replace(LEAD, '').trim());
  if (!text) return null;
  if (MAKE_BOARD.test(text)) return { kind: 'board' };
  const createList = CREATE_LIST.exec(text);
  if (createList?.[1]) {
    const { title, items } = titleAndItems(createList[1].replace(/[.!?]+$/, '').trim());
    return title ? { kind: 'create-list', title, ...(items.length ? { items } : {}) } : null;
  }
  const addList = ADD_TO_LIST.exec(text);
  if (addList?.[1] && addList[2]) {
    const found = noteNamed(addList[1], notes);
    if (found) {
      const items = splitSpokenItems(addList[2], true);
      return { kind: 'place', note: found.note, text: items.join(', '), how: 'item', task: false, many: items.length > 1, target: null };
    }
  }
  // "Add to my note labeled Go a list with…" also reads as "add to <my note labeled Go a> list with…": when that name
  // is no note, the labeled note is the reading, and the no-note answer waits until it has failed too.
  const missing: Plan<N> | null = addList?.[1] && addList[2] ? { kind: 'no-note', name: addList[1].trim() } : null;
  const directAppend = DIRECT_APPEND.exec(text);
  if (directAppend?.[1]) {
    // 'labeled "Go" a list…': the quotes are the title's, not the words'.
    const named = /^["“]([^"”]+)["”]\s*(.*)$/.exec(directAppend[1]);
    const found = titledPrefix(named ? `${named[1]} ${named[2]}` : directAppend[1], notes);
    // "…my groceries list? Cauliflower…": the "list" or "note" after the title, and whatever mark Whisper put after
    // it, name the note; they are not the first thing added.
    if (found) return { kind: 'place', note: found.note, target: null, ...directPayload(found.text.replace(/^(?:[\s\p{P}]*\b(?:note|notes|list|page)\b(?=[\s\p{P}]|$))?[\s\p{P}]+/u, '').replace(/^[\s,:;.?!-]+/, '')) };
    // This unmistakable shape must fail closed when no unique title is found.
    return missing ?? { kind: 'no-note', name: directAppend[1].trim() };
  }
  if (missing) return missing;

  // "Move the pricing page to Done": a card, when the note being recorded has a board with that lane and no note by
  // that name is the better match.
  const moving = board ? MOVE_CARD.exec(text) : null;
  if (moving && board) {
    const lane = laneNamed(moving[2] ?? '', board);
    const note = noteNamed(moving[2] ?? '', notes);
    const item = (moving[1] ?? '').replace(/^(?:the|my|our)\s+/i, '').trim();
    if (lane && item && !/^(?:this|that|it|everything|these|those|them)$/i.test(item) && (!note || lane.score > note.score)) {
      return {
        kind: 'card',
        note: board,
        lane: lane.lane.name,
        words: item,
        change: laneChange(lane.lane, (body, fresh) => moveToLane(body, item, fresh)?.body ?? null),
      };
    }
  }
  // The phrase is committed: a command that stops after a name has ended.
  const ended = /[.!?]\s*$/.test(text) ? text : `${text}.`;
  const find = (name: string) => noteNamed(name, notes)?.note ?? null;

  // "Add a table to the AttackFM bugbash note (with columns bug, owner and status)".
  const table = TABLE.exec(text);
  if (table) {
    let tail = table[1] ?? '';
    let columns: string[] = [];
    const labelled = TABLE_COLUMNS.exec(tail);
    if (labelled) {
      columns = cellsOf(labelled[1] ?? '');
      tail = tail.slice(0, labelled.index);
    }
    const into = /^\s*(?:to|in|into|on|onto|for|under)\s+(.+?)[.!?]*\s*$/i.exec(tail);
    if (into?.[1]) {
      const found = noteNamed(into[1], notes);
      return found ? { kind: 'table', note: found.note, columns } : { kind: 'no-note', name: into[1].replace(/^(?:(?:the|my|our)\s+)+/i, '').replace(/\s+(?:note|page)$/i, '') };
    }
    return tail.replace(/[\s.!?]/g, '') ? null : { kind: 'table', note: null, columns };
  }

  const route = parseRoute(ended, { targets });
  if (route?.kind === 'new') return { kind: 'new' };
  if (route?.kind === 'item') {
    const note = find(route.name);
    if (!note) return { kind: 'no-note', name: route.name };
    const placement: Placement = { how: 'item', task: route.task, many: route.many, target: route.target };
    return route.rest ? { kind: 'place', note, text: route.rest, ...placement } : { kind: 'await', note, ...placement };
  }
  if (route?.kind === 'leave') {
    const note = find(route.name);
    if (!note) return { kind: 'no-note', name: route.name };
    const placement: Placement = { how: 'leave', task: false, many: false, target: null };
    return route.rest ? { kind: 'place', note, text: route.rest, ...placement } : { kind: 'await', note, ...placement };
  }

  // "Add buy milk to hello trade", "put a list item on the work list: call Sam":
  // every place the thing could end and the note's name begin, and the one
  // whose name is the best match for a note.
  const verb = /^\s*(?:add|put|stick|write|jot(?:\s+down)?|append|save|file|pop|drop|note|leave|send|move|switch|go|jump|change)\s+/i.exec(text);
  if (verb) {
    const after = text.slice(verb[0].length);
    let best: { note: N; score: number; thing: string; rest: string } | null = null;
    let bestLane: { lane: Lane; score: number; thing: string } | null = null;
    for (const split of after.matchAll(INTO)) {
      const thing = after.slice(0, split.index).trim();
      const tail = after.slice((split.index ?? 0) + split[0].length);
      // The name runs to a stop or colon, and anything after that is the thing too ("…to work: call Sam").
      const [, name = tail, rest = ''] = /^([^.,;:!?]+)(?:[.,;:!?]\s*(.*))?$/.exec(tail) ?? [];
      const target = targets.find((word) => new RegExp(String.raw`\s+(?:in|on|to|into)\s+${word}\s*$`, 'i').test(name)) ?? null;
      const found = noteNamed(target ? name.replace(new RegExp(String.raw`\s+(?:in|on|to|into)\s+${target}\s*$`, 'i'), '') : name, notes);
      if (found && (!best || found.score > best.score)) best = { ...found, thing, rest: rest.trim() };
      const lane = board && !rest.trim() ? laneNamed(name, board) : null;
      if (lane && thing && (!bestLane || lane.score > bestLane.score)) bestLane = { ...lane, thing };
    }
    // A lane of the board being recorded into, named better than any note: a card for it.
    if (board && bestLane && (!best || bestLane.score > best.score) && !MOVERS.test(text)) {
      const noun = OBJECT_NOUN.exec(bestLane.thing);
      const said = (noun ? bestLane.thing.slice(noun[0].length) : bestLane.thing).trim();
      const item = said.charAt(0).toUpperCase() + said.slice(1);
      if (item && !/^(?:this|that|it|everything|these|those|them)$/i.test(item)) {
        return {
          kind: 'lane',
          note: board,
          lane: bestLane.lane.name,
          words: item,
          change: laneChange(bestLane.lane, (body, fresh) => addToLane(body, fresh, item)?.body ?? null),
        };
      }
    }
    if (best) {
      if (MOVERS.test(text) && /^(?:this|that|it|everything|these|those|them)?$/i.test(best.thing) && !best.rest) return { kind: 'move', note: best.note };
      const noun = OBJECT_NOUN.exec(best.thing);
      const placement = placementOf(noun);
      const thing = [noun ? best.thing.slice(noun[0].length) : best.thing, best.rest].filter(Boolean).join(' ').trim();
      const bare = /^(?:this|that|it|everything|these|those|them)$/i.test(thing);
      return thing && !bare ? { kind: 'place', note: best.note, text: thing, ...placement } : { kind: 'await', note: best.note, ...placement };
    }
  }

  if (route?.kind === 'note') {
    const note = find(route.name);
    if (!note) return { kind: 'no-note', name: route.name };
    if (route.rest) return { kind: 'place', note, text: route.rest, how: 'leave', task: false, many: false, target: null };
    return MOVERS.test(text) ? { kind: 'move', note } : { kind: 'await', note, how: 'leave', task: false, many: false, target: null };
  }
  return null;
}
