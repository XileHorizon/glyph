/**
 * Glyph Academy's lessons (academy/AcademyScreen.tsx): what each mark is, what to type, and how the Academy knows it
 * worked.
 *
 * Matt: "we need a Glyph Academy section that teaches you markdown then teaches you the extra stuff we have. Build
 * the academy section start with just the markdown basics set it up as a live code type thing where it teaches you
 * then you type it and see it format below."
 *
 * So a lesson is one mark: a line or two on what it does, an example to copy, something to write of your own, and a
 * check run on what was really typed - not on it matching the example. Any title passes the title lesson. The
 * checks are forgiving on purpose: extra lines, other marks and different words are all fine, since a person
 * learning is usually trying things.
 *
 * Pure, so every lesson's own example is a test that its check passes (academy/lessons.test.ts). The marks
 * themselves are the app's (guide/marks.ts, docs/MARKDOWN.md); this file is only the teaching order and the words.
 */

export interface Lesson {
  id: string;
  chapter: Chapter;
  /** What the lesson is called: the mark, in words. */
  title: string;
  /** The mark itself, as the cheat sheet writes it (guide/marks.ts): `**`, `- [ ]`. */
  symbol: string;
  /** What it does, in a line or two. */
  teach: string;
  /** The example to look at, and what **Show me** writes into the field. */
  example: string;
  /** What to write of your own. */
  task: string;
  /** Read what is typed: true the moment this lesson's mark is in it. */
  passes: (text: string) => boolean;
  /** Said when it passes. */
  praise: string;
  /** Offered when it is asked for. */
  hint: string;
}

export const CHAPTERS = ['Markdown basics'] as const;
export type Chapter = (typeof CHAPTERS)[number];

/** A line of its own, anywhere in what was typed. */
const line = (pattern: RegExp) => (text: string) => pattern.test(text);

