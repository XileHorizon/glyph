import { saveImageFile } from './images.ts';
import { boardNoteBody } from './boardNote.ts';
import { howCanvasBody } from '../canvas/howCanvas.ts';
import { sampleCanvasBody } from '../canvas/sampleCanvas.ts';
import { sampleImageBlob, sampleNoteBody } from './sampleNote.ts';
import { createNote, newNoteId, type Note } from './store.ts';

/**
 * The sample note's arrival (core/sampleNote.ts). A fresh library, with no
 * notes in it, gets it once, so the first thing a new person opens shows
 * every mark the app draws; a library that already has notes is left alone
 * and marked done, so an update never drops a note on someone. Settings >
 * About adds one on request at any time, which is how Matt sees it on a phone
 * full of notes.
 *
 * The mark is a key in localStorage, the way the guide's is, and a reset
 * clears it with the rest (core/reset.ts).
 */

export const SAMPLE_SEEDED_KEY = 'glyph-sample-note';

export function sampleNoteSeeded(): boolean {
  try {
    return localStorage.getItem(SAMPLE_SEEDED_KEY) !== null;
  } catch {
    // Nowhere to remember it: better never to seed than to seed on every open.
    return true;
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SAMPLE_SEEDED_KEY, new Date().toISOString());
  } catch {
    // Nowhere to remember it.
  }
}

/** Makes the sample note now, picture and all where a picture can be drawn, and answers it. */
export async function addSampleNote(): Promise<Note> {
  let image: string | null = null;
  try {
    const blob = await sampleImageBlob();
    if (blob) image = await saveImageFile(blob);
  } catch {
    // No picture, then: the note says nothing of one.
    image = null;
  }
  const note = await createNote(newNoteId(), sampleNoteBody(image), 'editor');
  markSeeded();
  return note;
}

/** Makes the example board (core/boardNote.ts) now, and answers it. */
export async function addBoardNote(): Promise<Note> {
  return createNote(newNoteId(), boardNoteBody(), 'editor');
}

/** Makes the example canvas (canvas/sampleCanvas.ts) now, its picture kept where one can be drawn, and answers it. */
export async function addCanvasNote(): Promise<Note> {
  let picture: string | null = null;
  try {
    const blob = await sampleImageBlob();
    if (blob) picture = await saveImageFile(blob);
  } catch {
    // No picture, then: the canvas is made without its picture card.
    picture = null;
  }
  return createNote(newNoteId(), sampleCanvasBody(picture), 'editor');
}

/** Makes the canvas that says how Glyph works (canvas/howCanvas.ts) now, and answers it. */
export async function addHowCanvas(): Promise<Note> {
  return createNote(newNoteId(), howCanvasBody(), 'editor');
}

/**
 * The sample note for a fresh library only: made when the library holds
 * `noteCount` of nothing and it has never been made; a library with notes
 * is marked done and left as it is. Answers the note made, or null.
 */
export async function seedSampleNote(noteCount: number): Promise<Note | null> {
  if (sampleNoteSeeded()) return null;
  if (noteCount > 0) {
    markSeeded();
    return null;
  }
  return addSampleNote();
}
