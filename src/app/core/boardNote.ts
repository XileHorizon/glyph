/**
 * The example board (docs/BOARDS.md): a note that is a working board, added from Settings.
 *
 * Matt: "make an example note with this functionality". Everything in it is the standard and nothing else - a fence
 * of columns, list items with anchors, and ordinary words around them - so the note reads as a plan wherever it is
 * opened, and Glyph draws the board at the top of it with the items below as the items they are.
 */

export const BOARD_TITLE = 'Launch week';

export function boardNoteBody(): string {
  return `# ${BOARD_TITLE}

A board is two ordinary things: this fence, which lays out the columns, and the list under it, each item ending with
a name after a \`^\`. The cards are those items. Tick one here and the to-do below is ticked; tap its words and you
land on the line; press and hold a card to drag it into another column.

\`\`\`board
This week: pricing-page, beta-list
Waiting on Sam: photos
Done: launch-date
\`\`\`

## The work

- [ ] Write the pricing page ^pricing-page
- [ ] Email the beta list ^beta-list
- [ ] Get the photos back from Sam ^photos
- [x] Pick the launch date ^launch-date
- [ ] Book the venue, which is not on the board at all

## Anything in a list can be a card

A name after a \`^\` is not only for to-dos. A bullet takes one, and so does a numbered step, which is how something
with nothing to tick gets onto a board: a question to ask, a thing to keep an eye on.

- Ask Sam which photos are cleared ^ask-sam
- The old pricing page, until the new one is up ^old-page

The name is also how the words point at the work: the pricing page is waiting on [[#^ask-sam]], and tapping that
goes to the line. One name, pointed at from the board and from the middle of a sentence.

## How to change it

- Press and hold a card, then drag it: into another column, or up and down its own.
- Move a card with the chevrons on it instead; the fence above is rewritten either way.
- Add one with the **+** on a column: it writes a new to-do into the note and puts the card in that column.
- Take a card off the board by taking its name out of the fence. The item stays in the note.
- Tap the fence itself to edit the columns as text: rename one, add one, reorder them.

A second board in the same note is another fence, and an item can sit on both.

\`\`\`board
Someday: venue
\`\`\`

- [ ] Find a venue for the party ^venue
`;
}
