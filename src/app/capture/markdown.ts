import { emojiFor } from '../core/emoji.ts';
import { matchNote } from './route.ts';

/**
 * Speech, turned into a note.
 *
 * Local rules, run on every committed Whisper segment with no network and no
 * delay: they catch the spoken cues the guide teaches ("new paragraph",
 * "bullet point", "heading", "check box", "bold … end bold"), the obvious
 * to-dos ("I need to..."), a spoken enumeration after a word that introduces
 * one ("I need eggs, milk and bread"), and an ordinal run ("first... second...
 * finally..."). Nothing else decides the shape of a note: it is what was said,
 * laid out by what was said.
 *
 * Deliberately heuristic and deliberately high-precision. A rule that turns a
 * sentence into a list it was not is worse than one that misses a list, because
 * a missed list is still readable prose and a false one mangles it; so the
 * enumeration rule demands a list-introducing word before the items, and short
 * items after it, rather than trusting commas.
 */

export interface Segment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface RenderedNote {
  markdown: string;
  /** Where the in-progress, uncommitted phrase begins, or null when there is none. */
  pendingFrom: number | null;
  /** The committed transcript, paragraphs joined by blank lines. */
  plain: string;
}

/**
 * A pause long enough to be a new thought, as the gap between two committed phrases.
 *
 * Not the pause itself. The streamer (src-tauri/src/whisper/stream.rs) cuts a phrase 300 ms into the quiet after it
 * and drops quiet once two seconds of it have built up, keeping 300 ms: so any pause from about 2.3 s to 4 s arrives
 * as a 1.7 s gap between the phrases, and a shorter one as none at all. At 2 s, as this once was, a paragraph break by
 * pausing could never happen on the phone. 1.5 s is a spoken pause of a little over two seconds.
 *
 * The engine commits a segment on a much shorter pause (about 600 ms), which is
 * a breath rather than a paragraph; treating every commit as a paragraph break
 * would turn a note into a column of one-line fragments. Two seconds is where
 * spoken notes measurably change subject - long enough that a speaker thinking
 * mid-sentence does not trigger it.
 */
export const PARAGRAPH_GAP_MS = 1500;

const PARAGRAPH_CUE = /\b(?:new|next) paragraph\b[.,!?]?/gi;

// ---- paragraphs and sentences ----------------------------------------------

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const stripEnd = (text: string): string => text.replace(/[\s.,;:!?]+$/, '');

/** Committed segments, grouped into paragraphs by pause length and spoken cue. */
export function toParagraphs(segments: readonly Segment[]): string[] {
  const paragraphs: string[] = [];
  let current = '';
  let lastEnd: number | null = null;

  const flush = () => {
    const text = current.trim();
    if (text) paragraphs.push(capitalise(text));
    current = '';
  };

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    if (lastEnd !== null && segment.startMs - lastEnd > PARAGRAPH_GAP_MS) flush();
    lastEnd = segment.endMs;

    text.split(PARAGRAPH_CUE).forEach((piece, index) => {
      if (index > 0) flush();
      const part = piece.replace(/^(?:[\s.,;:?]|!(?!\[))+/, '').trim();
      // A phrase after a finished sentence starts one, whatever case Whisper gave it.
      const said = current && /[.!?]$/.test(current) ? capitalise(part) : part;
      if (part) current = current ? `${current} ${said}` : said;
    });
  }
  flush();
  return paragraphs;
}

interface Sentence {
  text: string;
}

/**
 * The sentences of a paragraph.
 *
 * Whisper punctuates and capitalises, so a terminal mark followed by a capital
 * is a reliable boundary for speech in a way it is not for typed prose (which
 * has "e.g. Smith" and version numbers).
 */
function sentencesOf(paragraph: string): Sentence[] {
  const out: Sentence[] = [];
  // A sentence can now start with inline markup ("**Friday** is the
  // deadline"), so the lookahead allows asterisks and underscores before the
  // capital; without them the two sentences merged.
  const boundary = /(?<=[.!?*_\uE002])\s+(?=["'([*_]*[A-Z0-9])/g;
  let start = 0;
  for (const match of paragraph.matchAll(boundary)) {
    const end = match.index ?? 0;
    const text = paragraph.slice(start, end).trim();
    if (text) out.push({ text });
    start = end + match[0].length;
  }
  const tail = paragraph.slice(start).trim();
  if (tail) out.push({ text: tail });
  return out;
}

// ---- the local rules --------------------------------------------------------

const HEADING_CUE = /^(?:new\s+section|section|heading)[:,.]?\s+(.+)$/i;
const SUBHEADING_CUE = /^(?:sub[\s-]?heading|sub[\s-]?section|smaller\s+heading)[:,.]?\s+(.+)$/i;
const BULLET_CUE = /^(?:bullet(?:\s+point)?|(?:next|new)\s+(?:point|item|bullet))[:,.]?\s+(.+)$/i;
const TITLE_CUE = /^(?:title|note\s+title|call\s+(?:this|it)(?:\s+no(?:te|de))?)[:,.]?\s+(.+)$/i;
const IMPORTANT_CUE = /^(important|key\s+point|note)[:,]\s*(.+)$/i;
const TASK = /^(?:(?:i|we)\s+(?:really\s+)?(?:need|have|got)\s+to|remember\s+to|don'?t\s+forget\s+to|do\s+not\s+forget\s+to|remind\s+me\s+to|to[\s-]?do[:,]?|task[:,])\s+(.+)$/i;
const ORDINAL = /^(first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?|next|then|after\s+that|finally|lastly)[,:]?\s+(.+)$/i;
const ORDINAL_START = /^first(?:ly)?\b/i;

/*
 * Cues added for the "how to talk to Glyph" guide. Each one that could be
 * ordinary speech demands the comma or colon Whisper writes after a spoken
 * pause, because that pause is the only thing separating a command from a
 * sentence: "Number one, book flights" is a list item, "number one priority is
 * sleep" is prose, and only the comma tells them apart.
 */
const QUOTE_CUE = /^quote[:,]\s*(.+)$/i;
const NUMBER_CUE = /^number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})[:,]\s*(.+)$/i;
const CHECKBOX_CUE = /^(?:check(?:ed)?\s?box[:,.]?|checklist(?:\s+item)?[:,]|check\s+item[:,])\s*(.+)$/i;
const DIVIDER_CUE = /^(?:divider|horizontal\s+(?:line|rule)|separator)[.!]?$/i;
/** "Callout: the gate sticks", "warning callout: mind the step": a GitHub callout (`> [!NOTE]`), a note unless said otherwise. */
const CALLOUT_CUE = /^(?:(note|tip|important|warning|caution)\s+)?(?:callout[:,.]?|call[\s-]out[:,.]|info\s?box[:,.]?)\s*(.+)$/i;
/** "Hidden line: it was the butler": a line kept in smoke until it is tapped (`>|`). */
const HIDDEN_CUE = /^(?:hidden|secret|spoiler)\s+line[:,.]\s*(.+)$/i;
/** "Option: tent", "picked option: hotel": choices, one of them picked (`- ( )`, `- (x)`). */
const CHOICE_CUE = /^(?:(pick(?:ed)?|pict|chosen|selected)[\s-]*)?(?:option|choice|auction)[:,.]\s*(.+)$/i;
/** "Calculate: four hundred fifty plus one hundred twenty": a sum, worked out on the page (`= 450 + 120`). */
const SUM_CUE = /^(?:calculate|sum|add\s+up)[:,.]\s*(.+)$/i;
/**
 * "Done task: call Sam": a to-do already done (`- [x]`). A bare "done" is a reply, not a cue, and "checked box" is how
 * Whisper hears "check box" often enough that it stays an open one.
 */
const DONE_CUE = /^(?:ticked\s+(?:box|off|item)|done\s+(?:item|task|to[\s-]?do)|finished\s+(?:item|task|to[\s-]?do))[:,.]?\s+(.+)$/i;
/** "Define deposit as what you pay up front": a term and its meaning (`Deposit` / `: What you pay up front`). */
const DEFINE_CUE = /^(?:define|definition(?:\s+of)?)[:,]?\s+(?!(?:your|my|our|his|her|their|them|it|this|that|what|how|a|an)\b)(.+?)[,]?\s+(?:as|means|is)[:,]?\s+(.+)$/i;

/**
 * A cue said on its own, as its own sentence.
 *
 * The way people actually dictate a command is word, pause, content - and
 * Whisper writes the pause as a full stop, so "Heading. Groceries." arrives as
 * two sentences and the cue regexes above, which expect the content in the same
 * sentence, never saw it: the note got the literal word "Heading." Now a
 * sentence that is nothing but a cue is held and applied to the next sentence,
 * across a paragraph break if the pause was long.
 *
 * It doubles as the guard against prompt leakage. Whisper is prompted with the
 * cue vocabulary so it spells cue words consistently, and a model prompted with
 * words can echo them on a quiet window. An echoed "Bullet point." with nothing
 * after it is held forever and never rendered, instead of appearing in the note.
 */
const STANDALONE_CUE =
  /^(title|note\s+title|call\s+(?:this|it)(?:\s+no(?:te|de))?|heading|section|new\s+section|sub[\s-]?heading|sub[\s-]?section|call[\s-]?out|info\s?box|hidden\s+line|option|choice|(?:pick(?:ed)?|pict|chosen|selected)[\s-]*option|calculate|checked\s?box|ticked\s+box|done\s+(?:item|task|to[\s-]?do)|bullet(?:\s+point)?|(?:next|new)\s+(?:point|item|bullet)|quote|check\s?box|checklist(?:\s+item)?|check\s+item|to[\s-]?do|task|important|key\s+point|number\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2}))[.,:!]?$/i;

