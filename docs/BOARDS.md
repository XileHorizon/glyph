# Boards in markdown

A kanban board in a Glyph note is plain markdown. Nothing is stored beside the note, nothing is lost opening it
somewhere else, and a person reading the raw file sees the same board in words.

Matt: "define and create a markdown standard we use to create kanban boards and task management boards entirely
within markdown, linking the tasks in the board to a task on the page", and later "come up with a generic way to
link list items to the board".

## The shape

Two ordinary pieces of markdown, which is the whole standard.

**1. An item carries an anchor.** Any list item may end with `^` and a name:

```markdown
- [ ] Ship the pricing page ^ship-page
- [x] Pick a launch date ^pick-date
- Ask Sam which photos are cleared ^ask-sam
1. Unplug it ^unplug
```

The anchor names that item so something else can point at it. It is the block id other markdown tools write the same
way, and it reads as plain text anywhere. A bullet, a numbered step and a to-do all take one: **the anchor is the
generic link**, and a board is only the first thing that uses it.

Glyph names the anchors it makes from the item's first three words that carry meaning, leaving out filler: "Add
ability to auto-tag notes" is `add-ability-auto`, not `add-ability-to`. An anchor already in a note is never renamed,
since something may already point at it.

The anchor must have a space before it and nothing after it but the end of the line, which is what keeps it apart
from a superscript: `E = mc^2^` and `- the 2 ^nd^ of June` are superscripts, `- Ship it ^ship-page` is an anchor.

An item linked to Notion or GitHub carries a mark as well (`core/itemLinks.ts`), and the order is always words, then
mark, then anchor:

```markdown
- [ ] Ship the pricing page [notion](https://…) ^ship-page
```

Glyph writes it that way and reads it that way. A line written the other way round, `^ship-page [notion](https://…)`,
is still read as the same item: a mark is the one thing allowed after an anchor. An item's anchor is never part of
what it says, so it is never sent to Notion or GitHub as part of a title.

**2. A fenced `board` block lays the columns out.** Each line is a column: its name, a colon, then the anchors of the
items in it, in the order they sit:

````markdown
```board
To do: ship-page, ask-sam
In progress: unplug
Done: pick-date
```
````

That is all. A renderer that knows nothing about boards shows a code block and a list of items, both readable. Glyph
draws the columns as a board and the items as cards.

**The board's own settings go after the word.** One so far: `height`, how tall the lanes are, in the lanes' own ems,
so a board keeps its number of cards when the text size changes. It is kept between 5 and 60, to the half em:

````markdown
```board height=18
To do: ship-page, ask-sam
```
````

With no height every lane shows all its cards, and the board is as tall as its longest lane. With one, a lane with
more cards than fit scrolls inside itself. Anything else after the word is left as it is and read by nothing yet,
and a renderer that knows nothing about boards takes all of it as the block's info string.

## Pointing at an item from the words

The same anchor works in the middle of a sentence:

```markdown
The pricing page is waiting on [[#^ask-sam]].
```

`[[#^anchor]]` is an item in this note; `[[Note title#^anchor]]` is one in another note (`editor/wikiLinks.ts` owns
the title half, `core/boards.ts` the anchor half). It is drawn as a quiet link and tapping it goes to the line. An
anchor nothing answers is drawn dotted rather than hidden, so a name that has gone can be seen.

This is why the anchor is worth having on every kind of item, not only on the ones a board names: one name, pointed
at from a column, from a sentence, or from another note.

## The rules

- **A card is an item.** A card shows the words of the item with that anchor, and its tick box is that item's tick
  box. Tapping the words puts the caret on the item in the note: the card and the item are the same thing.
- **An item with no box is a card with no box.** A bullet or a numbered step is a card with a dot where the tick
  would be: something on the board that is not work to be finished.
- **An anchor names one item.** The first item with that anchor wins; a second is ignored.
- **An id in two lanes belongs to the first of them.** The rest of its mentions are dropped when the fence is read, so
  a card is drawn once and the fence written back says what the board shows. Written into two lanes by hand, a card
  used to be drawn twice in the first lane, and the lane it had been put in showed nothing.
- **An id is read as the anchor it means.** `Fix Login`, or `^Add Controls To`, is `fix-login` and `add-controls-to` -
  but only when the note has an item with that anchor, so words after a colon that name nothing are left where they
  are instead of becoming a card of their own. Ids are written back the one way, as an item's own anchor is.
- **A card whose item is gone** is drawn as a missing card with its anchor, so nothing disappears silently.
- **A card whose anchor has slipped** is still its item. When no item has the card's anchor, but exactly one item that
  no board names has an anchor a slip away from it (a letter added, dropped or changed, or up to two more or fewer at
  the end), the card shows that item and ticks and moves it (Matt: "the second item got glitched out on the board" -
  the fence said `blur-bottom-swimlanes`, the line `^blur-bottom-swimlaness`). The note is not rewritten.
- **Going to an item puts the caret at the end of its words**, before its mark, counters and anchor, whether from a
  card or from a pointer, so what is typed next goes on the words and never into the name.
