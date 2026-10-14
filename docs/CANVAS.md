# Canvases

A canvas is cards on an infinite page with lines between them: the thing Obsidian calls a canvas, in Glyph. Matt
(2026-09-20): "we're going to build something similar for Glyph". His fifteen choices steer it; this is the standard
they set, and it will grow as the slices land.

## Matt's choices

Fifteen questions, asked on 2026-09-20 before a line was written, and his answers. Build to these; where a thing
was not asked, say so rather than cite him.

1. **What a canvas is:** both a ```canvas fence in a note and a canvas note of its own.
2. **Format:** JSON Canvas 1.0 verbatim, so it opens in Obsidian and back; not a grammar of Glyph's own.
3. **Card kinds, all four in v1:** text; a note (a wiki link, drawn live the way a home card draws one); an item
   (a `^anchor` list item as a card, tickable from the canvas); pictures and web links.
4. **Lines:** arrows with labels - directed, a label if wanted, each end picking its side by itself.
5. **Groups:** yes, in v1: a labelled box whose cards move with it.
6. **Colour:** the page's workspace hues. Not Obsidian's six presets as a palette of the canvas's own, and not
   ink-only. The presets are read as rose, ember, amber, moss, sea, violet; a hex is kept as it is.
7. **Platform:** the phone and the Mac equally - every action by touch and by pointer from the first day.
8. **Adding a card on the phone, all four:** double-tap empty space (a text card under the fingers, keyboard up);
   a + in the dock (text, note, picture or link, landing in the middle of the view); a note dragged from the
   sidebar on a wide screen; by voice ("Glyph, add a card": the words said land near the last card).
9. **The model, all three from the start:** the gist under a note card's title; "Glyph, make a canvas of this
   note" (headings to groups, items to cards, links to arrows - a first draft to push around); lines it thinks
   are missing, offered and accepted with a tap.
10. **Moving about:** pan and pinch; Fit and zoom-to-card (Obsidian's Shift+1 and Shift+2, as buttons and
    shortcuts, and a card's title tapped zooms to it); and a minimap in a corner with the view drawn on it.
11. **Sync:** the same end-to-end encrypted feed as notes; nothing new in the engine.
12. **Boards:** a separate feature. They share anchors and item cards, and nothing else.
13. **Embedding:** a canvas in a note (`![[name.canvas]]`, drawn read-only, tap to open) and as its own note.
    Not chosen: a canvas nested on a canvas, and a home card drawn as a thumbnail.
14. **Export:** the `.canvas` file, and a picture, and a PDF.
15. **The first slice:** read and draw a real Obsidian file faithfully, with pan and pinch; editing second.

**Not asked, so not his:** how a card is moved (a drag, or a press-and-hold first, given one finger pans); how a
card's words are edited (a tap, a double-tap); how a card or a line is deleted; how a line is drawn; resizing,
snapping, duplicating. Obsidian's answers - drag from a card's edge dot for a line, double-click to edit or to
label a line, select and Delete - contradict nothing above.

## The format is JSON Canvas, as it is

A canvas is written in [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), the open format Obsidian's `.canvas`
files use, verbatim (Matt chose interop over a grammar of Glyph's own). A canvas made in Glyph opens in Obsidian; an
Obsidian canvas pasted into Glyph is drawn the same. `canvas/jsonCanvas.ts` reads and writes it.

```json
{
  "nodes": [
    { "id": "book", "type": "text", "x": 0, "y": 0, "width": 260, "height": 100, "text": "# Book the cabin", "color": "4" },
    { "id": "plan", "type": "file", "x": 320, "y": 0, "width": 260, "height": 160, "file": "Launch week.md", "subpath": "#^photos" },
    { "id": "site", "type": "link", "x": 0, "y": 160, "width": 260, "height": 100, "url": "https://attack.fm/glyph" },
    { "id": "before", "type": "group", "x": -40, "y": -40, "width": 660, "height": 340, "label": "Before we go" }
  ],
  "edges": [
    { "id": "e1", "fromNode": "book", "toNode": "plan", "fromSide": "right", "toSide": "left", "label": "then" }
  ]
}
```

Four kinds of node: `text` (markdown on a card), `file` (another note, named by its title as a file: `Launch
week.md` is the note called "Launch week", and a `subpath` of `#^anchor` opens it on that item), `link` (a web
address) and `group` (a labelled box around other cards). Every node has `x`, `y`, `width`, `height` in the
canvas's own pixels, and nodes are in ascending z-order: the first is drawn under the rest. An edge joins two nodes,
leaves and arrives by a side (`top`, `right`, `bottom`, `left` - worked out from where the nodes are when left out),
and has an arrow at its end unless `toEnd` says `none`. A `label` sits on the line.