/** A plugin's formatting said the way bold is: its cue word, and the delimiter the words it wraps are put between. */
export interface SpokenFormat {
  word: string;
  delimiter: string;
}

/**
 * The plugin formattings that can be said, set by the recorder from the switched-on plugins (plugins/types.ts
 * `InlineFormat.cue`; the Spoiler plugin's "spoiler … end spoiler" wraps the words in `||`). Held here rather than
 * read from the registry so this file stays pure and testable.
 */
let spokenFormats: readonly SpokenFormat[] = [];

export function setSpokenFormats(formats: readonly SpokenFormat[]): void {
  spokenFormats = formats.filter((format) => /^[a-z][a-z ]*[a-z]$/i.test(format.word.trim()) && format.delimiter);
}

const escapeWord = (word: string) => word.trim().replace(/\s+/g, '\\s+');

/** How a cue word is heard as well as how it is spelled: "aside" comes back as "a side". */
const SAID_AS: Record<string, string> = { aside: 'a\\s?side', unsure: '(?:un|en|in)sure|onshore' };

function inlineMarkup(formats: readonly SpokenFormat[]): RegExp {
  const words = ['bold\\s+italics?', 'bold', 'italics?', 'emphasis', 'strike(?:through)?', 'crossed\\s+out', 'code', 'super\\s?script', 'sub\\s?script', 'maths?', ...formats.map((format) => SAID_AS[format.word.trim().toLowerCase()] ?? escapeWord(format.word))];
  const any = words.join('|');
  return new RegExp(`\\b(${any})\\b([.,:;!]?)\\s+([\\s\\S]+?)[.,;:!]?\\s+(end|and)\\s+(${any})\\b([.,;:!?]?)`, 'gi');
}

/** Which cue a spoken word is, however it was heard: "A side" is aside, "ensure" is unsure, "italics" is italic. */
function cueOf(word: string, formats: readonly SpokenFormat[]): string {
  const heard = word.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const format of formats) {
    const name = format.word.trim().toLowerCase().replace(/\s+/g, ' ');
    const alias = SAID_AS[name];
    if (heard === name || (alias && new RegExp(`^(?:${alias})$`, 'i').test(heard))) return name;
  }
  if (/^strike(?:through)?$|^crossed out$/.test(heard)) return 'strike';
  if (/^italics?$/.test(heard)) return 'italic';
  if (/^bold italics?$/.test(heard)) return 'bold italic';
  if (/^super ?script$/.test(heard)) return 'superscript';
  if (/^sub ?script$/.test(heard)) return 'subscript';
  if (/^maths?$/.test(heard)) return 'maths';
  return heard;
}

/** A cue word run into what follows it: "spoiler4417". */
function inlineGlued(formats: readonly SpokenFormat[]): RegExp {
  const words = ['bold', 'italic', 'strike', 'code', ...formats.map((format) => escapeWord(format.word))];
  return new RegExp(`\\b(${words.join('|')})(\\d)`, 'gi');
}

/**
 * Spoken inline markup: "bold ... end bold", "italic ... end italic", and a
 * plugin's own ("spoiler ... end spoiler", `setSpokenFormats`).
 *
 * Matched across a whole paragraph rather than inside one sentence, because a
 * speaker pauses around the words being marked and Whisper turns each pause
 * into a full stop - "the deadline is bold. Friday. End bold." - so a
 * sentence-level rule would never see both halves. Both halves are required:
 * "a bold move" has no "end bold" and is left alone. The punctuation Whisper
 * put after "end bold" is kept, so the sentence after it still starts a new
 * sentence.
 *
 * "and bold" also closes, when Whisper put a mark straight after the opening
 * word ("Italics, maybe, and italics.") or when it ends the sentence ("The
 * deadline is bold Friday at noon and bold."). The two words sound almost the
 * same, and on synthesised speech base.en wrote "and" for "end" in most voices
 * even with the cue vocabulary as its prompt. "It was bold thinking and bold action"
 * has neither a pause after the first "bold" nor the sentence ending at the
 * second, and is left alone.
 */
export function spokenInlineMarkup(paragraph: string, formats: readonly SpokenFormat[] = spokenFormats): string {
  // Whisper's own spellings of the cues: "italics" for "italic", "spoiler4417" run together.
  const heard = paragraph.replace(/\bitalics\b/gi, (word) => word.slice(0, -1)).replace(inlineGlued(formats), '$1 $2');
  return heard.replace(inlineMarkup(formats), (match, kind: string, paused: string, inner: string, closer: string, closing: string, after: string, offset: number, whole: string) => {
    const said = cueOf(kind, formats);
    // "A side … end aside" is one mark; "the gate code is spoiler … end spoiler" is not a code mark, but may hold one.
    if (cueOf(closing, formats) !== said) return `${kind}${spokenInlineMarkup(match.slice(kind.length), formats)}`;
    // "and bold" closes after a pause at the opening cue, or when it ends the sentence: "… at noon and bold." Mid-sentence, "bold thinking and bold action" is prose.
    // The other cue words are rare enough in speech that "and" closes them anywhere.
    const endsSentence = Boolean(after) || !whole.slice(offset + match.length).trim();
    const common = /^(?:bold|italic|emphasis)$/.test(said);
    // Three words or more between them is a stretch someone chose to mark: "bold thinking and bold action" is one.
    const marked = inner.trim().split(/\s+/).length >= 3;
    if (closer.toLowerCase() === 'and' && common && !paused && !endsSentence && !marked) return match;
    const words = inner.trim().replace(/[.,;:!]+$/, '');
    const format = formats.find((f) => f.word.trim().toLowerCase().replace(/\s+/g, ' ') === said);
    if (format) return `${format.delimiter}${words}${format.delimiter}${after}`;
    const marker = BUILT_IN_MARKERS[said] ?? '_';
    // Code is as it was said, lower case and without the commas Whisper puts at its pauses, as a command is typed.
    const inside =
      said === 'code' ? words.toLowerCase().replace(/,/g, '') : said === 'maths' ? spokenMaths(words) : said === 'superscript' || said === 'subscript' ? spokenScript(words) : words;
    // Raised and lowered words hang on the word before them: the 2^nd^, H~2~O.
    const glued = said === 'superscript' || said === 'subscript';
    return `${glued ? GLUE : ''}${marker}${inside}${marker}${glued && !after ? GLUE : ''}${after}`;
  })
    .replace(new RegExp(`\\s*${GLUE}(?=[\\^~])`, 'g'), '')
    // After the mark, only a short capital run is part of the same word (H~2~O); "the 2^nd^ of June" keeps its space.
    .replace(new RegExp(`${GLUE}\\s+(?=[A-Z0-9]{1,2}\\b)`, 'g'), '')
    .replaceAll(GLUE, '');
}

