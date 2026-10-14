/**
 * A voice memo left in a note: a stretch of the note's own tape, written where it was spoken.
 *
 * Matt: "allow for voice memos to be left as a bullet point or inline audio segment". A clip is markdown, like a
 * picture is, so a note is still a plain file and nothing is lost by opening it anywhere: `![voice 0:12](tape:12000-19500)`
 * is the tape from 12.0 s to 19.5 s. On its own line after a "- " it is a bullet; in the middle of a sentence it is an
 * inline segment; and the editor draws a small player over it (editor/clips.ts).
 *
 * The times are milliseconds into the note's recording, the same clock the phrases carry (capture/markdown.ts
 * `Segment`), so a clip keeps pointing at the right sound as long as the tape does. A take appended to the tape is
 * added at the end, which is why the recorder writes the times it heard rather than counting from the note's start.
 *
 * A clip also says WHICH tape it means: `tape:12000-19500@k3f9x2`. A note's recording can be removed and another
 * recorded, and the new file starts its own timeline, so times alone would point at whatever sound happens to be
 * there now. The id is the note's tape as the recorder knew it (`tapeId`), kept beside the note on this device
 * because the audio is on this device too; a clip plays only while the note's tape still carries it. A mark with no
 * id is from before this and plays while the note has any recording at all.
 */

export interface Clip {
  startMs: number;
  endMs: number;
  /** The tape this is a piece of, or null on a mark written before clips said. */
  tape?: string | null;
}

/** `tape:12000-19500`, with the tape's id after an @ when it has one, inside a picture-shaped mark. */
const CLIP = /!\[([^\]]*)\]\(tape:(\d+)-(\d+)(?:@([A-Za-z0-9_-]{1,32}))?\)/;
const CLIP_ALL = new RegExp(CLIP.source, 'g');

/** "0:12", the length a person reads on the player. */
export function clipLength(clip: Clip): string {
  const seconds = Math.max(0, Math.round((clip.endMs - clip.startMs) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The markdown for a clip: its length as the words, so a note read anywhere still says what it is. */
export function clipMarkdown(clip: Clip): string {
  const { startMs, endMs } = tidy(clip);
  const tape = clip.tape && /^[A-Za-z0-9_-]{1,32}$/.test(clip.tape) ? `@${clip.tape}` : '';
  return `![voice ${clipLength({ startMs, endMs })}](tape:${startMs}-${endMs}${tape})`;
}

function tidy({ startMs, endMs }: Clip): Clip {
  const from = Math.max(0, Math.round(startMs));
  return { startMs: from, endMs: Math.max(from, Math.round(endMs)) };
}

/** The clip a mark is, or null: not a clip, or times that make no sense. */
export function parseClip(markdown: string): Clip | null {
  const found = CLIP.exec(markdown);
  if (!found) return null;
  const startMs = Number(found[2]);
  const endMs = Number(found[3]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, tape: found[4] ?? null };
}

/** Every clip in `text`, with where its mark sits, in order. */
export function clipsIn(text: string): (Clip & { from: number; to: number })[] {
  const found: (Clip & { from: number; to: number })[] = [];
  for (const match of text.matchAll(CLIP_ALL)) {
    const clip = parseClip(match[0]);
    if (clip) found.push({ ...clip, from: match.index, to: match.index + match[0].length });
  }
  return found;
}

/** Whether a note holds any voice memo. */
export function hasClips(text: string): boolean {
  return clipsIn(text).length > 0;
}

/**
 * Whether this clip is a piece of the tape the note has now: a clip that names one plays only for that tape, and one
 * from before ids plays for whatever recording the note has.
 */
export function playsOn(clip: Clip, tape: string | null): boolean {
  return !clip.tape || clip.tape === tape;
}

const TAPES_KEY = 'glyph-tape-ids';

function tapes(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(TAPES_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The id of the tape `noteId` holds now, or null: the note has none, or its recording is from before ids. */
export function tapeId(noteId: string): string | null {
  return tapes()[noteId] ?? null;
}

/** Names the tape `noteId` holds now. A fresh recording takes a new id; a take appended to one keeps it. */
export function setTapeId(noteId: string, id: string | null): void {
  try {
    const all = tapes();
    if (id) all[noteId] = id;
    else delete all[noteId];
    localStorage.setItem(TAPES_KEY, JSON.stringify(all));
  } catch {
    // Without storage a clip plays while the note has a recording, as one from before ids does.
  }
}

/** An id for a tape starting now: short, and only ever compared with itself. */
export function freshTapeId(): string {
  return Math.random().toString(36).slice(2, 10);
}
