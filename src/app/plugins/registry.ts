import { notionPlugin } from './notion/index.tsx';
import { githubPlugin } from './github/index.tsx';
import { marksPlugin } from './marks/index.tsx';
import { claudePlugin } from './claude/index.tsx';
import { onPluginStorage, PluginPermissionError } from './host.ts';
import { registerMarkName } from '../core/itemLinks.ts';
import { markDetailsChanged, provideMarkDetails } from '../core/markDetails.ts';
import { onPreferences, preferences } from '../core/preferences.ts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { InlineFormat, GlyphPlugin, ItemAction, ItemTarget, NoteAction, NoteLink, Permission, Tip, VoiceCommand, Suggestion } from './types.ts';

/**
 * The plugins in this build, which are switched on, and everything they offer.
 *
 * The app asks here and never names a plugin: the note's cog asks for
 * `noteLinks()`, the recorder for `voiceCommands()`, the formatter for
 * `contextFor(noteId)`, Settings for `usePlugins()`. A switched-off plugin
 * offers nothing anywhere, at once; its data stays where it was, so switching
 * it on again brings it back as it was.
 *
 * Switches are `glyph-plugins` in localStorage (id to on/off), and a plugin
 * with no switch yet is on if it is standard.
 */

const SWITCHES_KEY = 'glyph-plugins';

/** Whether a plugin reaches outside the phone: off while Local only is on (core/preferences.ts). */
const usesNetwork = (plugin: GlyphPlugin) => plugin.manifest.permissions.some((p) => p.kind === 'network');

export interface Registry {
  all(): readonly GlyphPlugin[];
  enabled(): readonly GlyphPlugin[];
  isEnabled(id: string): boolean;
  setEnabled(id: string, on: boolean): void;
  subscribe(listener: () => void): () => void;
  noteLinks(): NoteLink[];
  /** What a note is linked to, by every switched-on plugin that says so: its link, and the name of the thing. */
  linksOf(noteId: string): NoteLinked[];
  noteActions(): NoteAction[];
  itemAction(noteId: string): ItemAction | null;
  voiceCommands(): VoiceCommand[];
  itemTargets(): ItemTarget[];
  tips(recentTitle: string | null): Tip[];
  contextFor(noteId: string): string | null;
  contextVersion(noteId: string): number;
  /** The words offered on a note's lines right now, from every switched-on plugin. */
  suggestions(noteId: string, body: string): Suggestion[];
  /** Every key any plugin owns, switched on or not, for a reset. */
  storageKeys(): string[];
  /** The inline formattings of every switched-on plugin (editor/language.ts parses them). */
  formats(): InlineFormat[];
}

/** A note's link to something outside it, with that thing's name. */
export interface NoteLinked {
  link: NoteLink;
  name: string;
}

interface SwitchStore {
  read(): Record<string, boolean>;
  write(switches: Record<string, boolean>): void;
}

