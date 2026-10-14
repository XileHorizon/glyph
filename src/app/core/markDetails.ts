/**
 * What an item's mark links to, read back: a Notion task's status and a few
 * facts about it, for the pill at the end of the item and the card a tap on
 * the pill opens.
 *
 * Matt: "When an item is linked to notion it should show a few key details".
 * A mark (core/itemLinks.ts) only says what an item is linked to and where; the
 * plugin that owns the mark's name knows how to read the thing behind it. So
 * the editor asks here by the mark's name and address, and a plugin answers
 * through a provider it registers (plugins/registry.ts). Nothing here names a
 * plugin, and a switched-off plugin's provider answers nothing, which leaves
 * its pills plain.
 *
 * Reads are the provider's to pace and cache. `peek` is synchronous and cheap,
 * called on every redraw; `want` asks it to read again when what it has is
 * old, and it says so through `markDetailsChanged` when an answer arrives.
 */

/** Where a task is in its life, however its board names the stages. */
export type Stage = 'todo' | 'doing' | 'done';

export interface MarkDetails {
  url: string;
  title: string;
  /** The board's own word for the stage ("In progress"), or null on a board without one. */
  status: { label: string; stage: Stage } | null;
  /** At most two short facts for the pill, most telling first: "P1", "Due Sep 20". */
  brief: string[];
  /** Every property with a value, in the board's order, for the card. */
  fields: { label: string; value: string }[];
  /** When the task last changed, in milliseconds, if the service says. */
  editedAt: number | null;
  /** When Glyph last read it. */
  readAt: number;
  /** In the service's trash: shown, but not as a live task. */
  gone?: boolean;
}

export type MarkEntry = { state: 'ready'; details: MarkDetails; loading: boolean } | { state: 'loading' } | { state: 'failed'; message: string };

/** Something to do with a linked thing, offered on its menu (editor/MarkMenu.tsx). */
export interface MarkAction {
  id: string;
  label: string;
  /** The menu draws it: 'done' a ticked circle, 'reopen' a turn back, 'rename' a pen. */
  icon: 'done' | 'reopen' | 'rename';
  /** The words while it runs: "Marking done…". */
  busyLabel: string;
  /** Answers the sentence to show when it's done, if any. */
  run(): Promise<string | void>;
}

export interface MarkDetailsProvider {
  /** What is known about `url` now: a cached answer, a read in flight, or why it can't be read. Null when there is nothing to show. */
  peek(url: string): MarkEntry | null;
  /** Reads `url` again if what is known is old, or now with `fresh`. */
  want(url: string, fresh?: boolean): void;
  /** Opens the thing itself, in the service's app or the browser. */
  open(url: string): Promise<void>;
  /**
   * Whether an ordinary link to `url` is one of this provider's, so a link
   * written the old way (`[Buy milk](https://www.notion.so/…)`) or pasted into
   * a sentence shows its details too, not only a mark.
   */
  reads?(url: string): boolean;
  /** What can be done with it from the menu, beyond Open, Refresh and Unlink; `words` are the item's own. */
  actions?(url: string, words: string): MarkAction[];
}

const providers = new Map<string, () => MarkDetailsProvider | null>();
const listeners = new Set<() => void>();

/** `get` answers the provider for marks called `name`, or null while it can't answer (its plugin off). */
export function provideMarkDetails(name: string, get: () => MarkDetailsProvider | null): void {
  providers.set(name.toLowerCase(), get);
}

const provider = (name: string) => providers.get(name.toLowerCase())?.() ?? null;

export function peekMarkDetails(name: string, url: string): MarkEntry | null {
  return provider(name)?.peek(url) ?? null;
}

export function wantMarkDetails(name: string, url: string, fresh = false): void {
  provider(name)?.want(url, fresh);
}

export function openMarked(name: string, url: string): Promise<void> {
  return provider(name)?.open(url) ?? Promise.resolve();
}

export function hasMarkDetails(name: string): boolean {
  return provider(name) !== null;
}

/** The mark name of the provider that reads an ordinary link to `url`, if one does. */
export function markNameFor(url: string): string | null {
  for (const [name, get] of providers) {
    if (get()?.reads?.(url)) return name;
  }
  return null;
}

export function markActions(name: string, url: string, words: string): MarkAction[] {
  return provider(name)?.actions?.(url, words) ?? [];
}

/** A provider has something new: every pill and card reads again. */
export function markDetailsChanged(): void {
  listeners.forEach((listener) => listener());
}

export function onMarkDetails(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** "3 min ago", for when a task changed or was read. */
export function agoText(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
