import { Bot } from '@glacier/icons';
import type { GlyphPlugin, PluginManifest } from '../types.ts';
import { ClaudePane } from './ClaudePane.tsx';

/**
 * The Claude plugin, standard in Glyph: Claude on your notes, through the MCP server (docs/MCP.md). Unlike the
 * others it runs nothing inside the app - Claude reaches the account from outside, through the sync service - so
 * what the plugin is here is its page (ClaudePane.tsx): the address, the instructions drawer, what Claude can do
 * and where the key lives. Its switch shows or hides that page; it does not connect or disconnect Claude, which is
 * done in Claude, and the page says so.
 */
export const manifest: PluginManifest = {
  id: 'claude',
  name: 'Claude',
  description: 'Read, add to and change your notes from Claude, through Ghost.md’s MCP server.',
  version: '1.0.0',
  author: 'Ghost.md',
  standard: true,
  permissions: [
    { kind: 'notes', why: 'Claude reads and writes the notes of your account once you sign it in: from outside the phone, through the sync service, never through this app.' },
    { kind: 'network', why: 'Claude talks to Ghost.md’s sync service and nothing else. This page only carries the instructions.' },
  ],
  hosts: ['attack.fm'],
  storage: [],
};

export const claudePlugin: GlyphPlugin = {
  manifest,
  icon: Bot,
  settings: { Pane: ClaudePane, summary: () => 'Read and write your notes from Claude' },
};
