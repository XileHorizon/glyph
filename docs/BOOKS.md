# Books

A book is a collection of notes in an order, with an index. Matt (2026-09-22): "add a Book feature it should be a
collection of organized notes with an index." Like a board (docs/BOARDS.md) and a canvas (docs/CANVAS.md), a book is
a note, and it reads as one anywhere Markdown is read.

## The shape

The book note's body is its index: a list of `[[links]]` to its chapters, in order.

```markdown
---
title: "Field guide"
book: true
---
# Field guide

What to know before the walk.

- [[Introduction]]
- [[Trees]]
  - [[Oaks]]
  - [[Pines]]
- [[Birds]]
```

- **One line of front matter makes it a book:** `book: true`. Without it, a note with a list of links is a note
  with a list of links. The `title:` names it, as a canvas note is named, since the index view has no heading to
  rename it in.
- **A chapter is any note, found by its title.** A link to a title with no note yet is a chapter still to be
  written; the index says so, and opening it makes the note, starting with the title as its heading (App.tsx
  `openTitle`, the same as any `[[link]]`).
- **Order is the list's order; a part is indentation.** A chapter indented under the one before it is numbered
  under it (2.1, 2.2). One level; deeper indentation reads as the same level.
- **The book's own words stay.** Lines that are not chapters - a paragraph before the list, notes to self - are
  kept where they are and shown over the index.
- **A link's heading or alias is not the title:** `[[Trees#Oaks|the oaks]]` is the chapter Trees.

## In the app

- **Making one.** The + offers a Book beside a Note and a Canvas (notes/NewSheet.tsx), and opens the New book
  sheet (book/NewBookSheet.tsx): its name, and which notes are its pages - the library's titles under a search, a tap
  puts one in and a second takes it out, the pages so far listed above in the order chosen, each movable a place or
  left out. *Make the book* writes one note with that index and opens it; closing the sheet makes nothing. Rename it
  later from its tab's menu or its settings, as a canvas is.
- **The Library** on the home page (home/HomeScreen.tsx, `bookNotes` in home/dashboard.ts): a card per book - its
  name, how many pages, the first few of them - between Pinned and Recent; a tap opens the index. A book is not
  also a Recent card.
- **The index view** (book/BookView.tsx) stands where the note's words would be, the Markdown a toggle away in the
  header, as a canvas's JSON is. Each chapter is a row that opens the note; a chapter not written yet is drawn
  waiting. Every row moves up or down a place, or comes out of the book - the note it names is never touched.
  *Add a chapter* names a new one and opens it at once; *Add a note you have* ticks any number from the library's
  titles, less the book's own and those already in it, and adds them in the order ticked.
- **A chapter wears the book** (BookBar): under its header, the book's title with its place (2 of 5) and the
  chapters either side; a tap on the book opens the index. Found by title (book/book.ts `bookOf`): the first book
  in the library whose index names the note. A note can be in more than one book; the bar shows the first.
- **One tab.** A page opened from inside a book - the index, the chapter bar, the right-hand aside, the read-through -
  takes the current tab's place rather than a tab of its own; a page that already has a tab is used and the book's
  closes (notes/openTabs.ts `swapOpen`). A `[[link]]` in the words still opens a tab, as any link does.
- **Writing is writing the note.** Every change from the view is a change to the book note's body, saved the way
  typing is, so the index behind the view and the view are one thing, and a book edited as Markdown in another app
  draws the same on the phone.

## Not yet

- Reading a book straight through as one page, chapter after chapter.
- Making a book by voice ("Ghost, add a chapter to the field guide").
- A book mark on a note in the list.
- Reordering by drag; the rows move a place at a time.

## Where the code is

| file | what |
| --- | --- |
| `src/app/book/book.ts` | the shape: `isBookBody`, `bookNoteBody`, `chaptersOf`, `numbered`, `prefaceOf`, `withChapter`, `withoutChapter`, `withChapterMoved`, `bookOf` |
| `src/app/book/BookView.tsx` | the index view, and `BookBar` for a chapter |
| `src/app/core/frontMatter.ts` | `frontMatterValue`, the one front-matter read the app makes |
| `src/app/editor/NoteScreen.tsx` | a book note drawn as its index, with the Markdown a toggle away; a chapter's bar |
| `src/app/notes/NewSheet.tsx`, `src/app/App.tsx` | the + makes one; a chapter's place is found for the screen |

## Canvases as pages

Matt: "Add the ability for canvases to be in books as well." A canvas is a note found by its title like any other, so
it was already a page a book could hold: offered by the New book sheet and the index's picker, opened as a canvas, and
wearing the chapter's bar ("Cabin trip · 2 of 3", the pages either side). What the index lacked was saying so. A
chapter that is a canvas, and a canvas offered in the index's picker, now wear the canvas's own mark after the title -
the one the + sheet gives a canvas - and a reader hears "Route map, a canvas" (book/BookView.tsx, `bodyOf` from the
note screen). A chapter with no note yet says nothing of what it will be.
