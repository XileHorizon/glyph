import { createHost } from '../host.ts';
import type { PluginManifest } from '../types.ts';

export const manifest: PluginManifest = {
  id: 'github',
  name: 'GitHub',
  description: 'Links a note to a repo: its list items become issues you can tick off from either side, and the repo is read on the phone into a short briefing so names and terms come out right when the note is formatted.',
  version: '1.0.0',
  author: 'Ghost.md',
  standard: true,
  permissions: [
    { kind: 'notes', why: 'Sends a note’s list items to the repo as issues, and writes each one’s link back into the note.' },
    { kind: 'network', why: 'Reads the repo’s README, docs and file list from GitHub, and makes and closes the issues you send. Nothing else of your notes goes there.' },
    { kind: 'ai', why: 'The model on your phone writes the briefing from what it read.' },
  ],
  hosts: ['api.github.com'],
  storage: ['glyph-github-projects', 'glyph-project-links', 'glyph-github-token', 'glyph-github-issues'],
};

export const host = createHost(manifest);