/** Where a raised or lowered mark joins its neighbours, while the paragraph is still being read. */
const GLUE = '\uE003';

const BUILT_IN_MARKERS: Record<string, string> = {
  'bold italic': '***',
  bold: '**',
  strike: '~~',
  code: '`',
  superscript: '^',
  subscript: '~',
  maths: '$',
};

/** Raised or lowered words: numbers as digits, and no bare space, which ends the mark (`^2nd^`, `~2~`, `^to\\ be^`). */
function spokenScript(text: string): string {
  // Said alone, "to" and "for" are the numbers: "metres superscript two" is heard "superscript to".
  const alone = { to: '2', too: '2', for: '4', won: '1' }[text.trim().toLowerCase()];
  if (alone) return alone;
  const said = text.trim().replace(new RegExp(`\\b${NUMBER_PHRASE}\\b`, 'gi'), (phrase) => {
    const value = spokenNumber(phrase);
    return value === null ? phrase : `${phrase.match(/^\s*/)?.[0] ?? ''}${value}${phrase.match(/\s*$/)?.[0] ?? ''}`;
  });
  return said.trim().replace(/(\d)\s+(?=(?:st|nd|rd|th)\b)/gi, '$1').replace(/\s+/g, '\\ ');
}

/** "x squared plus two y" as `x^2 + 2 y`: the operators as signs and the numbers as digits, the letters as said. */
function spokenMaths(text: string): string {
  let said = ` ${text.trim().toLowerCase()} `
    .replace(/\bsquared\b/g, '^2')
    .replace(/\bcubed\b/g, '^3')
    .replace(/\b(?:is\s+)?equals?(?:\s+to)?\b/g, ' = ')
    .replace(/\bsquare\s+root\s+of\b/g, ' \\sqrt ')
    .replace(/\bopen\s+brackets?\b/g, ' ( ')
    .replace(/\bclose\s+brackets?\b/g, ' ) ');
  // "x" is a letter here, not "times".
  for (const [word, symbol] of OPERATORS) if (!word.source.includes('x×')) said = said.replace(word, symbol);
  said = said.replace(new RegExp(`\\b${NUMBER_PHRASE}\\b`, 'gi'), (phrase) => {
    const value = spokenNumber(phrase.replace(/\s+and\s*$/, ''));
    return value === null ? phrase : ` ${value} `;
  });
  return said
    .replace(/\s*\^\s*/g, '^')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, none: 0, nil: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * A number said in words or written in digits: "four hundred fifty", "1,200", "twenty-one", "two thousand and five".
 * Null when it isn't one.
 */
export function spokenNumber(text: string): number | null {
  const said = text.trim().toLowerCase().replace(/,(?=\d{3})/g, '');
  if (/^\d+(?:\.\d+)?$/.test(said)) return Number(said);
  const words = said.split(/[\s-]+/).filter((word) => word && word !== 'and');
  if (!words.length) return null;
  // "Four four one seven" is a code read out a digit at a time: 4417, not 16.
  if (words.length > 1 && words.every((word) => (NUMBER_WORDS[word] ?? 99) < 10 || /^\d$/.test(word))) {
    return Number(words.map((word) => (/^\d$/.test(word) ? word : String(NUMBER_WORDS[word]))).join(''));
  }
  let total = 0;
  let group = 0;
  for (const word of words) {
    if (word in NUMBER_WORDS) group += NUMBER_WORDS[word]!;
    else if (word === 'hundred') group = (group || 1) * 100;
    else if (word === 'thousand') {
      total += (group || 1) * 1000;
      group = 0;
    } else if (word === 'million') {
      total += (group || 1) * 1_000_000;
      group = 0;
    } else if (/^\d+(?:\.\d+)?$/.test(word)) group += Number(word);
    else return null;
  }
  return total + group;
}

const NUMBER_PHRASE = String.raw`(?:\d[\d,]*(?:\.\d+)?|(?:(?:zero|none|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and)[\s-]*)+)`;

/** "Counter three of eight": a counter (`[3/8]`), at the end of what it counts. */
const COUNTER_SAID = new RegExp(String.raw`[.,;]?\s*\bcounter\s+(${NUMBER_PHRASE})\s+(?:of|out\s+of)\s+(${NUMBER_PHRASE})(?=[\s.,;:!?]|$)`, 'gi');

/** "Hashtag travel": a tag. Whisper often writes "#travel" itself, which is left as it is. */
const TAG_SAID = /\bhash[\s-]?tag\s+([A-Za-z][\w-]*)/gi;

/** "Note link weekend trip end link": a link to another note (`[[Weekend trip]]`). */
const NOTE_LINK_SAID = /\b(?:no(?:te|de)\s?link|link\s+to\s+note)[,:]?\s+(.+?)[.,]?\s+(?:end|and)\s+link\b/gi;

/** Titles of the notes a spoken link can name, set by the recorder: a link takes the note's own spelling. */
let linkTitles: readonly string[] = [];

export function setLinkTitles(titles: readonly string[]): void {
  linkTitles = titles;
}

/** "Item link ask Sam end link": a link to a line of this note by its name (`[[#^ask-sam]]`, editor/boards.ts). */
const ITEM_LINK_SAID = /\bitem\s?link[,:]?\s+(.+?)[.,]?\s+(?:end|and)\s+link\b/gi;

/** "Link Glyph to attack dot fm end link", "link attack dot fm end link": a link to a page. */
const LINK_SAID = /\blink[,:]?\s+(.+?)[.,]?\s+(?:end|and)\s+link\b/gi;

/** "Anchor ship page end anchor": the line's own name (` ^ship-page`), moved to the end of its line when the note is laid out. */
const ANCHOR_SAID = /[.,]?\s*\b(?:anchor|item\s+name)[,:]?\s+(.+?)[.,]?\s+(?:end|and)\s+(?:anchor|name)\b([.,!?]?)/gi;

/** "Bookmark this", "bookmark here", at the end of what it marks: the note's bookmark (`§§`, editor/bookmarkLine.ts). */
const BOOKMARK_SAID = /[.,]?\s*\bbookmark\s+(?:this(?:\s+line)?|here)\b(?=[.,!?]|\s*$)([.,!?]?)/gi;

/** "Emoji party popper": the emoji by its name, as a shortcode (`:tada:`, core/emoji.ts). */
const EMOJI_SAID = /\bemoji[,:]?\s+([A-Za-z]+(?:[\s-]+[A-Za-z]+){0,3})/gi;

/** "… end unsure, note Sam said four hundred, end note": what a mark means, shown on a tap (`??four hundred??(Sam said…)`). */
const MARK_NOTE_SAID = /(\?\?|==|%%|\*\*|\^\^|\+\+|~~|\|\||\b_)[.,]?\s+(?:with\s+(?:a\s+)?)?note[,:]?\s+(.+?)[.,]?\s+(?:end|and)\s+note\b/gi;

/** "…, new line, …" with a pause either side: a line break inside the paragraph. "A new line of shoes" is words. */
const LINE_BREAK_SAID = /(^|[.,;!?])\s*\b(?:new|next)\s+line\b[.,;!]?(?=\s|$)/gi;

/** Stand-ins while a note is laid out: a line's name, the bookmark, a line break (`finishLines`). */
const ANCHOR_MARK = '\uE000';
const BOOKMARK_MARK = '\uE001';
const BREAK_MARK = '\uE002';

/** The spoken names people give emoji, where they differ from the shortcode. */
const EMOJI_SAID_AS: Record<string, string> = {
  thumbs_up: '+1',
  thumbs_down: '-1',
  party: 'tada',
  party_popper: 'tada',
  celebration: 'tada',
  check: 'white_check_mark',
  check_mark: 'white_check_mark',
  tick: 'white_check_mark',
  cross: 'x',
  cross_mark: 'x',
  light_bulb: 'bulb',
  laughing: 'joy',
  crying: 'sob',
  smiley: 'smile',
  money_bag: 'moneybag',
  magnifying_glass: 'mag',
  lightning: 'zap',
  plane: 'airplane',
  sun: 'sunny',
  pin: 'pushpin',
};

/** A spoken name as a line's name: "Ship Page" is `ship-page`, as said (core/boards.ts reads `[a-z0-9][a-z0-9_-]*`). */
export function spokenSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "attack dot fm slash glyph" as `https://attack.fm/glyph`, or null when it isn't an address. */
export function spokenAddress(text: string): string | null {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/\s*\b(?:dot)\b\s*/g, '.')
    .replace(/\s*\b(?:forward\s+)?slash\b\s*/g, '/')
    .replace(/\s*\bcolon\b\s*/g, ':')
    .replace(/\s*\b(?:dash|hyphen)\b\s*/g, '-')
    .replace(/\s*\bunderscore\b\s*/g, '_')
    .replace(/\s*([./:])\s*/g, '$1')
    .replace(/[.,]+$/, '');
  // Words still apart are words: "Glyph to attack.fm" is a name and an address, not one address.
  if (!/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/.test(said)) return null;
  return /^https?:\/\//.test(said) ? said : `https://${said}`;
}