- **An item with no card** is an ordinary list item. A board never has to hold every item in the note.
- **A column called Done means done.** An item ticked anywhere is drawn in the Done column if the board has one, and
  ticking a card moves it there; unticking puts it back in the first column. Dragging a card into Done ticks it, and
  dragging it out unticks it. A board with no Done column leaves the ticks to the items.
- **A tick can put an item on the board.** An item that is not a card, ticked in a list whose other items ARE cards,
  joins that board and lands in Done, its line gaining the anchor that names it (three such items turned up in
  Matt's own note: ticking them moved nothing while the other 57 worked, and nothing said why). It is scoped to the
  item's own list on purpose - a to-do in an unrelated list further down stays where it is, since a board never has
  to hold every item in the note. One tap, one undo, and the card menu's **Take off the board** puts it back.
  The anchor is **appended at the end of the line**, never written by replacing the line: the tick is changing one
  character at the start of that same line in the same transaction, and two changes that overlap cannot both be
  applied. Anything else that writes an anchor while a box is turning has to do the same.
- **The fence follows the ticks, wherever the box is turned.** Tapping the box in the note's list, or a task going
  Done in Notion, moves that card too, in the same edit and the same undo; and any other card whose item is already
  ticked settles into Done at the same time, so a note that has drifted comes right with the next change (Matt, of a
  lane holding seventeen ids and drawing two: "items are in the Doing swimlane in the board code"). A card someone has
  just moved by hand stays where they put it.
- **A board on screen reads its open tasks.** A task can only go Done once Glyph has read it again, and an open note
  re-reads the linked items on screen (`editor/links.ts`). A board is drawn as one block in place of its fence, so it
  is not among CodeMirror's `visibleRanges`, and its cards' items usually sit far below it. Read only by their own
  lines, a board being looked at never learned its tasks were done (Matt: "a lot of the notion tickets aren't moved to
  done": four cards in To do, all Done in Notion, their items sixty lines down). So the unticked to-dos on any board in
  the viewport are read too. Only those: they are the cards that can move, and his board holds 66 cards, so reading
  them all each minute would be 66 Notion reads a minute for four that could change.
- **Column names are free.** "To do", "Waiting on Sam", "This week": anything up to the colon, and the same name
  twice is one column.
- **Empty columns stay.** `Blocked:` with nothing after it is a column with no cards, not a mistake.
- **A note may hold several boards.** Each fence is its own board; anchors are shared across the note, so the same
  item can sit on two boards.

## What Glyph does with it

- `src/app/core/boards.ts` reads and writes both pieces, and is the only place that knows the syntax.
- `src/app/editor/boards.ts` draws the board in a note, and puts the caret in the fence when it is tapped for editing,
  the way a table steps aside (`editor/tables.ts`).
- Moving a card, ticking it, or adding one rewrites the fence and the item line as a person would have typed them.
- `src/app/core/boardNote.ts` is the example note, added from Settings.
- A note that is already a list becomes a board from More → **Make a board**: every item is given a name at the end,
  and a fence of `To do / Doing / Done` goes in under the title, with whatever is ticked already in Done. A list
  inside a block of code is left alone. Nothing else about the note changes, and one Undo puts it back.
- **One list at a time** (Matt: "add ability to auto list a section of list items into a board"): press and hold an
  item and choose **Board from list**. The list it is in - its items, the lines indented under them, a single blank
  line between two of them, up to a heading, a paragraph, a block of code or two blank lines - becomes a board set in
  just above it (`core/boards.ts` `listAround`, `boardFromList`). Select several lines first and those lines are the
  list instead. The rest of the note is left as it is, so a note can hold a board for each of its lists; a list that
  already has a board right above it is not offered again. **Add to board** is still there beside it, for putting one
  item on a board (Matt: "add an 'add to board' option when other items in the list are in a board already"): the
  board its own list is already on, else the nearest one above; the first lane, or Done when the item is ticked; and
  beside the neighbour it follows in the list, so the board keeps the list's order. The lane it went to is said
  aloud, since the board is often off the screen.
- A card says its item's words with the markdown taken off — a link reads as its own words, not its URL — and shows
  three lines at most. The note below always has the whole thing.

## By voice

Matt: "add voice commands and cues for adding to swimlanes on the board". While a note with a board is being
recorded into, a lane is named the way a note is, and the recorder asks before it acts:

| Say | What happens |
| --- | --- |
| "Glyph, add *words* to *lane*" | A new to-do with those words, its card at the top of that lane. "Glyph, add call Sam to Doing." |
| "Glyph, move *item* to *lane*" | The item the words name moves to that lane; into Done it is ticked, out of Done unticked. "Glyph, move the pricing page to the Done column." |
| "Glyph, make this a board" | The note's list becomes a board, as More → **Make a board** does. |

A lane can be said with or without "the", "lane", "column" or "swimlane" around it. A lane wins over a note of the
same name only when it is the better match. The recorder reads the command (`capture/command.ts`, plan kinds `lane`,
`card` and `board`); `core/boards.ts` finds the lane and makes the change:

- `lanesOf(body)` lists every board's lanes, and `matchLane(spoken, lanes)` finds the one a name says - case,
  spacing, hyphens, a leading "the" and a trailing "lane", "column" or "swimlane" aside, "finished" or "complete" for
  Done - with a score on the same footing as a note's name, so a lane and a note called the same are weighed fairly.
- `addToLane` writes a new to-do under the board's last item, named after its words, with its card at the top of the
  lane, as the **+** field does.
- `moveToLane` finds the list item the words best match (three words in five), names it if it has no anchor, and
  moves its card to the end of the lane. Into Done its box is ticked, out of Done unticked, as a drag would.

## On a phone

Matt: "add a way to tap and drag to re organize items in lanes and make the UI / UX of these boards friendlier on
mobile". What that means on the page:

- **Press and hold a card, then drag it.** A copy of the card follows the finger and the card itself opens as the
  gap where it will land, in its own column or another. Letting go writes the fence: `putCardAt` puts the card at the
  place the gap was showing, so a card can be reordered inside a lane and not only moved between them.
- Before the hold is up, the finger scrolls the board as it always did. Held against either edge, the board scrolls
  itself along so a card can be taken to a column that is off the screen. Held near the top or foot of the screen,
  the note scrolls, so a card can be taken down a lane longer than the screen; in a lane with a set height that has
  more cards than it shows, the lane scrolls instead.
- The chevrons stay. They do the same thing a tap at a time, for a hand that would rather not drag and for anything
  driving the app by keyboard, and every control on a card is a thumb's width.
- Columns snap as they scroll, one to a screen, and in a lane that scrolls, its name stays at the top while its
  cards go by.
- **A note scrolls past a board in one sweep** (Matt: "scrolling past boards is glitchy and stops scroll
  momentum"). Three things used to catch the finger, and none do now:
  - A lane with no set height never scrolls inside itself. Lanes used to stop at a cap and scroll, and would not
    let go: a fling that landed on one moved the lane and stopped the note dead.
  - A lane with a set height still scrolls, but hands the finger on to the note at either end. The board itself
    only ever scrolls sideways.
  - The editor knows how tall a board is before it is on the screen. It used to count an undrawn board as one line,
    and when the board came into view the editor moved the note by the difference (a screenful), which on a phone
    stops a fling. A board's height is now remembered by what it shows, across launches, and a board never drawn
    has its height worked out from its lanes and the length of its cards' words. The board keeps no vertical margin
    of its own for the same reason: the editor measures a block by its border box.
- An empty column is not a blank space (Matt: "add an icon when there are no items in a board like no todo items or
  no doing tasks"). At rest it shows a picture and a line by what its name says it is for: a checklist and "Nothing
  to do" for To do, Backlog, Next and the like; an hourglass and "Nothing in progress" for Doing or In progress; a
  double tick and "Nothing done yet" for Done; an empty tray and "No cards" for any other name. The lane runs as tall
  as the board's tallest, or its set height, and the picture sits in the middle of it. While a card is held,
  every column becomes an outlined target that says "Drop a card here".
- **+** on a column opens a field at the top of it. The words come first: Enter (or Add) writes
  `- [ ] the words ^anchor` under the board's last item, with the anchor named after the words, and puts the card at
  the top of that column. The field stays open and empty for the next card, and Escape closes it. Nothing is written
  until there are words, so no card is ever named `^item`, and no caret goes into the note to leave a box without its
  space. The board is redrawn in place as cards arrive, which is what keeps the field, and the phone's keyboard,
  between them.
- The anchor at the end of a line is drawn small and faint: the line reads as its words, and the name is there when
  it is wanted.
- **The line under a board sets its height** (Matt: "make board height configurable with glacierUI split view"). It is
  Glacier's split-pane divider, a hairline with a grip, made for a board that sits in a scrolling note: drag it, step
  it with the arrow keys, send it to either end with Home and End, or double-tap it to give the board back its own
  height. The lanes follow the finger as it moves, and `height=` is written into the fence when the finger lifts:
  one change, one undo. The line takes a finger's width of touch.
- **Its handle is the grip pill at the middle of that line** (Matt: "Add resize handle in the bottom middle of board
  to resize", then "the resize handle under the board changed and doesnt match the simplistic version anymore"): a
  small rounded bar and nothing drawn on it, always showing, since a phone has no hover. It turns white while it is
  held or has the focus, and on a computer it says "Drag to resize the board".
- **A lane with more below goes to smoke at its foot** (Matt: "the blur at the bottom of the swimlanes should be the
  wisp effect we use on text"). Only while there are cards under the lane's foot: the app's wisp edge, the words and
  cards bending and softening into the lane's ground as they go, over a short fade (`art/wispFoot.ts`, one filter
  made for the lanes' height). With Settings' smoke switched off, with reduced motion, or in WebKit, which paints
  such a filter black, the lane keeps the plain fade.
