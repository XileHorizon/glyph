/**
 * A capture's words on the end of a note's body: what a draft, the live page, the better words and the suite all
 * write with, so they agree on the blank line between (it lived in continuation.ts, which went with memo mode).
 */

/** `addition` below `base`, a blank line between, for a note that grew by another recording. */
export function appendBody(base: string, addition: string): string {
  if (!addition.trim()) return base;
  if (!base.trim()) return addition;
  return `${base.replace(/\s+$/, '')}\n\n${addition}`;
}
