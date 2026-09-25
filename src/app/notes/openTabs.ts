/**
 * The notes a person has open, as tabs across the top of a note (Matt: "add
 * tabs at the top of the app for the different notes that are open").
 *
 * "Open" is real state, not chrome: the ids are kept in App.tsx while the app
 * runs, so switching tabs goes straight back to a note instead of reloading
 * it, and closing one falls through to the next rather than to the list. A
 * note opened any way at all joins the row: from the list, from a `[[link]]`,
 * from a finished recording. Deleting or archiving takes it out again.
 *
 * Pure, so every rule here is a test rather than something to click through.
 */

/** How many notes stay open. Past this the one opened longest ago drops off, as a browser's tab strip never does but a phone's patience does. */
export const MOST_TABS = 8;

/** `id` opened: at the end of the row, or moved nowhere if it is already there. The oldest drops off past `MOST_TABS`. */
export function addOpen(open: readonly string[], id: string, most = MOST_TABS): string[] {
  if (open.includes(id)) return [...open];
  return [...open, id].slice(-most);
}

/**
 * `to` opened in `from`'s place: moving within a book stays in the book's one tab (Matt: "the book should open in
 * one tab instead of each page opening in a new tab"). Where `to` already has a tab of its own, `from`'s closes and
 * that one is used, so the row never gains a tab for a page; where `from` is not in the row, `to` is added as any
 * note is.
 */
export function swapOpen(open: readonly string[], from: string, to: string): string[] {
  if (from === to) return [...open];
  const at = open.indexOf(from);
  if (at < 0) return addOpen(open, to);
  if (open.includes(to)) return open.filter((each) => each !== from);
  return open.map((each) => (each === from ? to : each));
}

/** `id` closed, or gone from the library. */
export function closeOpen(open: readonly string[], id: string): string[] {
  return open.filter((each) => each !== id);
}

/**
 * Where to land when the open note is closed: the tab after it, else the one
 * before it, else nowhere (the list). The same answer serves a note deleted
 * or archived from under the person.
 */
export function afterClose(open: readonly string[], id: string): string | null {
  const at = open.indexOf(id);
  if (at < 0) return open[open.length - 1] ?? null;
  return open[at + 1] ?? open[at - 1] ?? null;
}

/**
 * `id` dragged to sit at `to`, counted among the tabs as they are (Matt: "Add dragging around tabs into different
 * positions"). The row a person drags is the notes that still exist, so `to` is an index into that row rather than
 * into the whole of `open`, which may carry ids the library no longer has.
 */
export function moveOpen(open: readonly string[], shown: readonly string[], id: string, to: number): string[] {
  const from = shown.indexOf(id);
  if (from < 0) return [...open];
  const landing = Math.max(0, Math.min(shown.length - 1, to));
  if (landing === from) return [...open];
  const order = [...shown];
  order.splice(from, 1);
  order.splice(landing, 0, id);
  // The ids that are no longer notes keep their places at the end, so nothing is lost by reordering what is visible.
  const rest = open.filter((each) => !shown.includes(each));
  return [...order, ...rest];
}

/** The open ids that are still notes, in order: a note deleted on another device leaves no ghost tab. */
export function openOnly(open: readonly string[], ids: ReadonlySet<string>): string[] {
  return open.filter((id) => ids.has(id));
}