function spokenEmoji(all: string, words: string): string {
  const said = words.toLowerCase().split(/[\s-]+/);
  for (let take = said.length; take >= 1; take -= 1) {
    const name = said.slice(0, take).join('_');
    const code = EMOJI_SAID_AS[name] ?? (emojiFor(name) ? name : null);
    if (code) {
      const rest = words.split(/[\s-]+/).slice(take).join(' ');
      return `:${code}:${rest ? ` ${rest}` : ''}`;
    }
  }
  return all;
}

/** Tags, counters, links, emoji and the other marks said inside a sentence, written as what they are. */
export function spokenExtras(paragraph: string): string {
  return paragraph
    .replace(ITEM_LINK_SAID, (all, name: string) => {
      const slug = spokenSlug(name);
      return slug ? `[[#^${slug}]]` : all;
    })
    .replace(NOTE_LINK_SAID, (_all, name: string) => {
      const said = name.trim().replace(/^(?:the|my|our)\s+/i, '').replace(/\s+note$/i, '');
      const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      // The note's own spelling, and the closest title when the name was misheard ("week and trip").
      const known = linkTitles.find((title) => plain(title) === plain(said)) ?? matchNote(said, linkTitles.map((title) => ({ id: title, title })))?.note.title;
      return `[[${known ?? capitalise(said)}]]`;
    })
    .replace(LINK_SAID, (all, inner: string) => {
      const bare = spokenAddress(inner);
      if (bare) return `<${bare}>`;
      // "Glyph to attack dot fm": the words, then where they go, split at the last "to" that leaves an address.
      const parts = inner.split(/\s+to\s+/i);
      for (let at = parts.length - 1; at >= 1; at -= 1) {
        const address = spokenAddress(parts.slice(at).join(' to '));
        const words = parts.slice(0, at).join(' to ').trim();
        if (address && words) return `[${words}](${address})`;
      }
      return all;
    })
    .replace(MARK_NOTE_SAID, (_all, mark: string, note: string) => `${mark}(${note.trim()})`)
    .replace(ANCHOR_SAID, (all, name: string, after: string) => {
      const slug = spokenSlug(name);
      return slug ? `${ANCHOR_MARK}${slug}${ANCHOR_MARK}${after}` : all;
    })
    .replace(BOOKMARK_SAID, (_all, after: string) => `${BOOKMARK_MARK}${after}`)
    .replace(EMOJI_SAID, spokenEmoji)
    .replace(LINE_BREAK_SAID, (_all, before: string) => `${before && /[.!?]/.test(before) ? before : before ? '.' : ''}${BREAK_MARK}`)
    .replace(TAG_SAID, (_all, word: string) => `#${word.toLowerCase()}`)
    .replace(COUNTER_SAID, (all, count: string, goal: string) => {
      const n = spokenNumber(count);
      const m = spokenNumber(goal);
      return n === null || m === null || m < 1 ? all : ` [${n}/${m}]`;
    });
}

/**
 * The stand-ins put back as marks, once the note is laid out: a line break where one was said, a line's name at the
 * end of its line (after the bookmark, as core/boards.ts reads it), and the bookmark on the last line it was said on,
 * since a note holds one.
 */
export function finishLines(body: string): string {
  const lines = body
    .replace(new RegExp(`${BREAK_MARK} *(\\S)`, 'g'), (_all, next: string) => `  \n${next.toUpperCase()}`)
    .replaceAll(BREAK_MARK, '')
    .split('\n');
  let marked = -1;
  lines.forEach((line, index) => {
    if (line.includes(BOOKMARK_MARK)) marked = index;
  });
  const used = new Set<string>();
  const nameOn = new RegExp(`${ANCHOR_MARK}([^${ANCHOR_MARK}]*)${ANCHOR_MARK}`, 'g');
  return lines
    .map((line, index) => {
      const names = [...line.matchAll(nameOn)].map((found) => found[1] ?? '');
      if (!names.length && !line.includes(BOOKMARK_MARK)) return line;
      const broken = line.endsWith('  ');
      let text = line
        .replace(nameOn, '')
        .replaceAll(BOOKMARK_MARK, '')
        .replace(/\s+([.,;!?])/g, '$1')
        .replace(/ {2,}/g, ' ')
        .trimEnd();
      // A list item's words end without a stop, before its bookmark and name.
      if (/^\s*(?:[-*+]|\d+[.)])\s/.test(text)) text = text.replace(/[.,;]+$/, '');
      if (index === marked) text += ' §§';
      const name = names[names.length - 1];
      if (name) {
        let unique = name;
        for (let count = 2; used.has(unique); count += 1) unique = `${name}-${count}`;
        used.add(unique);
        text += ` ^${unique}`;
      }
      return broken ? `${text}  ` : text;
    })
    .join('\n');
}

const OPERATORS: [RegExp, string][] = [
  [/\bto\s+the\s+power\s+of\b/gi, ' ^ '],
  [/\b(?:multiplied\s+by|times)\b/gi, ' * '],
  [/\b(?:divided\s+by|over)\b/gi, ' / '],
  [/\bplus\b/gi, ' + '],
  [/\bminus\b/gi, ' - '],
  [/\s[x×]\s/g, ' * '],
  [/÷/g, ' / '],
];

