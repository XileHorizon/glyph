import type { ComponentType } from 'react';
import {
  Anchor,
  Asterisk,
  Baseline,
  Bookmark,
  Bold,
  Code,
  Hash,
  Highlighter,
  Calculator,
  CircleDot,
  EyeOff,
  Gauge,
  ListChecks,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  Italic,
  LayoutGrid,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  MessageSquareQuote,
  Sigma,
  SquareArrowOutUpRight,
  SquareCheckBig,
  SquareCode,
  Sticker,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Text,
  Underline,
  Workflow,
} from '@glacier/icons';
import { plugins } from '../plugins/registry.ts';

/**
 * Every mark a note can carry, as a table: what you type, what it does, and a
 * line showing it at work (guide/MarksTable.tsx, guide/CheatSheet.tsx). Matt:
 * "create a guide page, it should show every formatting mode we have in a
 * table and show you an example of how it works."
 *
 * The rows are the app's own Markdown, then the marks Glyph's plugins add,
 * read from the registry so a plugin switched off is not promised and a new
 * one shows up here by itself (plugins/types.ts `InlineFormat`).
 *
 * Every row carries its own icon, and the example is `typed`: both pages draw
 * it with the note's own editor (guide/MarkExample.tsx), so what is shown here
 * is what the app does with those characters and not a drawing of it. `looks`
 * says which kind of mark it is, for anything that wants to sort or say so.
 */

export type Looks =
  | 'plain'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'both'
  | 'struck'
  | 'code'
  | 'link'
  | 'quote'
  | 'bullet'
  | 'number'
  | 'todo'
  | 'done'
  | 'rule'
  | 'table'
  | 'picture'
  | 'fence'
  | 'wisp'
  | 'style'
  | 'note'
  | 'tint'
  | 'sup'
  | 'sub'
  | 'callout'
  | 'wiki'
  | 'foot'
  | 'definition'
  | 'maths'
  | 'emoji'
  | 'anchor'
  | 'board'
  | 'diagram'
  | 'itemRef'
  | 'tag'
  | 'counter'
  | 'sum'
  | 'progress'
  | 'choice'
  | 'spoilerLine'
  | 'bookmark';

export interface MarkRow {
  /** The mark itself, as a person would type it: `**`, `- [ ]`. */
  symbol: string;
  name: string;
  /** What to type, whole: the example's markdown, drawn by the note's own editor. */
  typed: string;
  /** The words that carry the mark in the example, for anything that needs them without the marks. */
  words: string;
  looks: Looks;
  /** The mark's icon, shown beside its name. */
  icon: ComponentType<{ size?: number }>;
  /** How it is drawn, where a page needs the plugin's own CSS. */
  css?: string;
  /** Said while recording, where there is a way to say it. */
  say?: string;
  /** What the popover says, for the row that shows a note on a mark (editor/markNotes.ts). */
  note?: string;
}

export interface MarkGroup {
  title: string;
  lead: string;
  rows: MarkRow[];
}

