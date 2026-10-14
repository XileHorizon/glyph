import type { CommandDescriptor } from '@glacier/react';
import type { ThemePref } from '../core/preferences.ts';
import type { NoteView } from '../editor/viewMode.ts';

/**
 * Everything Glyph can do, as one list to search (Matt: "build an extensive command palette using the glacierUI kit
 * one").
 *
 * The kit's `CommandPalette` takes descriptors and does the searching, grouping and cursor; this file decides WHAT is
 * offered, which is the part that belongs to the app. Pure: it is handed the state of the app and a set of doings,
 * and answers a list. So every rule about what appears when - a note's commands only over a note, a workspace's only
 * where there are workspaces - is a test rather than something to click through.
 *
 * The order is the order offered: the palette filters and groups but never reorders, so what is likeliest comes
 * first. Nothing here is a shortcut for something Glyph cannot already do; a palette that is the only way to reach
 * something is a palette that hides it.
 */

/** A note, as little of it as a command needs. */
export interface PaletteNote {
  id: string;
  title: string;
}

/** The app as it stands, for deciding what can be done right now. */
export interface PaletteWorld {
  /** Every note, newest first: each is an "Open …". */
  notes: readonly PaletteNote[];
  /** The notes open as tabs. */
  tabs: readonly PaletteNote[];
  workspaces: readonly { id: string; name: string }[];
  /** The workspace the list is showing, or null for all notes. */
  workspace: string | null;
  /** The note on screen, if one is. */
  note: PaletteNote | null;
  /** Which workspace the open note is filed in. */
  filedIn: string | null;
  /** Whether the open note is pinned, so the command says which way it goes. */
  pinned: boolean;
  canBack: boolean;
  canForward: boolean;
  view: NoteView;
  theme: ThemePref;
  /** The tab groups (notes/tabGroups.ts), and which one the open note's tab is in. */
  tabGroups?: readonly { id: string; name: string }[];
  tabGroup?: string | null;
}

/** What the palette can set off. Every one of these is something the app already does by hand. */
export interface PaletteDoing {
  openNote: (id: string) => void;
  newNote: () => void;
  speak: () => void;
  speakInto: (id: string) => void;
  closeTab: (id: string) => void;
  showList: () => void;
  back: () => void;
  forward: () => void;
  settings: () => void;
  cheatSheet: () => void;
  guide: () => void;
  academy: () => void;
  chooseWorkspace: (id: string | null) => void;
  fileNote: (noteId: string, workspace: string | null) => void;
  setView: (view: NoteView) => void;
  setTheme: (theme: ThemePref) => void;
  pin: (id: string, pinned: boolean) => void;
  archive: (id: string) => void;
  remove: (id: string) => void;
  /** Tab groups, for a phone, which has no right-click to reach a tab's own menu. */
  groupTab?: (noteId: string) => void;
  joinTabGroup?: (noteId: string, group: string) => void;
  leaveTabGroup?: (noteId: string) => void;
}

export interface PaletteCommand {
  descriptor: CommandDescriptor;
  run: () => void;
}

/** How many notes are offered by name. Past this the palette would be a list of notes rather than of commands. */
export const MOST_NOTES = 40;

const titleOf = (note: PaletteNote) => note.title || 'Untitled';