/** "Four hundred fifty plus one hundred twenty times two" as `450 + 120 * 2`, or null when it isn't a sum. */
export function spokenSum(text: string): string | null {
  let said = ` ${text.trim().replace(/[.?!]+$/, '')} `;
  for (const [word, symbol] of OPERATORS) said = said.replace(word, symbol);
  const parts = said.split(/\s*([-+*/^()])\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => /^[-+*/^]$/.test(part))) return null;
  const out: string[] = [];
  for (const part of parts) {
    if (/^[-+*/^()]$/.test(part)) {
      out.push(part);
      continue;
    }
    const sign = /^[$€£]/.exec(part)?.[0] ?? '';
    const percent = /%$|\s+percent$/i.test(part) ? '%' : '';
    const value = spokenNumber(part.replace(/^[$€£]/, '').replace(/%$|\s+percent$/i, ''));
    if (value === null) return null;
    out.push(`${sign}${value}${percent}`);
  }
  return out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
}

/**
 * Words after which a comma-separated run is a list rather than a clause.
 *
 * The whole precision of the enumeration rule rests here. "I need eggs, milk
 * and bread" is a list because of "need"; "we went to the store, bought food,
 * and came home" has the same commas and is not, and the difference is that
 * nothing before its first comma introduces a list.
 */
const LIST_INTRO = /\b(?:need|needs|want|wants|buy|get|grab|bring|pack|include|includes|including|like|such\s+as|are|were|is|was|with|pick\s+up)$/i;

/*
 * Lists said the way people actually say them, not in cue words. Matt's first
 * real list on the Fold was "list item is weed", "the next list item is …"
 * and "and lastly, the final item that we need on our list is a gallon of
 * black coffee": all prose under the cue rules, because nobody says "bullet
 * point" to a phone.
 *
 * An item phrase names an item and then gives it: "list item is X", "the next
 * item is X", "another one is X", "item number three is X", "the last thing
 * we need on the list is X". Still high precision: a bare "item" or "thing"
 * needs an ordinal or the word "list" with it, so "the thing is, I'm tired"
 * and "the item is broken" stay sentences.
 */
