import { imageMarkdown } from './images.ts';
import smokeUrl from '../assets/sample-smoke.jpg';

/**
 * The sample note: a short tutorial for formatting everything, one mark at a
 * time - how to type it, how to say it, and one example (Matt: "replace the
 * 'everything a note can hold' as a short tutorial for formatting
 * everything"). It took over from the guide's Markdown step, which was taken
 * out. It began as a note with every kind of mark in it ("add a default note
 * with every kind of markdown formatting and table and image and everything
 * we support"), and it still has one of each: the tests hold it to that. A
 * fresh library gets it once (seed.ts), and Settings > About makes another
 * whenever wanted.
 *
 * The words are the note's own explanation of itself, in the app's voice.
 * The picture is a photograph of smoke by Jocelyn Morales, from Unsplash
 * under the Unsplash License (docs/THIRD_PARTY.md), bundled with the app
 * and copied into the library's pictures the way a pasted picture is
 * (core/images.ts), so the note holds a real `![…](image/…)` line and not a
 * special case. (An ink cassette drawn in SVG came first; Matt: "quite ugly".)
 * Where the picture can't be fetched (a test) the note has no picture and
 * says nothing of one.
 */

export const SAMPLE_TITLE = 'How to format a note';

/** The note's body, with the picture line when there is a picture to show. */
export function sampleNoteBody(image: string | null): string {
  const picture = image
    ? `## Pictures

Paste one, or press and hold and choose Add image. It sits under its own line, and the line stays:

${imageMarkdown(image, 'A wisp of smoke, by Jocelyn Morales')}

`
    : '';
  return `# ${SAMPLE_TITLE}

A note is plain Markdown: words with a few marks around them. Type a mark, or say its word while recording, and Ghost.md draws it. The marks stay on the page, a little dimmed. Try each one here, then delete this note.

## Headings

Type \`#\` and a space for the note's name, \`##\` for a section, and more hashes, up to six, for smaller ones. Say "heading", or "subheading".

### Three hashes

#### Four

##### Five

###### Six

## Words

Two stars for **bold**, underscores for _italic_, three stars for ***both***, two tildes to ~~strike~~, and backticks for \`code\`. Say "bold", then "end bold"; italic works the same way. A backslash makes a mark mean itself: \\*not italic\\*.

Two pipes each side keep a secret, drawn as smoke until the caret is in it: ||the key is under the third stone||.

## Ghost.md's own marks

Two of the same sign each side: ==highlight==, %%an aside%%, ??unsure?? (with a reason in brackets after it: ??the deposit??(ask Sam)), ^^shout^^, and ++added++. Say "highlight", then "end highlight"; the others work the same way.

## Lists

A dash for a point, indented for a smaller one. Say "bullet point".

- Milk
  - Oat, if they have it

A number and a dot for steps. Say "number one", "number two".

1. Wake up
2. Write it down

A dash and a box for a to-do; tap the box to tick it. Say "remember to".

- [ ] Book the cabin
- [x] Call Sam

## Quotes

A line that starts with \`>\`. Say "quote".

> The note you make on the way is the one you keep.

## Links

Words in brackets and the address after: [Ghost.md](https://attack.fm/glyph). An address on its own line gets a card with the page's title:

https://attack.fm/glyph

## Tables

Pipes between cells and a row of dashes under the first. Or say "Hey Ghost, add a table to this note" and answer its questions. Tap a drawn table to change it.

| What | Where |
| :--- | ---: |
| Tent | Garage |
| Stove | Loft |

## Code

Three backticks above and below, with the language after the first three:

\`\`\`js
const note = 'said, then written';
\`\`\`

## A line across

Three dashes on a line of their own:

---

${picture}## Without typing

Press and hold on any words and choose Style to put one of these marks on them.
`;
}

/** The bundled photograph as a JPEG blob; null where it can't be fetched. */
export async function sampleImageBlob(): Promise<Blob | null> {
  if (typeof fetch !== 'function') return null;
  const response = await fetch(smokeUrl).catch(() => null);
  if (!response?.ok) return null;
  return response.blob();
}
