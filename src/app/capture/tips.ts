/**
 * What the recorder suggests saying when you pause: the spoken cues that shape
 * a note, and the routing command, one at a time.
 *
 * Shown only in a pause, never while you talk, and never the same one twice
 * in a row. The list follows the cues `markdown.ts` actually understands, so
 * a tip is always something that works. The routing tip names one of your
 * own notes, which teaches the command better than a made-up title.
 */

export interface Tip {
  /** The words to say, shown in quotes. */
  say: string;
  /** What saying them does, read after the words: Say “Check box” to make a to-do. */
  does: string;
}

const CUES: readonly Tip[] = [
  { say: 'Bullet point', does: 'to start a list' },
  { say: 'The next item is …', does: 'to add to a list' },
  { say: 'Heading', does: 'and then its words to start a section' },
  { say: 'Check box', does: 'to make a to-do' },
  { say: 'New paragraph', does: 'to break the text' },
  { say: 'Title', does: 'first to name the note' },
  { say: 'Bold … end bold', does: 'around words to make them stand out' },
  { say: 'Quote', does: 'for something someone said' },
  { say: 'Number one', does: 'to start a numbered list' },
  { say: 'Divider', does: 'to draw a line' },
  { say: 'Subheading', does: 'for a section inside a section' },
  { say: 'Option', does: 'for each choice, and “picked option” for the one you chose' },
  { say: 'Info box', does: 'to set a line apart in a box' },
  { say: 'Hidden line', does: 'to keep a line in smoke until it is tapped' },
  { say: 'Calculate', does: 'and then a sum, to see its answer' },
  { say: 'Hashtag', does: 'and a word to tag a line' },
  { say: 'Counter zero of eight', does: 'after an item to count it off' },
  { say: 'Voice memo … end memo', does: 'to keep the sound instead of the words' },
  { say: 'Italic … end italic', does: 'around words to lean them' },
  { say: 'Strike … end strike', does: 'to cross words out' },
  { say: 'Code … end code', does: 'around a command' },
  { say: 'Done task', does: 'for a to-do that is already done' },
  { say: 'Link … to … end link', does: 'with words and an address, “attack dot fm”' },
  { say: 'Note link … end link', does: 'around a note’s name to link to it' },
  { say: 'Footnote … end footnote', does: 'for small print under the note' },
  { say: 'Bookmark this', does: 'at the end of a line to open the note there' },
  { say: 'Define … as …', does: 'to write a term and its meaning' },
  { say: 'Emoji', does: 'and its name, like “emoji party popper”' },
  { say: 'New line', does: 'between two pauses to break a line' },
  { say: 'Code block … end code block', does: 'for lines of code, one a sentence' },
  { say: 'Maths … end maths', does: 'around a formula, “x squared plus y”' },
  { say: 'Superscript … end superscript', does: 'to raise words, and “subscript” to lower them' },
  { say: 'Anchor … end anchor', does: 'to name an item, and “item link … end link” to point at it' },
];

/**
 * The tips, in the order they come round. `noteTitle` is a recent note's
 * title for the routing tip; `continuing` says a note is already being added
 * to, which is when "new note" is worth knowing.
 */
export function tips({ noteTitle, continuing, keyword = true, lane = null }: { noteTitle?: string | null; continuing: boolean; keyword?: boolean; lane?: string | null }): Tip[] {
  const say = (command: string) => (keyword ? `Hey Ghost, ${command.charAt(0).toLowerCase()}${command.slice(1)}` : command);
  const route: Tip[] = [];
  if (noteTitle) route.push({ say: say(`Add … to ${noteTitle}`), does: 'to put it there, into its list if it has one' });
  if (noteTitle) route.push({ say: say(`New item for ${noteTitle}`), does: 'and then the item, to add to its list' });
  // On a note with a board, its lanes can be named (core/boards.ts).
  if (lane) route.push({ say: say(`Add … to ${lane}`), does: 'to put a card in that lane' });
  if (lane) route.push({ say: say(`Move … to ${lane}`), does: 'to move a card there' });
  if (continuing) route.push({ say: say('New note'), does: 'to start a fresh one' });
  if (noteTitle) route.push({ say: say(`Move this to ${noteTitle}`), does: 'to send this recording there' });
  if (noteTitle) route.push({ say: say(`Add a table to ${noteTitle}`), does: 'and it asks for the columns and rows' });
  // Routing first and then every few cues, since it is the least discoverable.
  const out: Tip[] = [];
  CUES.forEach((cue, i) => {
    if (i % 3 === 0 && route[i / 3]) out.push(route[i / 3]!);
    out.push(cue);
  });
  return out;
}

/** How long a pause has to be before a tip shows. Longer than a breath, shorter than giving up. */
export const TIP_AFTER_MS = 2500;