const LEADERS = String.raw`(?:(?:and|so|ok(?:ay)?|also|plus|then|lastly|finally|next|oh)[,\s]+)*`;
const ARTICLE = String.raw`(?:(?:the|a|an|my|our)\s+)?`;
const ORDINAL_WORD = String.raw`(?:first|second|third|fourth|fifth|sixth|next|last|final|another|other|new|1st|2nd|3rd|4th|5th)`;
const COUNT_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})`;
const NAMED_ITEM = [
  // "list item", "the next list item", "list item number two"
  String.raw`(?:${ORDINAL_WORD}\s+)?list\s+(?:item|entry)(?:\s+(?:number\s+)?${COUNT_WORD})?`,
  // "the next item", "another thing", "the final one", "item number two"
  String.raw`${ORDINAL_WORD}\s+(?:item|thing|entry|one)(?:\s+(?:number\s+)?${COUNT_WORD})?`,
  String.raw`item\s+number\s+${COUNT_WORD}`,
  // "the item on the list", "the thing we need on our list"
  String.raw`(?:item|thing)(?=.*\b(?:on|in|for|to)\s+(?:the|our|my|this)\s+(?:\w+\s+)?list\b)`,
].join('|');
const WHICH = String.raw`(?:\s+(?:that\s+|which\s+)?(?:we|i|you)(?:'ll|\s+will)?\s+(?:really\s+)?(?:need|want|have|should\s+get|need\s+to\s+(?:get|buy|add|grab))(?:\s+to\s+(?:get|buy|add|grab))?)?`;
const ON_LIST = String.raw`(?:\s+(?:on|in|for|to)\s+(?:the|our|my|this)\s+(?:\w+\s+)?list)?`;
const ITEM_PHRASE = new RegExp(String.raw`^${LEADERS}${ARTICLE}(?:${NAMED_ITEM})${WHICH}${ON_LIST}\s*(?:is|are|will\s+be|would\s+be|should\s+be|[:,-])\s+(.+)$`, 'i');

/**
 * An item phrase that stops before its item: "The next item is." Whisper
 * commits a phrase at a breath, so "the next item is … Paris" arrives as two:
 * the phrase, then the item. Held, and the next sentence is taken as the item.
 */
const ITEM_OPENER = new RegExp(String.raw`^${LEADERS}${ARTICLE}(?:${NAMED_ITEM})${WHICH}${ON_LIST}\s*(?:is|are|will\s+be|would\s+be|should\s+be)?\s*[.:,-]?\s*$`, 'i');

/**
 * Whisper's own numbering, written inline when it hears a list being
 * dictated: "1. The Grand Canyon 2. Spain 3. The next item is". Two or more
 * markers counting up one at a time are that; each piece becomes a spoken
 * "number N," cue so the numbered rule lays it out, and a piece that is only
 * an item phrase is left for the next phrase to finish. A year ("1990.") or
 * a lone "2." in a sentence is not a run.
 */
export function inlineNumbering(paragraph: string): string {
  const markers = [...paragraph.matchAll(/(^|\s)(\d{1,2})\.\s+(?=\S)/g)];
  if (markers.length < 2) return paragraph;
  const numbers = markers.map((m) => Number(m[2]));
  if (numbers.some((n, i) => i > 0 && n !== (numbers[i - 1] ?? 0) + 1)) return paragraph;
  const starts = markers.map((m) => (m.index ?? 0) + (m[1] ?? '').length);
  const prefix = paragraph.slice(0, starts[0]).trim();
  const pieces = markers.map((m, i) => {
    const bodyStart = (m.index ?? 0) + m[0].length;
    const end = i + 1 < starts.length ? starts[i + 1] : paragraph.length;
    const text = stripEnd(paragraph.slice(bodyStart, end).trim());
    if (!text) return '';
    return ITEM_OPENER.test(text) ? `${capitalise(text)}.` : `Number ${numbers[i]}, ${text}.`;
  });
  return [prefix, ...pieces].filter(Boolean).join(' ');
}

/** The item an item phrase gives, or null: "The next list item is oat milk." is "Oat milk". */
export function itemOf(text: string): string | null {
  const match = ITEM_PHRASE.exec(text.trim());
  const item = match?.[1] ? stripEnd(match[1].trim()) : '';
  return item ? capitalise(item) : null;
}

/**
 * A sentence that announces a list: "add a list below", "here's my shopping
 * list", "make a numbered list". Its own words stay; the short sentences after
 * it are taken as the list's items until a longer one ends it.
 */
const LIST_ANNOUNCE =
  /\b(?:add|make|start|create|write|begin|do)\s+(?:up\s+)?(?:a|an|the|my|our|this|another)?\s*(?:new\s+|quick\s+)?(?:(numbered|numbering|ordered|bullet(?:ed)?|bullet\s+point|shopping|grocery|to-?\s?do|packing|reading|check)\s+)?list\b|\b(?:here(?:'s|\s+is)|this\s+is|that'?s)\s+(?:a|the|my|our)\s+(?:(numbered|\w+)\s+)?list\b/i;

/** Whether `text` announces a list, and whether it asked for numbers. */
/** "Pack these.", "we need the following.": a list said with its colon heard as a full stop. */
const LIST_LEAD = /^(?:[a-z]+\s+){0,4}(?:these|the\s+following|as\s+follows)[.:]?$/i;

function announcesList(text: string): 'number' | 'bullet' | null {
  if (LIST_LEAD.test(text.trim()) && LIST_INTRO.test(text.trim().replace(/\s+(?:these|the\s+following|as\s+follows)[.:]?$/i, ''))) return 'bullet';
  const match = LIST_ANNOUNCE.exec(text);
  if (!match) return null;
  const kind = (match[1] ?? match[2] ?? '').toLowerCase();
  return /^(?:numbered|numbering|ordered)$/.test(kind) ? 'number' : 'bullet';
}

/** Short enough, and noun-shaped enough, to be an item in a list someone announced. */
const MAX_OPEN_ITEM_WORDS = 5;
function itemShaped(text: string): boolean {
  const body = stripEnd(text);
  if (!body || words(body) > MAX_OPEN_ITEM_WORDS || /\?\s*$/.test(text)) return false;
  // "I'm tired", "It works", "That's it": a sentence, not an item.
  return !/^(?:i|i'm|im|we|we're|you|he|she|it|it's|they|this|that|that's|there|there's|so|and\s+then)\b/i.test(body);
}

const MAX_ITEM_WORDS = 4;
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** "I need eggs, milk, bread and coffee" as an intro and its items, or null. */
export function enumeration(sentence: string): { intro: string; items: string[] } | null {
  const body = stripEnd(sentence);
  if (words(body) > 40) return null;

  let introPart: string;
  let listPart: string;

  const colon = body.indexOf(':');
  if (colon > 0) {
    introPart = body.slice(0, colon);
    listPart = body.slice(colon + 1);
  } else {
    const chunks = body.split(/,\s*/);
    if (chunks.length < 2) return null;
    const first = chunks[0] ?? '';
    // The intro is everything up to and including the LAST list-introducing
    // word in the first chunk; what follows it is the first item.
    const tokens = first.split(/\s+/);
    let cut = -1;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      if (LIST_INTRO.test(tokens.slice(0, i + 1).join(' '))) {
        cut = i;
        break;
      }
    }
    // "Pack these, the tent, …": "these" points at the list, so it belongs to the intro, not the first item.
    const pointsAtList = cut >= 0 && /^(?:these|those|the\s+following)$/i.test(tokens.slice(cut + 1).join(' '));
    if (cut < 0 || (cut === tokens.length - 1 && !pointsAtList)) return null;
    if (pointsAtList) {
      introPart = first;
      listPart = chunks.slice(1).join(', ');
    } else {
      introPart = tokens.slice(0, cut + 1).join(' ');
      listPart = [tokens.slice(cut + 1).join(' '), ...chunks.slice(1)].join(', ');
    }
  }

  const items = listPart
    .split(/,\s*|\s+(?:and|or)\s+/i)
    .map((item) => item.replace(/^(?:and|or)\s+/i, '').trim())
    .filter(Boolean);

  if (items.length < 3) return null;
  if (items.some((item) => words(item) > MAX_ITEM_WORDS)) return null;
  // A final conjunction is what makes it spoken-list shaped at all.
  if (colon < 0 && !/\s(?:and|or)\s/i.test(listPart)) return null;

  return { intro: capitalise(introPart.trim()), items };
}

// ---- blocks ------------------------------------------------------------------

type Block =
  | { kind: 'para'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  /** One entry of a spoken enumeration: a bullet that belongs to its intro, not to its neighbours. */
  | { kind: 'item'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'task'; text: string }
  | { kind: 'intro'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule'; text: string }
  | { kind: 'subheading'; text: string }
  /** A line that stands out ("Important: …"): its own paragraph, never run into the next. */
  | { kind: 'standout'; text: string }
  | { kind: 'callout'; text: string; type: string }
  | { kind: 'hidden'; text: string }
  | { kind: 'choice'; text: string; picked: boolean }
  | { kind: 'sum'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'definition'; text: string; term: string }
  | { kind: 'fence'; text: string; lang: string };

/**
 * Which run a block belongs to, for deciding where blank lines go.
 *
 * An enumeration is its own family, separate from spoken bullets and to-dos,
 * because it is a CLOSED list: "for the drive we want snacks, water and a
 * charger" is complete when the sentence ends. Sharing a family let the next
 * sentence's to-do ("ask Sam about the dog") render as a fifth item of the
 * snacks list, which is a claim about the note Matt never made. Spoken bullets
 * and to-dos, by contrast, are open lists that grow a sentence at a time, so
 * consecutive ones do merge.
 */
const family = (block: Block): string => {
  switch (block.kind) {
    case 'item':
    case 'intro':
      return 'items';
    case 'bullet':
    case 'task':
    case 'done':
      return 'bullets';
    case 'number':
      return 'numbers';
    case 'quote':
      return 'quotes';
    case 'choice':
      return 'choices';
    case 'hidden':
      return 'hidden';
    default:
      return block.kind;
  }
};

/**
 * Blocks for one sentence under the local rules.
 *
 * `ordinalRun` is decided per paragraph by the caller, because "then" and
 * "next" only start list items once a "first" has made the run a list; on
 * their own they are just how people join clauses.
 */
function localBlocks(text: string, ordinalRun: boolean): Block[] {
  const heading = HEADING_CUE.exec(text);
  if (heading?.[1]) return [{ kind: 'heading', text: capitalise(stripEnd(heading[1])) }];

  const subheading = SUBHEADING_CUE.exec(text);
  if (subheading?.[1]) return [{ kind: 'subheading', text: capitalise(stripEnd(subheading[1])) }];

  const callout = CALLOUT_CUE.exec(text);
  if (callout?.[2]) return [{ kind: 'callout', type: (callout[1] ?? 'note').toLowerCase(), text: capitalise(callout[2].trim()) }];

  const hidden = HIDDEN_CUE.exec(text);
  if (hidden?.[1]) return [{ kind: 'hidden', text: capitalise(hidden[1].trim()) }];

  const choice = CHOICE_CUE.exec(text);
  if (choice?.[2]) return [{ kind: 'choice', picked: Boolean(choice[1]), text: capitalise(stripEnd(choice[2])) }];

  const sum = SUM_CUE.exec(text);
  const worked = sum?.[1] ? spokenSum(sum[1]) : null;
  if (worked) return [{ kind: 'sum', text: `= ${worked}` }];

  const done = DONE_CUE.exec(text);
  if (done?.[1]) return [{ kind: 'done', text: itemOf(done[1]) ?? capitalise(stripEnd(done[1])) }];

  const defined = DEFINE_CUE.exec(text);
  if (defined?.[1] && defined[2] && words(defined[1]) <= 3) return [{ kind: 'definition', term: capitalise(stripEnd(defined[1])), text: capitalise(defined[2].trim()) }];

  const bullet = BULLET_CUE.exec(text);
  if (bullet?.[1]) return [{ kind: 'bullet', text: itemOf(bullet[1]) ?? capitalise(stripEnd(bullet[1])) }];

  const important = IMPORTANT_CUE.exec(text);
  if (important?.[1] && important[2]) {
    return [{ kind: 'standout', text: `**${capitalise(important[1])}:** ${capitalise(important[2])}` }];
  }

  if (DIVIDER_CUE.test(text)) return [{ kind: 'rule', text: '---' }];

  const quote = QUOTE_CUE.exec(text);
  if (quote?.[1]) return [{ kind: 'quote', text: capitalise(quote[1].trim()) }];

  const numbered = NUMBER_CUE.exec(text);
  if (numbered?.[2]) return [{ kind: 'number', text: itemOf(numbered[2]) ?? capitalise(stripEnd(numbered[2])) }];

  const checkbox = CHECKBOX_CUE.exec(text);
  if (checkbox?.[1]) return [{ kind: 'task', text: itemOf(checkbox[1]) ?? capitalise(stripEnd(checkbox[1])) }];

  const task = TASK.exec(text);
  if (task?.[1]) return [{ kind: 'task', text: capitalise(stripEnd(task[1])) }];

  if (ordinalRun) {
    const ordinal = ORDINAL.exec(text);
    if (ordinal?.[2]) return [{ kind: 'number', text: capitalise(stripEnd(ordinal[2])) }];
  }

  const list = enumeration(text);
  if (list) {
    return [
      { kind: 'intro', text: `${list.intro}:` },
      ...list.items.map((item): Block => ({ kind: 'item', text: item })),
    ];
  }

  return [{ kind: 'para', text }];
}

/**
 * `paragraphStarts` holds the index of the first block each spoken paragraph
 * produced. Sentences of one paragraph arrive as separate prose blocks and are
 * joined back into one line; two prose blocks either side of a paragraph break
 * (a spoken "new paragraph", or a long pause) must not be.
 */
function renderBlocks(blocks: readonly Block[], paragraphStarts: ReadonlySet<number> = new Set()): string {
  const out: string[] = [];
  let previous: Block | null = null;
  let number = 0;

  for (const [index, block] of blocks.entries()) {
    if (block.kind !== 'number') number = 0;
    const joined = previous?.kind === 'para' && block.kind === 'para' && !paragraphStarts.has(index);
    // An intro always opens a new run. Written straight under a list line,
    // markdown reads "For food we want:" as a lazy continuation of the item
    // above it rather than as the start of a new list - it rendered inside a
    // to-do before this rule existed.
    const sameRun =
      previous !== null &&
      family(previous) === family(block) &&
      block.kind !== 'para' &&
      block.kind !== 'intro' &&
      block.kind !== 'standout' &&
      block.kind !== 'callout' &&
      block.kind !== 'sum' &&
      block.kind !== 'fence' &&
      block.kind !== 'heading' &&
      block.kind !== 'subheading';

    if (joined) {
      out[out.length - 1] = `${out[out.length - 1]} ${block.text}`;
    } else {
      if (previous !== null && !sameRun) out.push('');
      switch (block.kind) {
        case 'heading':
          out.push(`## ${block.text}`);
          break;
        case 'bullet':
        case 'item':
          out.push(`- ${block.text}`);
          break;
        case 'task':
          out.push(`- [ ] ${block.text}`);
          break;
        case 'done':
          out.push(`- [x] ${block.text}`);
          break;
        case 'definition':
          out.push(block.term, `: ${block.text}`);
          break;
        case 'fence':
          out.push(`\`\`\`${block.lang}`, block.text, '```');
          break;
        case 'number':
          number += 1;
          out.push(`${number}. ${block.text}`);
          break;
        case 'quote':
          out.push(`> ${block.text}`);
          break;
        case 'subheading':
          out.push(`### ${block.text}`);
          break;
        case 'callout':
          out.push(`> [!${block.type.toUpperCase()}]`, `> ${block.text}`);
          break;
        case 'hidden':
          out.push(`>| ${block.text}`);
          break;
        case 'choice':
          out.push(`- (${block.picked ? 'x' : ' '}) ${block.text}`);
          break;
        case 'rule':
          // Always behind a blank line (a different family from anything
          // before it): `---` straight under a line of text is a setext
          // underline, which would turn that text into a heading.
          out.push('---');
          break;
        default:
          out.push(block.text);
      }
    }
    previous = block;
  }
  return out.join('\n');
}

/** "Footnote Sam said so end footnote": a footnote marker where it was said, its words under the note. */
const FOOTNOTE_SAID = /([.!?]?)[,]?\s*\bfoot\s?note[,:.]?\s+(.+?)[.,]?\s+(?:end|and)\s+foot\s?note\b([.,!?]?)/gi;

const CODE_LANGUAGES = String.raw`java\s?script|type\s?script|python|rust|bash|shell|json|html|css|sql|swift|kotlin|yaml|ruby|go`;

/** "Code block in bash. npm run build. End code block.": a block of code, a line for each sentence said. */
const CODE_BLOCK_SAID = new RegExp(
  String.raw`\bcode\s?block\b[.,:]?\s*(?:(?:in\s+|and\s+)?(${CODE_LANGUAGES})\b[.,:]?\s*)?([\s\S]*?)[.,;]?\s*\b(?:end|and)\s+code\s?block\b[.,!]?`,
  'gi',
);
const CODE_BLOCK_OPEN = /\bcode\s?block\b/gi;
const CODE_BLOCK_CLOSE = /\b(?:end|and)\s+code\s?block\b/gi;

/** Paragraphs with a spoken code block kept in one, however long the pauses inside it were. */
function withCodeBlocksWhole(paragraphs: readonly string[]): string[] {
  const out: string[] = [];
  let open = false;
  for (const paragraph of paragraphs) {
    if (open) out[out.length - 1] = `${out[out.length - 1]} ${paragraph}`;
    else out.push(paragraph);
    const opened = (out[out.length - 1]!.match(CODE_BLOCK_OPEN) ?? []).length;
    const closed = (out[out.length - 1]!.match(CODE_BLOCK_CLOSE) ?? []).length;
    open = opened > closed;
  }
  return out;
}

type Piece = { kind: 'text'; text: string } | Extract<Block, { kind: 'fence' }>;

/** A paragraph cut around the code blocks said in it. */
function codeBlocksIn(paragraph: string): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  for (const found of paragraph.matchAll(CODE_BLOCK_SAID)) {
    const code = (found[2] ?? '')
      .split(/(?<=[.;!?])\s+/)
      .map((line) => line.trim().replace(/[.;,]+$/, '').replace(/,/g, '').toLowerCase())
      .filter(Boolean);
    if (!code.length) continue;
    const before = paragraph.slice(from, found.index).trim();
    if (before) pieces.push({ kind: 'text', text: before });
    pieces.push({ kind: 'fence', lang: (found[1] ?? '').toLowerCase().replace(/\s+/g, ''), text: code.join('\n') });
    from = (found.index ?? 0) + found[0].length;
  }
  const rest = paragraph.slice(from).trim();
  if (rest || !pieces.length) pieces.push({ kind: 'text', text: capitalise(rest) });
  return pieces;
}

// ---- the whole note -------------------------------------------------------------

/**
 * Committed segments and an optional in-progress phrase, rendered to markdown.
 *
 * Pure, and cheap enough to run on every event: a note is a few hundred words
 * and the engine emits about one event a second.
 */
export interface RenderOptions {
  /**
   * Whether the note may take a `# title`. False for a recording added to the
   * end of an existing note (capture/continuation.ts): its opening sentence
   * stays a sentence, and a spoken "Title: …"
   * becomes a `## heading` there rather than a second title mid-note.
   */
  titled?: boolean;
}

export function renderNote(
  segments: readonly Segment[],
  partial = '',
  { titled = true }: RenderOptions = {},
): RenderedNote {
  const paragraphs = withCodeBlocksWhole(toParagraphs(segments));
  const plain = paragraphs.join('\n\n');

  const blocks: Block[] = [];
  let title: string | null = null;
  /** A cue said as its own sentence, waiting for the sentence it introduces. */
  let pendingCue: string | null = null;
  /** The title is decided by the first sentence with content, not by a cue before it. */
  let seenContent = false;
  /** A list is open: announced, or begun by an item. Its kind, for the items that follow. */
  let openList: 'number' | 'bullet' | null = null;
  /**
   * Whether short plain sentences join the open list: only when it was
   * announced ("here's my shopping list") or talked into being ("the next item
   * is …"). After a cue ("bullet point, eggs") a short "Thanks." is a reply,
   * not an item.
   */
  let takesShortItems = false;
  /** An item phrase that stopped short ("The next item is."), waiting for its item. */
  let pendingItem: string | null = null;
  /** The phrase waiting was a numbered cue ("number three, the next item is"): the item is numbered. */
  let pendingNumbered = false;
  /** The open list was led by "Pack these.": its items hang under that line, as a list said with a colon does. */
  let ledList = false;
  const paragraphStarts = new Set<number>();
  /** What the spoken footnotes say, in order: written under the note. */
  const footnotes: string[] = [];

  paragraphs.forEach((paragraph) => {
    paragraphStarts.add(blocks.length);
    for (const piece of codeBlocksIn(paragraph)) {
      if (piece.kind === 'fence') {
        blocks.push(piece);
        pendingCue = null;
        seenContent = true;
        openList = null;
        takesShortItems = false;
        continue;
      }
      const said = piece.text.replace(FOOTNOTE_SAID, (_all, before: string, note: string, after: string) => {
        const words = capitalise(note.trim().replace(/[,;]+$/, ''));
        footnotes.push(/[.!?]$/.test(words) ? words : `${words}.`);
        return `[^${footnotes.length}]${after || before}`;
      });
      const sentences = sentencesOf(spokenExtras(spokenInlineMarkup(inlineNumbering(said))));

      const firstOrdinal = sentences.findIndex((s) => ORDINAL_START.test(s.text));

      sentences.forEach((spoken, sentenceIndex) => {
        const cueOnly = STANDALONE_CUE.exec(spoken.text);
        if (cueOnly?.[1]) {
          pendingCue = cueOnly[1];
          return;
        }
        const sentence: Sentence = pendingCue ? { ...spoken, text: `${pendingCue}: ${spoken.text}` } : spoken;
        pendingCue = null;

        // The item after "the next item is", said as its own phrase. A second
        // item phrase instead means the first was just words.
        if (pendingItem !== null) {
          const held = pendingItem;
          const numbered = pendingNumbered;
          pendingItem = null;
          pendingNumbered = false;
          if (!ITEM_OPENER.test(sentence.text) && !itemOf(sentence.text)) {
            const last = blocks[blocks.length - 1];
            const kind = numbered || last?.kind === 'number' ? 'number' : last?.kind === 'bullet' || last?.kind === 'item' ? 'bullet' : (openList ?? 'bullet');
            blocks.push({ kind, text: capitalise(stripEnd(sentence.text)) });
            openList = kind;
            takesShortItems = true;
            return;
          }
          blocks.push({ kind: 'para', text: held });
        }
        if (ITEM_OPENER.test(sentence.text)) {
          pendingItem = sentence.text;
          seenContent = true;
          return;
        }
        // "Number three, the next item is", with the item after a breath: the
        // number waits for it too, so the list's count carries on.
        const numberedOpener = NUMBER_CUE.exec(sentence.text);
        if (numberedOpener?.[2] && ITEM_OPENER.test(numberedOpener[2])) {
          pendingItem = sentence.text;
          pendingNumbered = true;
          seenContent = true;
          return;
        }

        // The very first sentence can be a spoken title, or a short opening that
        // reads as one.
        if (!seenContent) {
          seenContent = true;
          const cue = TITLE_CUE.exec(sentence.text);
          if (cue?.[1]) {
            const words = capitalise(stripEnd(cue[1]));
            if (titled) title = words;
            else blocks.push({ kind: 'heading', text: words });
            return;
          }
          if (titled && isTitleShaped(sentence.text) && !itemOf(sentence.text)) {
            title = stripEnd(sentence.text);
            openList = announcesList(sentence.text);
            takesShortItems = openList !== null;
            return;
          }
        }

        // A list item said as a phrase ("the next item is …"), or a short item
        // under a list someone announced. It takes the list's kind: numbered if
        // the list is, bullets otherwise.
        const listKind = (): 'number' | 'bullet' => {
          const last = blocks[blocks.length - 1];
          if (last?.kind === 'number') return 'number';
          if (last?.kind === 'bullet' || last?.kind === 'item') return 'bullet';
          return openList ?? 'bullet';
        };
        const item = itemOf(sentence.text);
        if (item) {
          const kind = listKind();
          blocks.push({ kind, text: item });
          openList = kind;
          takesShortItems = true;
          return;
        }

        const ordinalRun = firstOrdinal >= 0 && sentenceIndex >= firstOrdinal;
        const made = localBlocks(sentence.text, ordinalRun);
        // A short plain sentence under an open list is its next item. Only
        // plain: a cue ("number two, …", "then …" in an ordinal run) has
        // already said what the sentence is.
        if (openList && takesShortItems && made.length === 1 && made[0]?.kind === 'para' && itemShaped(sentence.text)) {
          const kind = listKind();
          // "The stove and the lantern." is two things; "bread and butter" is one.
          const parts = stripEnd(sentence.text).split(/\s+and\s+(?=(?:the|a|an|some|two|three)\s)/i);
          for (const part of parts) blocks.push({ kind: ledList && kind === 'bullet' ? 'item' : kind, text: capitalise(part.trim()) });
          openList = kind;
          return;
        }
        const led = made.length === 1 && made[0]?.kind === 'para' && LIST_LEAD.test(sentence.text.trim()) && announcesList(sentence.text) !== null;
        // "Pack these." is the line a list hangs from: "Pack these:", like a list said with its colon.
        blocks.push(...(led ? [{ kind: 'intro' as const, text: `${stripEnd(sentence.text)}:` }] : made));
        ledList = led;
        const last = made[made.length - 1];
        const announced = announcesList(sentence.text);
        if (announced) {
          openList = announced;
          takesShortItems = true;
        } else if (last?.kind === 'number' || last?.kind === 'bullet') {
          openList = last.kind;
        } else {
          openList = null;
          takesShortItems = false;
        }
      });
    }
  });

  // A "the next item is" that nothing followed: it was words.
  if (pendingItem !== null) blocks.push({ kind: 'para', text: pendingItem });

  const notes = footnotes.map((note, index) => `[^${index + 1}]: ${note}`).join('\n');
  const laidOut = renderBlocks(blocks, paragraphStarts);
  const body = finishLines(notes ? `${laidOut}${laidOut ? '\n\n' : ''}${notes}` : laidOut);
  let markdown = title ? `# ${title}${body ? `\n\n${body}` : ''}` : body;

  let pendingFrom: number | null = null;
  const tail = partial.trim();
  if (tail) {
    const last = blocks[blocks.length - 1];
    const separator = !markdown ? '' : last?.kind === 'para' ? ' ' : '\n\n';
    pendingFrom = markdown.length + separator.length;
    markdown = `${markdown}${separator}${tail}`;
  }

  return { markdown, pendingFrom, plain };
}

/**
 * Whether an opening sentence reads as a title: short, not a question, and not
 * something the local rules would rather make a list item or a to-do. "Grocery
 * run." is a title; "I need to call the bank." is a task that happens to be
 * first.
 */
function isTitleShaped(text: string): boolean {
  if (/\?$/.test(text.trim())) return false;
  // Marked words, a clip or a picture: something said to be kept as it is, not a name for the note.
  if (/\*\*|~~|==|%%|\?\?|\^\^|\+\+|\|\||`|!\[|\[\[|\[\^|\]\(|<https?:|[\^~$\uE000-\uE002]|:[a-z_+-]+:|(?:^|\s)_\S/.test(text)) return false;
  if (words(text) > 6) return false;
  if (
    TASK.test(text) ||
    BULLET_CUE.test(text) ||
    HEADING_CUE.test(text) ||
    QUOTE_CUE.test(text) ||
    NUMBER_CUE.test(text) ||
    CHECKBOX_CUE.test(text) ||
    DIVIDER_CUE.test(text) ||
    IMPORTANT_CUE.test(text) ||
    SUBHEADING_CUE.test(text) ||
    CALLOUT_CUE.test(text) ||
    HIDDEN_CUE.test(text) ||
    CHOICE_CUE.test(text) ||
    SUM_CUE.test(text) ||
    DONE_CUE.test(text) ||
    DEFINE_CUE.test(text) ||
    enumeration(text)
  ) {
    return false;
  }
  return true;
}
