import { WORKSPACE_HUES, type WorkspaceHue } from '../core/workspaces.ts';

/**
 * Tab groups, as a browser has them (Matt chose "Chrome-style groups": ones he makes and names himself, and drags tabs
 * into). A group is a name and a colour over a run of tabs; it folds shut to its chip and opens again. It is a second
 * way of organising, beside workspaces: a workspace is where a note lives, a group is how the open tabs are arranged
 * right now.
 *
 * Pure, so every rule here is a test rather than something to drag about and look at. The open tabs keep their own
 * order (notes/openTabs.ts); a group only says which of them belong together, and `displayOrder` draws each group's
 * tabs side by side where its first one stands.
 */

export interface TabGroup {
  id: string;
  name: string;
  /** The same colours workspaces wear (ink.css `[data-hue]`), so the two read as one palette. */
  hue: WorkspaceHue;
  /** Folded shut to its chip. */
  collapsed?: boolean;
}

export interface TabGroups {
  list: TabGroup[];
  /** Which group each note's tab is in, by note id. */
  of: Record<string, string>;
}

export const NO_GROUPS: TabGroups = { list: [], of: {} };

/** The tabs in the order they are drawn: each group's together, where the first of them is in the open order. */
export function displayOrder(open: readonly string[], groups: TabGroups): string[] {
  const out: string[] = [];
  const drawn = new Set<string>();
  for (const id of open) {
    const group = groups.of[id];
    if (!group) {
      out.push(id);
      continue;
    }
    if (drawn.has(group)) continue;
    drawn.add(group);
    for (const member of open) if (groups.of[member] === group) out.push(member);
  }
  return out;
}

/** The open tabs in a group, in the order they are drawn. */
export function membersOf(groups: TabGroups, group: string, open: readonly string[]): string[] {
  return open.filter((id) => groups.of[id] === group);
}

/** The colour a new group takes: the first no other group is wearing, so groups start out told apart. */
function nextHue(groups: TabGroups): WorkspaceHue {
  const worn = new Set(groups.list.map((g) => g.hue));
  return WORKSPACE_HUES.find((hue) => hue !== 'ink' && !worn.has(hue)) ?? 'ink';
}

/** A new group holding this tab, named "Group" to be renamed, in a colour no other group has. */
export function newGroup(groups: TabGroups, noteId: string, id = `g-${Date.now().toString(36)}`): { groups: TabGroups; id: string } {
  const group: TabGroup = { id, name: 'Group', hue: nextHue(groups) };
  return { groups: tidy({ list: [...groups.list, group], of: { ...groups.of, [noteId]: id } }), id };
}

export function joinGroup(groups: TabGroups, noteId: string, group: string): TabGroups {
  if (!groups.list.some((g) => g.id === group)) return groups;
  return tidy({ ...groups, of: { ...groups.of, [noteId]: group } });
}

export function leaveGroup(groups: TabGroups, noteId: string): TabGroups {
  if (!(noteId in groups.of)) return groups;
  const of = { ...groups.of };
  delete of[noteId];
  return tidy({ ...groups, of });
}

export function renameGroup(groups: TabGroups, group: string, name: string): TabGroups {
  const words = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!words) return groups;
  return { ...groups, list: groups.list.map((g) => (g.id === group ? { ...g, name: words } : g)) };
}

export function recolourGroup(groups: TabGroups, group: string, hue: WorkspaceHue): TabGroups {
  return { ...groups, list: groups.list.map((g) => (g.id === group ? { ...g, hue } : g)) };
}

export function toggleGroup(groups: TabGroups, group: string): TabGroups {
  return { ...groups, list: groups.list.map((g) => (g.id === group ? { ...g, collapsed: !g.collapsed } : g)) };
}

/** The group goes; its tabs stay open, ungrouped. */
export function ungroup(groups: TabGroups, group: string): TabGroups {
  const of = Object.fromEntries(Object.entries(groups.of).filter(([, g]) => g !== group));
  return { list: groups.list.filter((g) => g.id !== group), of };
}

/** Memberships of tabs that have closed, and groups with nothing left in them, go. */
export function pruneGroups(groups: TabGroups, open: readonly string[]): TabGroups {
  const openIds = new Set(open);
  const of = Object.fromEntries(Object.entries(groups.of).filter(([id]) => openIds.has(id)));
  return tidy({ list: groups.list, of });
}

/**
 * Where a dragged tab belongs, once it has been dropped at `order` (the new drawn order). Dropped between two tabs of
 * one group, it joins that group - that is how a tab is dragged into a group. Kept in its own group while either
 * neighbour is still in it, so moving a tab about inside its group, or to its edge, leaves it there. Dropped among
 * tabs of no group, or of another group but not inside it, it leaves.
 */
export function afterMove(groups: TabGroups, order: readonly string[], noteId: string): TabGroups {
  const at = order.indexOf(noteId);
  if (at < 0) return groups;
  const before = groups.of[order[at - 1] ?? ''];
  const after = groups.of[order[at + 1] ?? ''];
  const own = groups.of[noteId];
  if (before && before === after) return before === own ? groups : joinGroup(groups, noteId, before);
  if (own && (before === own || after === own)) return groups;
  return own ? leaveGroup(groups, noteId) : groups;
}

/** No empty group, and no tab pointing at a group that has gone. */
function tidy(groups: TabGroups): TabGroups {
  const known = new Set(groups.list.map((g) => g.id));
  const of = Object.fromEntries(Object.entries(groups.of).filter(([, g]) => known.has(g)));
  const used = new Set(Object.values(of));
  return { list: groups.list.filter((g) => used.has(g.id)), of };
}