/** The marks the app itself knows, in the order the page shows them. */
const OWN: MarkGroup[] = [
  {
    title: 'Words',
    lead: 'Around the words they mark, anywhere in a line.',
    rows: [
      { symbol: '**', name: 'Bold', typed: '**Friday at noon**', words: 'Friday at noon', looks: 'bold', icon: Bold, say: '“bold” … “end bold”' },
      { symbol: '_', name: 'Italic', typed: '_a quiet aside_', words: 'a quiet aside', looks: 'italic', icon: Italic, say: '“italic” … “end italic”' },
      { symbol: '***', name: 'Both', typed: '***really now***', words: 'really now', looks: 'both', icon: Baseline, say: '“bold italic” … “end bold italic”' },
      { symbol: '~~', name: 'Struck through', typed: '~~the old plan~~', words: 'the old plan', looks: 'struck', icon: Strikethrough, say: '“strike” … “end strike”' },
      { symbol: '`', name: 'Code', typed: '`npm run dev`', words: 'npm run dev', looks: 'code', icon: Code, say: '“code” … “end code”' },
      { symbol: '[ ]( )', name: 'A link', typed: '[Ghost.md](https://attack.fm/glyph)', words: 'Ghost.md', looks: 'link', icon: Link, say: '“link our site to attack dot fm end link”' },
      { symbol: '#', name: 'A tag', typed: '- [ ] Ship the pricing page #web #launch', words: '#web', looks: 'tag', icon: Hash, say: '“hashtag web”' },
    ],
  },
  {
    title: 'Lines',
    lead: 'At the start of a line, with a space after them.',
    rows: [
      { symbol: '#', name: 'Title', typed: '# Weekend trip', words: 'Weekend trip', looks: 'h1', icon: Heading1, say: '“title” or “call this note”' },
      { symbol: '##', name: 'Heading', typed: '## The budget', words: 'The budget', looks: 'h2', icon: Heading2, say: '“heading” or “new section”' },
      { symbol: '###', name: 'Smaller heading', typed: '### Friday', words: 'Friday', looks: 'h3', icon: Heading3, say: '“subheading”' },
      { symbol: '-', name: 'A list', typed: '- Oat milk\n- Rye bread', words: 'Oat milk', looks: 'bullet', icon: List, say: '“bullet point”' },
      { symbol: '1.', name: 'In order', typed: '1. Unplug it\n2. Wait a minute', words: 'Unplug it', looks: 'number', icon: ListOrdered, say: '“number one”, “first”' },
      { symbol: '- [ ]', name: 'A to-do', typed: '- [ ] Book the cabin', words: 'Book the cabin', looks: 'todo', icon: ListTodo, say: '“remember to”, “check box”' },
      { symbol: '- [x]', name: 'Done', typed: '- [x] Call Sam', words: 'Call Sam', looks: 'done', icon: SquareCheckBig, say: '“done task: …”' },
      { symbol: '- ( )', name: 'A choice', typed: 'Where do we stay?\n- ( ) Tent\n- (x) Cabin', words: 'Cabin', looks: 'choice', icon: CircleDot, say: '“option: tent”, “picked option: cabin”' },
      { symbol: '[ / ]', name: 'A counter', typed: '- Water [3/8]', words: '3/8', looks: 'counter', icon: Gauge, say: '“counter three of eight”' },
      { symbol: '=', name: 'A sum', typed: '= $450 + 120 * 2', words: '$690', looks: 'sum', icon: Calculator, say: '“calculate: four fifty plus one twenty”' },
      {
        symbol: '>',
        name: 'A quote',
        typed: '> The deposit comes back in full.',
        words: 'The deposit comes back in full.',
        looks: 'quote',
        icon: MessageSquareQuote,
        say: '“quote”',
      },
      { symbol: '>|', name: 'A hidden line', typed: '>| The answer is forty-two.', words: 'The answer is forty-two.', looks: 'spoilerLine', icon: EyeOff, say: '“hidden line: …”' },
      {
        symbol: '#',
        name: 'Progress',
        typed: '## Packing\n- [x] Tent\n- [ ] Stove',
        words: '1 of 2',
        looks: 'progress',
        icon: ListChecks,
      },
      { symbol: '---', name: 'A dividing line', typed: '---', words: '', looks: 'rule', icon: Minus, say: '“divider”' },
    ],
  },
  {
    title: 'Pointing somewhere',
    lead: 'At another note, at a line of this one, or at the small print underneath.',
    rows: [
      { symbol: '[[ ]]', name: 'Another note', typed: 'the deposit is in [[The cabin trip]]', words: 'The cabin trip', looks: 'wiki', icon: SquareArrowOutUpRight, say: '“note link The cabin trip end link”' },
      {
        symbol: '^',
        name: 'A name for an item',
        typed: '- [ ] Ship the pricing page ^ship-page\n- Ask Sam about the copy ^ask-sam',
        words: 'ship-page',
        looks: 'anchor',
        icon: Anchor,
        say: '“anchor ship page end anchor”',
      },
      {
        symbol: '[[#^ ]]',
        name: 'That item, from the words',
        typed: 'the page is waiting on [[#^ask-sam]]\n\n- Ask Sam about the copy ^ask-sam',
        words: 'ask-sam',
        looks: 'itemRef',
        icon: Link,
        say: '“item link ask Sam end link”',
      },
      { symbol: '§§', name: 'The bookmark', typed: 'the deposit is four hundred §§', words: 'the deposit is four hundred', looks: 'bookmark', icon: Bookmark, note: 'The note opens here. Tap the bookmark button to move it to the line you are on.', say: '“… bookmark this”' },
      { symbol: '[^ ]', name: 'A footnote', typed: 'four hundred[^sam]\n\n[^sam]: Sam said so.', words: 'four hundred', looks: 'foot', icon: Asterisk, note: 'Sam said so.', say: '“footnote Sam said so end footnote”' },
    ],
  },
  {
    title: 'Raised and lowered',
    lead: 'Around one part of a word, the way the rest of markdown writes them.',
    rows: [
      { symbol: '^ ^', name: 'Raised', typed: 'the 2^nd^ of June', words: 'nd', looks: 'sup', icon: Superscript, say: '“superscript” … “end superscript”' },
      { symbol: '~ ~', name: 'Lowered', typed: 'H~2~O', words: '2', looks: 'sub', icon: Subscript, say: '“subscript” … “end subscript”' },
    ],
  },
  {
    title: 'Blocks',
    lead: 'A few lines that work together.',
    rows: [
      { symbol: ':', name: 'A definition', typed: 'Deposit\n: what you pay up front', words: 'what you pay up front', looks: 'definition', icon: Text, note: 'Deposit', say: '“define deposit as what you pay up front”' },
      { symbol: '$', name: 'Maths', typed: 'when $x^2 + y$ holds', words: '$x^2 + y$', looks: 'maths', icon: Sigma, say: '“maths x squared plus y end maths”' },
      { symbol: ': :', name: 'An emoji', typed: 'shipped :tada:', words: '🎉', looks: 'emoji', icon: Sticker, say: '“emoji party popper”' },
      {
        symbol: '| |',
        name: 'A table',
        typed: '| What | Packed |\n| --- | --- |\n| Tent | Yes |',
        words: '',
        looks: 'table',
        icon: Table,
        say: '“Hey Ghost, add a table to this note”',
      },
      { symbol: '![ ]( )', name: 'A picture', typed: '![A cassette](image/tape.jpg)', words: 'A cassette', looks: 'picture', icon: Image },
      { symbol: '```', name: 'A block of code', typed: '```js\nconst note = "hello";\n```', words: 'const note = "hello";', looks: 'fence', icon: SquareCode, say: '“code block in bash” … “end code block”' },
      {
        symbol: '[! ]',
        name: 'A callout',
        typed: '> [!NOTE]\n> The deposit comes back in full.',
        words: 'The deposit comes back in full.',
        looks: 'callout',
        icon: Info,
        note: 'NOTE',
        say: '“info box: …”, “warning callout: …”',
      },
      {
        symbol: '```mermaid',
        name: 'A diagram',
        typed: '```mermaid\nflowchart TD\n  A[Speak] --> B[Note]\n  B --> C[Board]\n```',
        words: 'flowchart TD',
        looks: 'diagram',
        icon: Workflow,
      },
      {
        symbol: '```board',
        name: 'A board',
        typed: '```board\nTo do: ship-page\nDone: pick-date\n```\n\n- [ ] Ship the pricing page ^ship-page\n- [x] Pick a launch date ^pick-date',
        words: 'ship-page',
        looks: 'board',
        icon: LayoutGrid,
        say: '“Hey Ghost, make this a board”',
      },
    ],
  },
];

