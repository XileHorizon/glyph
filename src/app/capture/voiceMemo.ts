/**
 * "Voice memo": the cue that keeps the sound instead of the words.
 *
 * Matt: "allow for voice memos to be left as a bullet point or inline audio segment". Said while recording, what
 * follows is not written down: it stays on the note's tape, and a clip of it is written where it was said
 * (core/clips.ts), so the note has the sound itself for the things transcription cannot carry - a tune, a name
 * nobody can spell, somebody else's voice, the way a sentence was said.
 *
 * It ends the way a cue's sentence ends: "end memo", or a breath. Said after "bullet point" it lands as a bullet,
 * mid-sentence as a segment in the words, because it is written where the cue was.
 */

/** "Voice memo", "audio note", "leave a voice clip": the cue on its own, as a phrase. */
const STARTS =
  /^[\s.,…]*(?:(?:ok(?:ay)?|so|and|then|please)[,\s]+)*(?:(?:leave|take|record|add|insert|start)\s+(?:a\s+|an\s+)?)?(?:voice|audio|sound)\s*(?:memo|note|clip|recording)\b[.,!?:]*\s*$/i;

/** "End memo", "stop the voice note", "end of memo". */
const ENDS =
  /^[\s.,…]*(?:(?:ok(?:ay)?|so|and|then)[,\s]+)*(?:end|stop|finish|close)\s+(?:of\s+)?(?:the\s+|that\s+)?(?:voice\s+|audio\s+|sound\s+)?(?:memo|note|clip|recording)\b[.,!?:]*\s*$/i;

/**
 * A pause this long between phrases closes a memo, the way a pause ends a paragraph: the gap as the streamer reports
 * it, which is 1.7 s for a spoken pause of two and a half seconds or more (capture/markdown.ts PARAGRAPH_GAP_MS).
 */
export const MEMO_GAP_MS = 1500;

/** Whether this phrase asks for a voice memo. */
export function startsMemo(text: string): boolean {
  return STARTS.test(text);
}

/** Whether this phrase closes one. */
export function endsMemo(text: string): boolean {
  return ENDS.test(text);
}