**Colour** is the spec's: `"1"` to `"6"` are its six presets, whose looks each app chooses, or a hex colour. Glyph
paints the presets as the page's own hues - rose, ember, amber, moss, sea, violet, the ones a workspace wears
(`ink.css`) - and keeps a hex as it is.

**Read leniently, written exactly.** A node that is not what the spec says is left out, not the whole canvas; an edge
to a node that is not there goes with it. What is kept is written back with only the spec's fields, so a round trip
changes nothing anyone meant.

## Where a canvas lives

**As a note of its own.** A note whose body is the JSON is a canvas note, and is drawn as a canvas where its words
would be (editor/NoteScreen.tsx). Obsidian names a canvas by its file; Glyph has no files, so the name is front
matter, which is how any note from outside is named (docs/MARKDOWN.md):

```markdown
---
title: "Cabin weekend, laid out"
---
{
  "nodes": [ … ],
  "edges": [ … ]
}
```

Everything after the front matter is the `.canvas` file, character for character. Settings > About adds an example
one (`canvas/sampleCanvas.ts`), the way it adds the example board: one of everything a canvas holds - a group, cards
of words, cards that are the example board and the sample note, a link, a chart drawn from Mermaid, a table, a
picture (the sample note's drawing, kept by the picture store as it is made), and lines with words on joining them.
A second one beside it, "How Glyph works" (`canvas/howCanvas.ts`), says what the app does in eight plain cards with
the order on the lines - say it, say the marks, it lands as a note, where a note goes, and that it stays on the
phone - two of them the example board and the sample note themselves (Matt: "a simpler canvas explaining how Glyph
works in simpler terms").

**Named from the cog.** A canvas has no heading to rename it in, so the note's cog sheet has a Name field for a
canvas note (editor/NoteSettings.tsx), which writes the `title:` front matter and nothing else
(core/frontMatter.ts). Matt chose that over renaming in the tab or editing the front matter by hand.

**Its JSON, behind the view switch.** The header's switch, which on a note of words goes between the marks and the
formatted page, on a canvas note goes between the canvas and its JSON in the editor, where it can be read and
changed by hand (Matt: "yes, via the Markdown/Formatted switch"). It is the note's own switch, not the preference
every note shares - that one defaults to the marks, and a canvas should open as a canvas. The JSON shown is what the
canvas has written by then; switching back draws what was typed.

**In a note**, as a ```canvas fence, the way a board or a Mermaid diagram sits in a note. Not built yet.

## What is drawn, so far

The first slice reads and draws (`canvas/CanvasView.tsx`): cards where the file puts them, groups behind them,
lines with their arrows and labels, one finger or a wheel to pan, two fingers or a modifier and the wheel to zoom
about the point under them, and Fit. A card of words is the note's own editor, read-only, so it draws exactly as a
note does. A note card draws that note small (notes/NotePeek.tsx) and opens it on a tap - at its anchor when the
card names one; a note not in Glyph is drawn as waiting, the way a `[[link]]` to nothing is. A link card opens its
address.

**The second slice edits.** A double-tap on the page makes a card of words there, open with the keyboard up (choice
8), and the `+ Card` tool makes one mid-screen. A press held on a card lifts it and it goes where the finger goes,
put down to the pixel; a plain drag still pans, so a finger on a card never moves it by mistake. A double-tap on a
card of words opens it to be written in - its editor in the note's own mode, the words going straight into the
canvas - and a card open that way has a cross to take it off, which takes its lines with it. Every change is
written into the note as the spec's JSON with the front matter kept (`jsonCanvas.ts` `withCanvas`), saved the way
typing is, so a canvas edited in Glyph still opens in Obsidian. A canvas shown where it cannot be written - a card
on another canvas, a note not open - stays read-only.

The press-and-hold to move, the double-tap to open and the cross to take off were never put to Matt (the "not
asked" list below); they are the app's own conventions - a board's card and a tab are moved by a held press too -
chosen so one habit serves the whole app, and are his to change.

**The third slice draws lines.** The `Line` tool turns the next two taps into a line, from the first card tapped
to the second, with an arrow at its end and its sides worked out from where the cards are (choice 4); a card cannot
be joined to itself, and two cards already joined are not joined again. A tap on a line picks it - each line has a
wide unseen stroke to land on - and a picked line shows its words to be written and a cross to take it off. While a
line is being drawn a tap on a note card or a link card is the line's, not the card's. A tool rather than a drag
from a card's edge, because a finger has no hover to find an edge dot by, and the two taps read the same on a phone
and with a mouse; that choice was not put to Matt.

**The fourth slice sizes and groups.** A card open to be written in has a corner to drag that resizes it, to the
pixel and no smaller than a word and a cross. A press held on a group lifts it with everything wholly inside it
(choice 5: "cards inside move with it"), measured the way Obsidian measures it - a card is in a group when its whole
box is - and a card lifted on its own leaves its group where it is. A double-tap on a group opens its name to be
written, and a cross there takes the group off while the cards in it stay. Making a group round cards belongs with
the other ways to add, in the next slice.

**The fifth slice adds more ways in** (choice 8). The `+ Card` tool is a sheet: words, a note chosen by part of
its title, or a web address (a bare one is given https). On a wide screen a note dragged from the sidebar lands as a
card where it is dropped (`notes/NoteTree.tsx` makes the rows draggable). Pictures wait, since Glyph has no picture
files of its own to point at; adding by voice belongs to the capture and is not built yet.

**The sixth finds the way** (choice 10). A tap on a card's title zooms to the card; `Fit` and Shift+1 show the whole
canvas, `To card` and Shift+2 zoom to the card open or last tapped. A minimap in the corner draws every card small
with the screen's box over them. A press on it grows it half again, a drag on it moves the screen's box with the
finger, a tap on the grown map goes there, and a press on the canvas puts it back. It appears once a canvas has two
cards. Redone at Matt's
asking ("more detailed and better organized"): each kind of card is told apart - words filled, a note outlined, a
picture filled dark, a link outlined with a dot - a coloured card wears its hue, the lines are drawn between the
sides they leave and arrive by, a group is its dashed box with its name when there is room, the canvas keeps its own
shape centred in the frame, and a finger dragged on the map keeps going. A card that is only a table draws the
table edge to edge, with no padding (Matt: "make the table fill the card").

**The seventh puts pictures, charts and tables on cards** (Matt: "upload and add images and charts and stuff").
The + offers a picture - chosen from the phone or the computer and kept by the picture store a note's pictures use
(`core/images.ts`), so it syncs as they do - drawn to fill its card; a chart, a card of words that starts as a small
Mermaid diagram and is drawn as one (cards draw diagrams, though the sidebar's peeks still do not); and a table. A
picture file dropped on the canvas from a computer is kept and drawn the same. A picture from another vault, named
with a folder, is drawn as waiting, since Glyph has no such file. The tools are a floating toolbar of icons at the
bottom left, each named for a reader, and the map sits at the bottom right.

Not yet: making a group round cards, adding by voice, item cards, a canvas inside a note, export, and the model's
three moves (a gist on note cards, laying a note out as a canvas, suggesting lines). Each is a slice of its own.