/** Every group the page shows: the app's own marks, then the ones the switched-on plugins add. */
export function markGroups(): MarkGroup[] {
  const formats = plugins.formats();
  if (!formats.length) return OWN;
  const rows = formats.map((format): MarkRow => {
    const words = format.name === 'Spoiler' ? 'the cabin key' : `${format.name.toLowerCase()} this`;
    return {
      symbol: format.delimiter,
      name: format.name,
      typed: `${format.delimiter}${words}${format.delimiter}`,
      words,
      looks: format.look.kind === 'wisp' ? 'wisp' : 'style',
      icon: format.icon ?? Underline,
      css: format.look.kind === 'style' ? format.look.css : undefined,
      say: format.cue ? `“${format.cue}” … “end ${format.cue}”` : undefined,
    };
  });
  // A colour named after a highlight, which is the same brackets saying something else (plugins/marks/index.tsx).
  const tinted: MarkRow = {
    symbol: '==( )',
    name: 'A coloured highlight',
    typed: '==the cabin key==(green) and ==the deadline==(red)',
    words: 'the cabin key',
    looks: 'tint',
    icon: Highlighter,
  };
  // A note on a mark is shown last, because it is written on top of any of the marks above it (editor/markNotes.ts).
  const noted: MarkRow = {
    symbol: '( )',
    name: 'A note on a mark',
    typed: '??four hundred??(Sam said 400)',
    words: 'four hundred',
    looks: 'note',
    icon: Info,
    note: 'Sam said 400',
    say: '“… end unsure, note Sam said 400, end note”',
  };
  return [...OWN, { title: 'Ghost.md’s own', lead: 'Marks the app adds, each from a plugin you can switch off.', rows: [...rows, tinted, noted] }];
}
