import type { Permission, PluginManifest } from './types.ts';

/** Each permission, in the words Settings uses for it (PluginsPane.tsx). */
export const PERMISSION_WORDS: Record<Permission, string> = {
  notes: 'Your notes',
  network: 'The internet',
  ai: 'The model on your phone',
  voice: 'Voice commands',
  native: 'Built-in app commands',
};

/** What a plugin may reach, in one line: "Your notes · The internet (api.notion.com) · Voice commands". */
export function reachLine(manifest: PluginManifest): string {
  return manifest.permissions
    .map((p) => (p.kind === 'network' && manifest.hosts?.length ? `${PERMISSION_WORDS.network} (${manifest.hosts.join(', ')})` : PERMISSION_WORDS[p.kind]))
    .join(' · ');
}
