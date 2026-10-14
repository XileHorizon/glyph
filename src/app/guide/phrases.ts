import { renderNote, type Segment } from '../capture/markdown.ts';

/**
 * What to SAY to get markdown, as the guide teaches it.
 *
 * Every example is rendered by the real speech-to-markdown rules at runtime
 * (`renderNote`), never typed out by hand: the guide shows exactly what the
 * capture screen would write, so a rule that changes cannot leave the guide
 * promising the old behaviour. guide.test.ts pins what each example must still
 * produce, so a rule that REGRESSES fails a test instead of quietly teaching
 * something that no longer works.
 *
 * Only cues src/app/capture/markdown.ts implements belong here: the note is
 * shaped by what was said and nothing else.
 */

export interface Example {
  /** What to say, one phrase per pause - the way Whisper commits it. */
  say: string[];
  /** A marker the rendered markdown must contain; checked by guide.test.ts. */
  expect: string;
}

export interface PhraseGroup {
  title: string;
  /** The mark the cue writes, as the guide shows it beside the words: "#", "- [ ]". Empty for a blank line. */
  symbol: string;
  /** One line on when to use it. */
  lead: string;
  /** The words that trigger it, as a person would read them. */
  cues: string[];
  example: Example;
}

/** A mark with no spoken cue: the guide shows it, and how to make it, under the said ones. */
export interface TypedMark {
  symbol: string;
  title: string;
  /** How it is made: typed, pasted, or from the press-and-hold menu. */
  how: string;
}

export const TYPED: TypedMark[] = [
  { symbol: '[words](address)', title: 'A link', how: 'Or paste an address on its own; it is shortened on the page.' },
  { symbol: '![caption](image/…)', title: 'A picture', how: 'Paste one, or press and hold and choose Add image.' },
  { symbol: '| a | b |', title: 'A table', how: 'Pipes between cells, or say “Hey Ghost, add a table to this note” and answer.' },
  { symbol: '```', title: 'A block of code', how: 'Three backticks above and below, the language after the first three.' },
  { symbol: '![voice 0:12](tape:…)', title: 'A voice memo', how: 'Say “voice memo” while recording, talk, then “end memo”: the sound stays, played where you left it.' },
];

