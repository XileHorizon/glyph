import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from './store.ts';

const applied: Note[] = [];
let stored: Note | null = null;
let native = true;

vi.mock('./tauri.ts', () => ({ isTauri: () => native, invoke: async () => undefined }));
vi.mock('./store.ts', () => ({
  getNote: async () => stored,
  applyNote: async (note: Note) => {
    applied.push(note);
    return note;
  },
  announceNotesChanged: () => undefined,
}));

const { fileNoteInFolder, folderFor, folderName } = await import('./noteFolders.ts');

function note(path: string | undefined): Note {
  return { id: 'n1', body: '# Weekend trip', createdAt: 1, updatedAt: 1, source: 'editor', ...(path === undefined ? {} : { path }) } as Note;
}

describe('the folder a note is filed in', () => {
  beforeEach(() => {
    applied.length = 0;
    stored = note('Inbox/Weekend trip.md');
    native = true;
  });

  it('names a folder after the workspace, and the inbox for none', () => {
    expect(folderFor('Home')).toBe('workspaces/Home');
    expect(folderFor(null)).toBe('Inbox');
    // What a file name cannot hold goes, and a name that cleans away to nothing is no folder at all.
    expect(folderName('Work/Clients: 2026?')).toBe('WorkClients 2026');
    expect(folderFor('  ///  ')).toBeNull();
    expect(folderFor('..')).toBeNull();
  });

  it('moves the file into the workspace folder, keeping its name', async () => {
    await fileNoteInFolder('n1', 'Home');
    expect(applied.map((n) => n.path)).toEqual(['workspaces/Home/Weekend trip.md']);
  });

  it('moves it back to the inbox when it leaves a workspace', async () => {
    stored = note('workspaces/Home/Weekend trip.md');
    await fileNoteInFolder('n1', null);
    expect(applied.map((n) => n.path)).toEqual(['Inbox/Weekend trip.md']);
  });

  it('leaves the words alone and asks for nothing it cannot do', async () => {
    await fileNoteInFolder('n1', 'Home');
    expect(applied[0]?.body).toBe('# Weekend trip');
    applied.length = 0;

    // Already there: nothing to ask for.
    stored = note('workspaces/Home/Weekend trip.md');
    await fileNoteInFolder('n1', 'Home');
    expect(applied).toEqual([]);

    // A draft, or a binary too old to have paths: no file to move.
    stored = note(undefined);
    await fileNoteInFolder('n1', 'Home');
    expect(applied).toEqual([]);

    // A browser has no library at all.
    stored = note('Inbox/Weekend trip.md');
    native = false;
    await fileNoteInFolder('n1', 'Home');
    expect(applied).toEqual([]);
  });
});
