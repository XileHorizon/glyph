import { describe, expect, it } from 'vitest';
import type { Note } from '../core/store.ts';
import { noteTitle } from '../core/store.ts';
import { bookNoteBody, chaptersOf } from '../book/book.ts';
import { forkShared, newShareId, newShareKey, openShare, readShareLink, sealShare, shareLink, sharedAsFile, sharedOf, type Shared } from './share.ts';
import { crc32, zipFiles } from './zip.ts';

const note = (id: string, body: string): Note => ({ id, body, createdAt: 0, updatedAt: 0, source: 'editor' }) as Note;

describe('a share sealed by its link', () => {
  it('opens with its own key and with no other, and the link carries both halves after the #', async () => {
    const shared: Shared = { v: 1, kind: 'note', title: 'Packing', pages: [{ title: 'Packing', body: '# Packing\n\n- [ ] Tent' }], at: 1 };
    const key = newShareKey();
    const blob = await sealShare(shared, key);
    expect(blob).not.toContain('Tent');
    expect(await openShare(blob, key)).toEqual(shared);
    await expect(openShare(blob, newShareKey())).rejects.toThrow();
    const id = newShareId();
    const link = shareLink(id, key);
    expect(link.split('#')[0]).not.toContain(key);
    expect(readShareLink(link)).toEqual({ id, key });
    // Pasted with words round it, or as only what follows the #.
    expect(readShareLink(`Here it is: ${link} - enjoy`)).toEqual({ id, key });
    expect(readShareLink(`${id}.${key}`)).toEqual({ id, key });
    expect(readShareLink('https://example.com/nothing')).toBeNull();
  });
});

describe('what a note or a book shares', () => {
  const book = note('b', bookNoteBody('Cabin trip', ['Packing', 'Route map', 'Not written']));
  const notes = [book, note('p', '# Packing\n\n- [ ] Tent'), note('r', '---\ntitle: "Route map"\n---\n{"nodes":[],"edges":[]}'), note('x', '# Elsewhere')];

  it('shares a note as itself, and a book as its index then every chapter that has a note, in order', () => {
    expect(sharedOf(notes[1]!, notes)).toMatchObject({ kind: 'note', title: 'Packing', pages: [{ title: 'Packing' }] });
    const shared = sharedOf(book, notes);
    expect(shared.kind).toBe('book');
    expect(shared.pages.map((p) => p.title)).toEqual(['Cabin trip', 'Packing', 'Route map']);
  });

  it('forks into a library as the reader own copies, renaming what would clash and pointing the index at the copies', async () => {
    const shared = sharedOf(book, notes);
    const saved: string[] = [];
    const first = await forkShared(shared, {
      notes: async () => [note('mine', '# Packing\n\nMy own list.')],
      save: async (body) => {
        saved.push(body);
        return note(`s${saved.length}`, body);
      },
    });
    expect(noteTitle(first.body)).toBe('Cabin trip');
    expect(saved.map((b) => noteTitle(b))).toEqual(['Cabin trip', 'Packing (shared)', 'Route map']);
    expect(chaptersOf(saved[0]!).map((c) => c.title)).toEqual(['Packing (shared)', 'Route map', 'Not written']);
  });

  it('downloads a note as its Markdown and a book as a zip of its pages', async () => {
    const one = sharedAsFile(sharedOf(notes[1]!, notes));
    expect(one.name).toBe('Packing.md');
    expect(await one.blob.text()).toBe('# Packing\n\n- [ ] Tent');
    const many = sharedAsFile(sharedOf(book, notes));
    expect(many.name).toBe('Cabin trip.zip');
    const bytes = new Uint8Array(await many.blob.arrayBuffer());
    // A zip: its first local file header, and its end record naming three files.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const end = bytes.length - 22;
    expect([...bytes.slice(end, end + 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(bytes[end + 8]).toBe(3);
  });
});

describe('the zip', () => {
  it('checks each file with the CRC-32 zip expects', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    const zip = zipFiles([{ name: 'a.md', bytes: new TextEncoder().encode('hi') }]);
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hi')));
  });
});