export const PHRASES: PhraseGroup[] = [
  {
    title: 'Name the note',
    symbol: '#',
    lead: 'Say it first. A short first sentence becomes the title anyway.',
    cues: ['“Title”', '“Call this note”'],
    example: { say: ['Title: weekend trip.', 'We leave on Friday after work.'], expect: '# Weekend trip' },
  },
  {
    title: 'Start a section',
    symbol: '##',
    lead: 'Say it at the start of a sentence, then pause.',
    cues: ['“Heading”', '“New section”'],
    example: { say: ['Notes from the call with Sam about the house.', 'Heading: the budget.', 'We agreed on four thousand.'], expect: '## The budget' },
  },
  {
    title: 'New paragraph',
    symbol: '',
    lead: 'Or just stop talking for two seconds.',
    cues: ['“New paragraph”'],
    example: { say: ['The kitchen needs work before we list it.', 'New paragraph.', 'The garden is fine as it is.'], expect: 'list it.\n\nThe garden' },
  },
  {
    title: 'Bullet points',
    symbol: '-',
    lead: 'One point per sentence.',
    cues: ['“Bullet point”', '“Next point”'],
    example: { say: ['Things to check at the cabin.', 'Bullet point: the heating.', 'Next point: the water pressure.'], expect: '- The heating' },
  },
  {
    title: 'A list in one breath',
    symbol: '-',
    lead: 'Three or more short things after a word like need, buy or bring.',
    cues: ['“I need eggs, milk and bread”'],
    example: { say: ['For the drive we need snacks, water, a charger and the good playlist.'], expect: 'For the drive we need:\n- snacks' },
  },
  {
    title: 'Numbers, out loud',
    symbol: '1.',
    lead: 'Use it when the order matters.',
    cues: ['“Number one”', '“Number two”'],
    example: { say: ['Packing order.', 'Number one: passports.', 'Number two: chargers.'], expect: '2. Chargers' },
  },
  {
    title: 'Steps in order',
    symbol: '1.',
    lead: 'Start with “first”. Then say second, then, or finally.',
    cues: ['“First”', '“Second”', '“Finally”'],
    example: { say: ['How to reset the router.', 'First, unplug it.', 'Second, wait thirty seconds.', 'Finally, plug it back in.'], expect: '3. Plug it back in' },
  },
  {
    title: 'To-dos',
    symbol: '- [ ]',
    lead: 'Say it like you’d say it to yourself.',
    cues: ['“Remember to”', '“I need to”', '“Check box”'],
    example: { say: ['Before Saturday.', 'Remember to book the cabin.', 'Check box: call the plumber.'], expect: '- [ ] Call the plumber' },
  },
  {
    title: 'Quote someone',
    symbol: '>',
    lead: 'Keeps their words apart from yours.',
    cues: ['“Quote”'],
    example: { say: ['What the landlord said at the end.', 'Quote: the deposit comes back in full.'], expect: '> The deposit comes back in full.' },
  },
  {
    title: 'Make it stand out',
    symbol: '**',
    lead: 'Pause after the word so it gets a colon.',
    cues: ['“Important”', '“Key point”'],
    example: { say: ['Thoughts on the offer.', 'Important: they need an answer by Monday.'], expect: '**Important:**' },
  },
  {
    title: 'Bold and italic, anywhere',
    symbol: '** _',
    lead: 'Say where it starts and where it ends, mid-sentence if you like.',
    cues: ['“Bold” then “end bold”', '“Italic” then “end italic”'],
    example: { say: ['The deadline is bold Friday at noon end bold, not Monday.'], expect: '**Friday at noon**' },
  },
  {
    title: 'A smaller section',
    symbol: '###',
    lead: 'A section inside a section.',
    cues: ['“Subheading”'],
    example: { say: ['Heading: packing.', 'Subheading: the kitchen.', 'Pots and pans.'], expect: '### The kitchen' },
  },
  {
    title: 'A callout',
    symbol: '> [!NOTE]',
    lead: 'A boxed note. Say “tip”, “warning” or “important” before it for those.',
    cues: ['“Info box”', '“Callout”', '“Warning callout”'],
    example: { say: ['Before you arrive, please read this.', 'Info box: the gate sticks, so lift it first.'], expect: '> [!NOTE]\n> The gate sticks' },
  },
  {
    title: 'A hidden line',
    symbol: '>|',
    lead: 'Kept in smoke until it is tapped.',
    cues: ['“Hidden line”'],
    example: { say: ['The answer to the riddle from the party.', 'Hidden line: it was the butler.'], expect: '>| It was the butler.' },
  },
  {
    title: 'Choices',
    symbol: '- ( )',
    lead: 'Things to pick from; say “picked option” for the one you chose.',
    cues: ['“Option”', '“Picked option”'],
    example: { say: ['Where should we stay?', 'Option: tent.', 'Picked option: cabin.'], expect: '- (x) Cabin' },
  },
  {
    title: 'A sum',
    symbol: '=',
    lead: 'Say the numbers and plus, minus, times or divided by. The answer shows beside it.',
    cues: ['“Calculate”'],
    example: { say: ['The trip adds up like this.', 'Calculate: four hundred plus one hundred twenty.'], expect: '= 400 + 120' },
  },
  {
    title: 'Tags, counters and links',
    symbol: '# [ / ] [[ ]]',
    lead: 'Mid-sentence: “hashtag” and a word, “counter three of eight”, or “note link” and a note’s name, then “end link”.',
    cues: ['“Hashtag travel”', '“Counter zero of eight”', '“Note link … end link”'],
    example: { say: ['Daily goals below.', 'Bullet point: drink water, counter zero of eight hashtag health.'], expect: '- Drink water [0/8] #health' },
  },
  {
    title: 'Struck through and code',
    symbol: '~~ `',
    lead: 'Said like bold: where it starts and where it ends.',
    cues: ['“Strike” then “end strike”', '“Code” then “end code”'],
    example: { say: ['The meeting moved from strike Tuesday end strike to Wednesday.'], expect: '~~Tuesday~~' },
  },
  {
    title: 'A dividing line',
    symbol: '---',
    lead: 'Say it on its own, between two parts of a note.',
    cues: ['“Divider”', '“Horizontal line”'],
    example: { say: ['That covers the morning.', 'Divider.', 'The afternoon is free.'], expect: '\n---\n' },
  },
];

/**
 * A cue said on its own - "Bullet point." then a pause - applies to what comes
 * next. The guide says so once rather than per cue; this example is what
 * guide.test.ts checks that promise against.
 */
export const CUE_ALONE: Example = { say: ['Shopping.', 'Bullet point.', 'Oat milk.'], expect: '- Oat milk' };

/** The same shape the capture tests use: a second per phrase with a breath between. */
export function toSegments(say: readonly string[]): Segment[] {
  let at = 0;
  return say.map((text) => {
    const segment = { text, startMs: at, endMs: at + 1000 };
    at += 1300;
    return segment;
  });
}

/** An example as the capture screen would write it. */
export function renderExample(example: Example): string {
  return renderNote(toSegments(example.say)).markdown;
}
