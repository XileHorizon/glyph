import { beforeEach, describe, expect, it } from 'vitest';
import type { Note } from './store.ts';
import { sweepMemos, wasMemo } from './sweepMemos.ts';
import { isTrashed } from './trash.ts';

const note = (id: string, body: string): Note => ({ id, body, createdAt: 1, updatedAt: 1, source: 'editor' });

describe('sweeping the memos out', () => {
  beforeEach(() => localStorage.clear());

  it('knows a memo by its front matter and nothing else', () => {
    expect(wasMemo('---\nkind: memo\n---\nMilk')).toBe(true);
    expect(wasMemo('---\nid: x\nKind:  Memo\n---\nMilk')).toBe(true);
    expect(wasMemo('# Groceries\n\nkind: memo')).toBe(false);
    expect(wasMemo('---\nkind: memoir\n---\nwords')).toBe(false);
    expect(wasMemo('---\ntitle: Plans\n---\n# Plans')).toBe(false);
  });

  it('puts every memo in the trash, once, and leaves the notes alone', () => {
    const notes = [note('m1', '---\nkind: memo\n---\nMilk'), note('n1', '# A note'), note('m2', '---\nkind: memo\n---\nEggs')];
    expect(sweepMemos(notes)).toBe(2);
    expect(isTrashed('m1')).toBe(true);
    expect(isTrashed('m2')).toBe(true);
    expect(isTrashed('n1')).toBe(false);
    // Done once: a memo-shaped note written later by hand is not swept.
    expect(sweepMemos([...notes, note('m3', '---\nkind: memo\n---\nLater')])).toBe(0);
    expect(isTrashed('m3')).toBe(false);
  });
});
