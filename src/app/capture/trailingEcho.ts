import type { Segment } from './markdown.ts';

/**
 * Whisper's echo at the end of a recording: "…add eggs to Go. Go. Go." When
 * the audio after the last word is quiet, the model often says its last word
 * or two again as sentences of their own. Kevin found "go. go" on the end of
 * his notes, and the command reader took it for part of the last item.
 *
 * A short sentence (three words or fewer) at the very end is dropped when it
 * only repeats the words the sentence before it ended with; when the sentence
 * before is that same short sentence ("…Ohio. Go. Go."), both go. Repeated as
 * long as the end still echoes. Anything that says something new stays.
 */
const MAX_ECHO_WORDS = 3;

const wordsOf = (sentence: string) => sentence.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** How many characters at the end of `text` are echo. */
export function trailingEchoLength(text: string): number {
  const sentences = [...text.matchAll(/[^.!?]+[.!?]*/g)].map((match) => ({ at: match.index ?? 0, text: match[0] }));
  let end = text.length;
  while (sentences.length >= 2) {
    const last = sentences[sentences.length - 1];
    const before = sentences[sentences.length - 2];
    if (!last || !before) break;
    const echo = wordsOf(last.text);
    const said = wordsOf(before.text);
    if (!echo.length || echo.length > MAX_ECHO_WORDS || said.length < echo.length) break;
    const repeatsTheEnd = echo.every((word, i) => word === said[said.length - echo.length + i]);
    // "…Ohio. Go. Go.": the same short sentence twice at the very end is the echo itself, both of them.
    const repeated = said.length === echo.length && repeatsTheEnd;
    if (!repeatsTheEnd) break;
    end = repeated ? before.at : last.at;
    sentences.pop();
    if (repeated) sentences.pop();
  }
  return text.length - text.slice(0, end).trimEnd().length;
}

export function withoutTrailingEcho(text: string): string {
  const cut = trailingEchoLength(text);
  return cut ? text.slice(0, text.length - cut) : text;
}

/** The phrases of a take with the echo taken off the last of them. */
export function segmentsWithoutTrailingEcho(segments: readonly Segment[]): Segment[] {
  const joined = segments.map((segment) => segment.text).join(' ');
  let cut = trailingEchoLength(joined);
  if (!cut) return [...segments];
  const kept = [...segments];
  while (cut > 0 && kept.length) {
    const last = kept[kept.length - 1];
    if (!last) break;
    if (last.text.length <= cut) {
      kept.pop();
      // The space that joined it to the phrase before.
      cut -= last.text.length + 1;
    } else {
      kept[kept.length - 1] = { ...last, text: last.text.slice(0, last.text.length - cut).trimEnd() };
      cut = 0;
    }
  }
  return kept;
}