export const LESSONS: Lesson[] = [
  {
    id: 'title',
    chapter: 'Markdown basics',
    symbol: '#',
    title: 'A title',
    teach: 'A note usually starts with its name. One # and a space makes that line the title, and it is what the note is called in your list.',
    example: '# Weekend trip',
    task: 'Give a note a title of your own.',
    passes: line(/^[ \t]*#[ \t]+\S/m),
    praise: 'That is a title.',
    hint: 'Start the line with # and a space, then the words.',
  },
  {
    id: 'heading',
    chapter: 'Markdown basics',
    symbol: '##',
    title: 'A heading',
    teach: 'More hashes, smaller heading: ## for a part of the note, ### for a part of that. It is how a long note gets somewhere to look.',
    example: '## The budget',
    task: 'Write a heading for part of a note.',
    // Any heading below a title, since the lesson itself offers ### as well as ## (Matt, of three hashes: "the
    // lesson isn't passed").
    passes: line(/^[ \t]*#{2,6}[ \t]+\S/m),
    praise: 'That is a heading.',
    hint: 'Two hashes and a space: ## The budget.',
  },
  {
    id: 'bold',
    chapter: 'Markdown basics',
    symbol: '**',
    title: 'Bold',
    teach: 'Two stars either side of some words make them bold. The stars themselves go once the line is written.',
    example: 'The train leaves **Friday at noon**',
    task: 'Write a line with something bold in it.',
    passes: line(/\*\*\S(?:[^*]*\S)?\*\*/),
    praise: 'Bold.',
    hint: 'Two stars, the words, two stars: **like this**.',
  },
  {
    id: 'italic',
    chapter: 'Markdown basics',
    symbol: '_',
    title: 'Italic',
    teach: 'One underscore either side leans the words over. It is quieter than bold: an aside, a name, a word said with a shrug.',
    example: 'we could take the coast road _if the weather holds_',
    task: 'Write a line with something in italics.',
    // Underscores are what the lesson teaches, but markdown's stars lean words over too, and the page below shows
    // them leaning: a lesson must never refuse what the note plainly did.
    passes: (text) => /(?:^|[^\w_])_\S(?:[^_\n]*\S)?_(?![\w_])/m.test(text) || /(?<![*\w])\*[^*\n]+\*(?!\*)/.test(text),
    praise: 'Italic.',
    hint: 'An underscore either side: _like this_.',
  },
  {
    id: 'struck',
    chapter: 'Markdown basics',
    symbol: '~~',
    title: 'Struck through',
    teach: 'Two squiggles either side cross the words out. Good for a plan that changed, where you still want to see what it was.',
    example: 'we are going ~~on Thursday~~ on Friday',
    task: 'Cross some words out.',
    passes: line(/~~\S(?:[^~\n]*\S)?~~/),
    praise: 'Crossed out, and still readable.',
    hint: 'Two squiggles either side: ~~like this~~.',
  },
  {
    id: 'code',
    chapter: 'Markdown basics',
    symbol: '`',
    title: 'Code',
    teach: 'A backtick either side sets the words in the typewriter face and leaves them exactly as you typed them: a command, a filename, a password to read out.',
    example: 'run `npm run dev` first',
    task: 'Write a line with a bit of code in it.',
    passes: line(/`[^`\n]+`/),
    praise: 'That stays exactly as typed.',
    hint: 'A backtick either side: `like this`. The key is usually under Escape.',
  },
  {
    id: 'link',
    chapter: 'Markdown basics',
    symbol: '[ ]( )',
    title: 'A link',
    teach: 'The words people read go in square brackets, and where they point goes in round ones after it. The note shows the words, not the address.',
    example: '[Ghost.md](https://attack.fm/glyph) is the app this is in',
    task: 'Write a link of your own.',
    passes: line(/\[[^\]\n]+\]\([^)\s]+\)/),
    praise: 'That is a link.',
    hint: 'Words in square brackets, then the address in round ones: [words](https://example.com).',
  },
  {
    id: 'list',
    chapter: 'Markdown basics',
    symbol: '-',
    title: 'A list',
    teach: 'A dash and a space starts a list, one line each. Press Enter and the next line is a bullet too.',
    example: '- Oat milk\n- Rye bread\n- Coffee',
    task: 'Write a list of two or three things.',
    passes: line(/^[ \t]*[-*+][ \t]+\S/m),
    praise: 'That is a list.',
    hint: 'Start each line with a dash and a space.',
  },
  {
    id: 'number',
    chapter: 'Markdown basics',
    symbol: '1.',
    title: 'In order',
    teach: 'A number, a dot and a space when the order is the point: steps to follow, one after another.',
    example: '1. Unplug it\n2. Wait a minute\n3. Plug it back in',
    task: 'Write two steps in order.',
    passes: line(/^[ \t]*\d+[.)][ \t]+\S/m),
    praise: 'Numbered.',
    hint: 'Start the line with 1. and a space; the next one with 2.',
  },
  {
    id: 'todo',
    chapter: 'Markdown basics',
    symbol: '- [ ]',
    title: 'A to-do',
    teach: 'A dash, then a box: - [ ] and the thing to do. Tap the box in a note to tick it off, or type an x between the brackets.',
    example: '- [ ] Book the cabin\n- [x] Pick a date',
    task: 'Write something you have to do.',
    passes: line(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]*\S/m),
    praise: 'That is a to-do, and its box is real: tap it in a note.',
    hint: 'A dash, a space, then [ ] with a space between the brackets.',
  },
  {
    id: 'quote',
    chapter: 'Markdown basics',
    symbol: '>',
    title: 'A quote',
    teach: 'A > and a space sets a line apart: somebody else’s words, or something you want to stand away from the rest.',
    example: '> The deposit comes back in full.',
    task: 'Quote a line.',
    passes: line(/^[ \t]*>[ \t]*\S/m),
    praise: 'Set apart.',
    hint: 'Start the line with > and a space.',
  },
  {
    id: 'rule',
    chapter: 'Markdown basics',
    symbol: '---',
    title: 'A dividing line',
    teach: 'Three dashes on a line of their own draw a line across the note: one thing ends, another starts.',
    example: 'Packing\n\n---\n\nOn the way back',
    task: 'Put a line between two parts of a note.',
    passes: line(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m),
    praise: 'A clean break.',
    hint: 'Three dashes alone on a line: ---',
  },
  {
    id: 'fence',
    chapter: 'Markdown basics',
    symbol: '```',
    title: 'A block of code',
    teach: 'Three backticks above and below a few lines keeps every one of them exactly as typed, and colours the code if you say what it is after the first three.',
    example: '```js\nconst note = "hello";\n```',
    task: 'Write a block with a line or two of code in it.',
    passes: (text) => /^[ \t]*(?:```|~~~)/m.test(text) && (text.match(/^[ \t]*(?:```|~~~)/gm)?.length ?? 0) >= 2,
    praise: 'A block, kept exactly as typed.',
    hint: 'Three backticks on their own line, your code, then three more.',
  },
];

/** The lessons of a chapter, in the order they are taught. */
export function lessonsIn(chapter: Chapter): Lesson[] {
  return LESSONS.filter((lesson) => lesson.chapter === chapter);
}

/** Where a person has got to, kept between visits, so the Academy opens at the first lesson not passed. */
const KEY = 'glyph-academy';

export function readProgress(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeProgress(done: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    // Progress still counts for this visit.
  }
}
