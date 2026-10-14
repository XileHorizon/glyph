# The Glyph library

Glyph keeps notes as a folder of plain Markdown files. The folder is the library: open it in Obsidian, a file
manager, Syncthing or a text editor and every note is there, readable and editable, with nothing locked inside
the app. Glyph adds only what Markdown can't hold on its own: a small hidden folder with an index to find
things fast, and the facts about a note that aren't text (its recording, its AI versions).

Matt's brief: "a folder and sub folders full of purely markdown files with a small flat file things like sqlite
or json files for indexing so we can keep our whole library in these files … it should all render to valid
markdown but store metadata we can specially format such as linked notion tickets and to-do lists." His
choices: a folder he picks, his own folders with titles as file names, Obsidian-compatible metadata, and a
hidden `.glyph` folder for everything else.

## The folder

```
Glyph/                        the library: any folder, picked in Settings › Library
  Inbox/                      where new notes land
  Work/                       any folders the person makes, any depth
    AttackFM.md
    HelloTrade.md
  Weekend trip.md             notes can sit at the top too
  attachments/                pictures notes show, linked relatively
  .glyph/                     Glyph's own, rebuildable, hidden from most apps
    library.json              { "version": 1, "created": …, "movedFrom": …, "movedNotes": … }
    index.sqlite              the index: a cache, rebuilt from the files at any time
    notes/<id>.json           what a note has that isn't text: recording phrases, AI versions
    recordings/<id>.wav       a note's kept recording
```

Deleting `.glyph` loses no writing: the index is rebuilt from the files, and only recordings and AI versions go.

## A note

A note is one `.md` file named after its title: the first heading, or the first line of words. Characters a
file name can't hold (`/ \ : * ? " < > |`) are dropped, long titles are cut at a word, an empty one is
"Untitled", and a clash gets " 2", " 3". When the title changes, the file is renamed. The id in its front
matter keeps it the same note wherever it moves.

**A new note has no file until it has words.** Glyph opens a new note the moment + is tapped, but a note
opened and left empty would be an "Untitled.md" in the folder. Until its first words it is a draft, held in
memory: the open note finds it, the list leaves it out. The first words write the file, with the draft's
created time. A note Glyph started as a draft in this run, whose words are all taken out again, with nothing
else set (no pin, archive, recording, AI version, or front matter beyond `id`, `created`, `source`), goes back
to being a draft and its file is removed. Pinning or archiving a draft writes its file even without words.
A file Glyph didn't start this way is never removed for being empty.

```markdown
---
id: 7c1e0d9a-3f4b-4c55-9a51-2d6f1f0e8b13
created: 2026-09-14T10:32:10.123Z
tags: [bugbash, android]
pinned: true
notion-board: https://www.notion.so/9b64668ab87b46b58acb4c7d4a2b7e5e
---

# AttackFM bug bash

Friday, all hands.

- [ ] Fix the seek bar drift on two devices [notion](https://www.notion.so/3d6522a4…) 📅 2026-09-20
- [x] Downloads stuck on the discover list ✅ 2026-09-14
- [ ] Ship the APK

| Bug | Owner | Status |
| --- | --- | --- |
| Seek bar drift | Matt | Open |

![](../attachments/7c1e0d9a-seek-bar.jpg)
```

### Front matter: YAML, as Obsidian's Properties write it

| Key | Meaning | Written when |
| --- | --- | --- |
| `id` | The note's identity, stable across renames and moves | Glyph first saves the file |
| `created` | When the note was first written, ISO 8601 | Glyph first saves the file |
| `tags` | The note's tags, a list | the note has tags |
| `pinned` | `true`: at the top of the list | pinned |
| `archived` | When it was archived, ISO 8601 | archived |
| `source` | Where it came from, when that isn't typing: `capture` | recorded |
| `notion-board` | The Notion board its list items go to | a board is linked |
| `project` | The GitHub project the AI reads for it, `owner/repo` | a project is linked |

