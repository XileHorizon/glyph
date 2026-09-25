/**
 * The notes live with another device right now (docs/LIVE.md, "Living with the pass sync").
 *
 * The pass sync leaves such a note alone: two people typing hold words that differ by a few characters in flight at
 * every instant, and a pass in the middle would take the difference for a conflict and split the note. Kept apart from
 * the sessions, with no Yjs in it, so the pass sync can ask without loading live sync at all.
 */
const shared = new Set<string>();

export function markShared(noteId: string, on: boolean): void {
  if (on) shared.add(noteId);
  else shared.delete(noteId);
}

export function isSharedLive(noteId: string): boolean {
  return shared.has(noteId);
}
