# Sharing a note or a book

A note or a book can be shared as a read-only link. Anyone with the link can read it, and nobody else can, the
server included. A reader can keep a copy: download it as Markdown, or save it into their own Ghost.md.

Matt's answers, 2026-09-22: "Anyone with the link, encrypted"; "Follows your edits"; "A small standalone page use
only components from the actual app this is more of a reader page"; and both "Download as Markdown" and "Save a
copy into their app".

## The link

    https://attack.fm/glyph/read.html#<id>.<key>

- **The id** is 16 random bytes, base64url. The server stores the share under it.
- **The key** is 32 random bytes, base64url: the AES-GCM key the share is sealed with (sync/crypto.ts `sealBytes`,
  context `glyph/v1/share`). It sits after the `#`, which a browser never sends. The server only ever holds
  ciphertext and never sees a key.
- The link is the whole grant. Stopping a share deletes it on the server, so the link reads nothing from then on.
  A link can't be narrowed after it's sent: anyone who has it can read the share until it stops.

## What is shared

share/share.ts `sharedOf` builds `{ v: 1, kind, title, pages: [{ title, body }], at }`.

- **A note** is one page: its body as stored, front matter and all. A canvas note is shared the same way.
- **A book** is its index first, then every chapter that has a note, in the index's order. A chapter with no note
  yet is left out, and the reader shows it as "not written yet".

## Following edits

The owner's device keeps a registry in `glyph-shares`: note id to share id, key, and a digest of what was last
sent. `followShares` listens for saved notes and, three seconds after the last save, re-seals every share whose
contents changed (a book's share changes when any of its chapters does) and sends it again. A share never changes
its link.

Sharing needs an account (Settings › Account), since the server keeps a share with the account that made it.

## The server

server/src/shares.rs, beside sync:

| Route | Who | Does |
| --- | --- | --- |
| `PUT /glyph/api/v1/shares/{id}` | the owner, signed in | stores or replaces the sealed blob |
| `DELETE /glyph/api/v1/shares/{id}` | the owner, signed in | removes it; another account's id does nothing |
| `GET /glyph/api/v1/shares/{id}` | anyone | the sealed blob, `Cache-Control: no-store` |
| `GET /glyph/api/v1/shares` | the owner, signed in | the owner's share ids |

| Limit | Value |
| --- | --- |
| One share | 6 MB sealed |
| Shares per account | 500 |
| Public reads per IP | 240 a minute |

The `shares` table cascades on the account, so deleting an account deletes its shares.

## The reader page

read.html is a second Vite entry (src/read/). It is built only from the app's own parts:

- the note's editor, read-only and in its formatted view;
- the canvas, read-only;
- a book's index as a list of chapters, and the bar a chapter wears, stepping only between chapters in the share.

It follows the system's light or dark setting. Its header has two ways to keep what's shared:

- **Download as Markdown:** a note as its `.md`; a book as a `.zip` of its pages (share/zip.ts, stored, not
  compressed).
- **Save to my Ghost.md:** on the web, a link to the app with `#fork=<id>.<key>`, which App.tsx reads once on
  load, removes from the address, and saves. In the phone or Mac app, **+ › From a shared link** takes the pasted
  link, or any text with it inside.

## A saved copy

share/share.ts `forkShared` saves each page as a new note owned by the reader. It does not follow the original.

- A title that is already in the library gets "(shared)", then "(shared 2)" and so on.
- A book's index is rewritten to name the renamed copies, so the copy's chapters are its own.

## Not yet

- A link that opens the native apps directly. Until the next native build brings a link scheme, the + sheet is
  the way in.
- Seeing, in one place, everything that is shared. Each note's cog says whether that note is shared.