const localSwitches: SwitchStore = {
  read() {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(SWITCHES_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  },
  write(switches) {
    try {
      localStorage.setItem(SWITCHES_KEY, JSON.stringify(switches));
    } catch {
      // Without storage a switch lasts as long as the page.
    }
  },
};

/**
 * The extension points a plugin uses must match what its manifest asks for:
 * commands heard while recording need `voice`, and anything that changes a
 * note (an action, the swipe, items sent on from a voice command) needs
 * `notes`. Checked when the registry is made, so a plugin that overreaches
 * never loads.
 */
/** A node name the parser can carry, and a run of one character Markdown itself doesn't use. */
const FORMAT_NAME = /^[A-Z][A-Za-z0-9]*$/;
const FORMAT_DELIMITER = /^([^\w\s*_~`[\]<>#!()\\])\1{0,2}$/;

function checkExtensions(plugin: GlyphPlugin): void {
  const has = (kind: Permission) => plugin.manifest.permissions.some((p) => p.kind === kind);
  for (const format of plugin.formats ?? []) {
    if (!FORMAT_NAME.test(format.name)) throw new Error(`The “${plugin.manifest.id}” plugin's formatting “${format.name}” needs a capitalised name of letters and digits.`);
    if (!FORMAT_DELIMITER.test(format.delimiter)) {
      throw new Error(`The “${plugin.manifest.id}” plugin's “${format.name}” formatting needs a delimiter of one to three of the same character that Markdown doesn't already use, not “${format.delimiter}”.`);
    }
  }
  if ((plugin.voice?.length || plugin.itemTargets?.length) && !has('voice')) throw new PluginPermissionError(plugin.manifest, 'the “voice” permission its commands need');
  if ((plugin.noteActions?.length || plugin.itemAction || plugin.itemTargets?.length || plugin.suggest) && !has('notes')) {
    throw new PluginPermissionError(plugin.manifest, 'the “notes” permission its note actions need');
  }
}

export function createRegistry(plugins: readonly GlyphPlugin[], store: SwitchStore = localSwitches): Registry {
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.manifest.id)) throw new Error(`Two plugins are called “${plugin.manifest.id}”.`);
    ids.add(plugin.manifest.id);
    checkExtensions(plugin);
    // Its id is the name its item marks carry (core/itemLinks.ts).
    registerMarkName(plugin.manifest.id);
  }
  const listeners = new Set<() => void>();
  let switches = store.read();
  // A stable array between changes, so useSyncExternalStore sees no change when there is none.
  let enabledCache: readonly GlyphPlugin[] | null = null;

  const isEnabled = (id: string) => {
    const plugin = plugins.find((p) => p.manifest.id === id);
    if (!plugin) return false;
    if (preferences().localOnly && usesNetwork(plugin)) return false;
    return switches[id] ?? plugin.manifest.standard;
  };
  const enabled = () => (enabledCache ??= plugins.filter((p) => isEnabled(p.manifest.id)));
  // Local only turning on or off changes who is enabled without a switch moving.
  onPreferences(() => {
    enabledCache = null;
    listeners.forEach((listener) => listener());
    markDetailsChanged();
  });
  // A switched-off plugin reads nothing back, so its marks draw plain.
  for (const plugin of plugins) {
    const marks = plugin.marks;
    if (marks) provideMarkDetails(plugin.manifest.id, () => (isEnabled(plugin.manifest.id) ? marks : null));
  }

  return {
    all: () => plugins,
    enabled,
    isEnabled,
    setEnabled(id, on) {
      if (!ids.has(id) || isEnabled(id) === on) return;
      switches = { ...switches, [id]: on };
      store.write(switches);
      enabledCache = null;
      listeners.forEach((listener) => listener());
      markDetailsChanged();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    noteLinks: () => enabled().flatMap((p) => p.noteLinks ?? []),
    linksOf: (noteId) =>
      enabled()
        .flatMap((p) => p.noteLinks ?? [])
        .flatMap((link) => {
          const name = link.linked?.(noteId) ?? null;
          return name ? [{ link, name }] : [];
        }),
    noteActions: () => enabled().flatMap((p) => p.noteActions ?? []),
    itemAction: (noteId) => enabled().map((p) => p.itemAction).find((action) => action?.available(noteId)) ?? null,
    voiceCommands: () => enabled().flatMap((p) => p.voice ?? []),
    itemTargets: () => enabled().flatMap((p) => p.itemTargets ?? []),
    tips: (recentTitle) => enabled().flatMap((p) => p.tips?.(recentTitle) ?? []),
    contextFor(noteId) {
      const parts = enabled()
        .map((p) => p.formatContext?.for(noteId) ?? null)
        .filter((part): part is string => Boolean(part?.trim()));
      return parts.length ? parts.join('\n\n') : null;
    },
    contextVersion(noteId) {
      // One context gives its own version, so a note formatted before plugins
      // existed (with its project's version) is not formatted again for it.
      const versions = enabled()
        .map((p) => p.formatContext?.version(noteId) ?? 0)
        .filter((version) => version !== 0);
      if (versions.length <= 1) return versions[0] ?? 0;
      return versions.reduce((sum, version) => (sum * 31 + version) % 2 ** 52, 7);
    },
    suggestions: (noteId, body) => enabled().flatMap((p) => p.suggest?.(noteId, body) ?? []),
    storageKeys: () => [SWITCHES_KEY, ...plugins.flatMap((p) => p.manifest.storage)],
    formats: () => enabled().flatMap((p) => p.formats ?? []),
  };
}

/** The plugins that ship with Glyph. */
export const BUILT_IN: readonly GlyphPlugin[] = [notionPlugin, githubPlugin, marksPlugin, claudePlugin];

export const plugins = createRegistry(BUILT_IN);

/** The plugins and which are on, kept current. */
export function usePlugins(): { all: readonly GlyphPlugin[]; enabled: readonly GlyphPlugin[]; setEnabled: (id: string, on: boolean) => void } {
  const enabled = useSyncExternalStore(plugins.subscribe, plugins.enabled, plugins.enabled);
  return { all: plugins.all(), enabled, setEnabled: plugins.setEnabled };
}

/**
 * What a note is linked to, kept current: read again when a plugin writes its
 * storage (a board chosen, a repo unlinked) or is switched on or off.
 */
export function useNoteLinks(noteId: string): NoteLinked[] {
  const [links, setLinks] = useState<NoteLinked[]>(() => plugins.linksOf(noteId));
  useEffect(() => {
    const read = () => setLinks(plugins.linksOf(noteId));
    read();
    const offStorage = onPluginStorage(read);
    const offSwitch = plugins.subscribe(read);
    return () => {
      offStorage();
      offSwitch();
    };
  }, [noteId]);
  return links;
}

/** The formatter's context for a note, from every plugin that gives one (format/pipeline.ts). */
export const pluginContextFor = (noteId: string) => plugins.contextFor(noteId);
export const pluginContextVersion = (noteId: string) => plugins.contextVersion(noteId);