- **Updated** isn't a key. The file's own modified time is when it was last changed, so a save doesn't rewrite
  a date.
- **Unknown keys, comments and formatting are kept exactly as they were.** Glyph only rewrites a line that holds
  a key it manages, and only when that value changes. A file without front matter gets it only when Glyph has
  something to store.
- **Plugin keys are flat** (`notion-board`, not nested), so Obsidian's Properties panel can show and edit them.

### The body: GitHub-flavoured Markdown

- **To-dos** are task list items, `- [ ]` and `- [x]`.
- **Dates on to-dos** use the Obsidian Tasks emoji: `📅` due, `⏳` scheduled, `🛫` start, `✅` done, `🔁`
  recurring, `⏫ 🔼 🔽` priority. They sit at the end of the item.
- **A list item linked outside Glyph** keeps its words plain and ends with a mark: a link whose words are the
  plugin's name, `[notion](https://www.notion.so/…)`, before any Tasks dates. It renders as an ordinary link
  anywhere, and Glyph draws it as a small pill.
- **Tables** are GFM tables. **Pictures** are relative links into `attachments/`. **Links to other notes** are
  ordinary relative Markdown links.

Every note renders as valid Markdown on GitHub, in Obsidian, and in any CommonMark renderer that treats a front
matter block as metadata.

## The index

`.glyph/index.sqlite` holds a row per note: id, path, folder, title, created, modified time and size, pinned,
archived, source, recording length, the AI version's hash and model. It exists so the list opens instantly and
search is fast. It is never the truth:

- **Opening the library** walks the folder. A file whose modified time and size match its row is skipped;
  anything else is read again. A row without a file is dropped.
- **A file without an `id`** (written by another app) gets one in the index at once, and in its front matter the
  next time Glyph saves that note.
- **Two files with the same `id`** (a copy made outside Glyph): the one the index already knew keeps it, and the
  copy gets a new one, written to its front matter when next saved.
- **Rebuild** in Settings › Library deletes the index and walks the folder from scratch.

## What isn't text: `.glyph/notes/<id>.json`

```json
{ "recordingMs": 184000, "segments": [{ "text": "Bug bash on Friday.", "startMs": 0, "endMs": 1900 }],
  "formatted": "# AttackFM bug bash\n…", "formattedFor": 4432109876, "formattedModel": "qwen3.5-4b" }
```

A note's kept recording is `.glyph/recordings/<id>.wav`. Both go when the note is deleted in Glyph, and a
rebuild clears any whose note no longer exists. In phase 1 the recordings and pictures stay where they were in
the app's storage (`recordings/`, `images/`), since the library is in the app's storage too; they move into
the library with the folder picker.

## Moving in

The first time a Glyph with the library opens, every note in the old database is written out as a file:
- **Where:** in `Inbox/`, named by its title.
- **Front matter:** its id and created time, pinned, archived and source.
- **The rest:** recording and AI version into `.glyph/`.

A note with no words and nothing set (no pin, archive, recording or AI version) is left behind: the old app
saved a new note the moment it was opened, so these are notes opened and left, and would each be an empty
"Untitled.md".

The old database is kept beside it, renamed `glyph.sqlite.moved`, and `library.json` records the move. Nothing
is deleted. The rename happens only once every note is written: a move that stops halfway (the app killed,
the storage full) leaves the database in place, and the next launch finishes it, since a note already in the
library is never written twice.

## Phases

1. This spec, and the library in Rust behind the store commands the page already uses, in app storage
   (`<app data>/Library`), with the move from the database. (1.3.0, native generation 15.)
2. Settings › Library: pick a folder with Android's folder picker (the Storage Access Framework), and move the
   library there.
3. Folders in the app: Inbox, making folders, moving notes, pictures in `attachments/`.
4. Plugin links (Notion board, project) and the AI's summaries and enhancements into front matter and `.glyph/`.
