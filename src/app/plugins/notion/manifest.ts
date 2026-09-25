import { createHost } from '../host.ts';
import type { PluginManifest } from '../types.ts';

export const manifest: PluginManifest = {
  id: 'notion',
  name: 'Notion',
  description: 'Turns list items into tasks on your Notion boards: swipe an item, say it, or send a whole list.',
  version: '1.0.0',
  author: 'Ghost.md',
  standard: true,
  permissions: [
    { kind: 'notes', why: 'Turns a sent item’s words into a link to its task, in the note it came from.' },
    { kind: 'network', why: 'Signs in through attack.fm and sends tasks to Notion. Only the items you send go.' },
    { kind: 'voice', why: 'Hears “send that to Notion” and “add a note for the Notion task for …” while you record.' },
    { kind: 'native', why: 'Keeps your Notion sign-in inside the app, where no page can read it.' },
  ],
  hosts: ['api.notion.com', 'attack.fm'],
  native: { generation: 12, commands: ['notion_save_account', 'notion_account', 'notion_disconnect', 'notion_request'] },
  storage: ['glyph-notion-links', 'glyph-notion-signin', 'glyph-notion-tasks'],
};

export const host = createHost(manifest);