export function paletteCommands(world: PaletteWorld, doing: PaletteDoing): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const add = (descriptor: CommandDescriptor, run: () => void) => out.push({ descriptor, run });

  // ---- the note on screen -------------------------------------------------------------------
  const note = world.note;
  if (note) {
    const name = titleOf(note);
    add({ id: 'note:speak', label: 'Talk into this note', group: 'This note', keywords: 'record voice dictate mic' }, () => doing.speakInto(note.id));
    add(
      { id: 'note:view', label: world.view === 'mixed' ? 'Show it formatted' : 'Show the marks', group: 'This note', keywords: 'markdown formatted preview read' },
      () => doing.setView(world.view === 'mixed' ? 'formatted' : 'mixed'),
    );
    add({ id: 'note:pin', label: world.pinned ? 'Unpin it from the top' : 'Pin it to the top', group: 'This note', keywords: 'star favourite' }, () => doing.pin(note.id, !world.pinned));
    add({ id: 'note:archive', label: 'Archive this note', group: 'This note', keywords: 'hide file away' }, () => doing.archive(note.id));
    add({ id: 'note:delete', label: 'Delete this note', group: 'This note', keywords: 'remove bin trash' }, () => doing.remove(note.id));
    add({ id: 'note:close', label: `Close the ${name} tab`, group: 'This note', keywords: 'tab shut' }, () => doing.closeTab(note.id));
    for (const space of world.workspaces) {
      if (space.id === world.filedIn) continue;
      add({ id: `note:file:${space.id}`, label: `File it in ${space.name}`, group: 'This note', keywords: `workspace move ${space.name}` }, () => doing.fileNote(note.id, space.id));
    }
    if (world.filedIn !== null) {
      add({ id: 'note:unfile', label: 'Take it out of its workspace', group: 'This note', keywords: 'unfile workspace none inbox' }, () => doing.fileNote(note.id, null));
    }
    // Its tab's group: the way in on a phone, where a finger's hold on a tab is the drag, not a menu.
    const isTab = world.tabs.some((tab) => tab.id === note.id);
    if (isTab && doing.groupTab) {
      const groupTab = doing.groupTab;
      add({ id: 'tab:group:new', label: 'Put this tab in a new group', group: 'This note', keywords: 'tab group new colour' }, () => groupTab(note.id));
    }
    if (isTab && doing.joinTabGroup) {
      const join = doing.joinTabGroup;
      for (const g of world.tabGroups ?? []) {
        if (g.id === world.tabGroup) continue;
        add({ id: `tab:group:${g.id}`, label: `Put this tab in ${g.name}`, group: 'This note', keywords: `tab group ${g.name}` }, () => join(note.id, g.id));
      }
    }
    if (isTab && world.tabGroup && doing.leaveTabGroup) {
      const leave = doing.leaveTabGroup;
      add({ id: 'tab:group:leave', label: 'Take this tab out of its group', group: 'This note', keywords: 'tab group ungroup remove' }, () => leave(note.id));
    }
  }

  // ---- making and going ---------------------------------------------------------------------
  add({ id: 'new', label: 'New note', group: 'Notes', keywords: 'write blank create add', shortcut: '⌘N' }, () => doing.newNote());
  add({ id: 'speak', label: 'Speak a new note', group: 'Notes', keywords: 'record voice dictate mic talk' }, () => doing.speak());
  add({ id: 'list', label: 'All notes', group: 'Notes', keywords: 'home list back library' }, () => doing.showList());

  // ---- the tabs -----------------------------------------------------------------------------
  for (const tab of world.tabs) {
    if (note && tab.id === note.id) continue;
    add({ id: `tab:${tab.id}`, label: `Go to ${titleOf(tab)}`, group: 'Open tabs', keywords: 'tab switch' }, () => doing.openNote(tab.id));
  }
  for (const tab of world.tabs) {
    if (note && tab.id === note.id) continue;
    add({ id: `tab:close:${tab.id}`, label: `Close ${titleOf(tab)}`, group: 'Open tabs', keywords: 'tab shut' }, () => doing.closeTab(tab.id));
  }
  if (world.canBack) add({ id: 'back', label: 'Back', group: 'Open tabs', keywords: 'history previous' }, () => doing.back());
  if (world.canForward) add({ id: 'forward', label: 'Forward', group: 'Open tabs', keywords: 'history next' }, () => doing.forward());

  // ---- workspaces ---------------------------------------------------------------------------
  if (world.workspaces.length) {
    if (world.workspace !== null) add({ id: 'space:all', label: 'Show all notes', group: 'Workspaces', keywords: 'workspace every unfiltered' }, () => doing.chooseWorkspace(null));
    for (const space of world.workspaces) {
      if (space.id === world.workspace) continue;
      add({ id: `space:${space.id}`, label: `Show ${space.name}`, group: 'Workspaces', keywords: `workspace filter ${space.name}` }, () => doing.chooseWorkspace(space.id));
    }
  }

  // ---- every note ---------------------------------------------------------------------------
  const open = new Set(world.tabs.map((tab) => tab.id));
  for (const each of world.notes.slice(0, MOST_NOTES)) {
    if (open.has(each.id) || each.id === note?.id) continue;
    add({ id: `open:${each.id}`, label: `Open ${titleOf(each)}`, group: 'Notes by name', keywords: 'note go to' }, () => doing.openNote(each.id));
  }

  // ---- how it looks -------------------------------------------------------------------------
  const themes: [ThemePref, string][] = [
    ['system', 'Follow the phone'],
    ['light', 'Light'],
    ['dark', 'Dark'],
    // The kit's named themes, as Settings offers them (core/preferences.ts THEME_PRESETS).
    ['dawn', 'Dawn'],
    ['boreal', 'Boreal'],
    ['ember', 'Ember'],
  ];
  for (const [value, label] of themes) {
    if (value === world.theme) continue;
    add({ id: `theme:${value}`, label: `Theme: ${label}`, group: 'Look', keywords: 'dark light appearance paper' }, () => doing.setTheme(value));
  }

  // ---- the app ------------------------------------------------------------------------------
  add({ id: 'settings', label: 'Settings', group: 'Ghost.md', keywords: 'preferences options account sync type animations' }, () => doing.settings());
  add({ id: 'cheatsheet', label: 'Cheat sheet', group: 'Ghost.md', keywords: 'marks markdown reference help' }, () => doing.cheatSheet());
  add({ id: 'academy', label: 'Ghost.md Academy', group: 'Ghost.md', keywords: 'learn lessons markdown teach' }, () => doing.academy());
  add({ id: 'guide', label: 'How to talk to Ghost.md', group: 'Ghost.md', keywords: 'guide walkthrough voice help' }, () => doing.guide());

  return out;
}
