import { describe, expect, it } from 'vitest';
import { withFrontMatterTitle } from './frontMatter.ts';
import { noteTitle } from './store.ts';

describe('naming a note by its front matter', () => {
  const canvas = '{\n  "nodes": []\n}\n';

  it('replaces the title where there is one, keeping the other keys and the words', () => {
    const body = `---\nid: abc\ntitle: "Old name"\ntags: [trip]\n---\n${canvas}`;
    const next = withFrontMatterTitle(body, 'Cabin weekend: laid out');
    expect(next).toBe(`---\ntitle: "Cabin weekend: laid out"\nid: abc\ntags: [trip]\n---\n${canvas}`);
    expect(noteTitle(next)).toBe('Cabin weekend: laid out');
  });

  it('adds the key to front matter that has none, and makes front matter where there is none', () => {
    expect(withFrontMatterTitle(`---\nid: abc\n---\n${canvas}`, 'Plan')).toBe(`---\ntitle: "Plan"\nid: abc\n---\n${canvas}`);
    expect(withFrontMatterTitle(canvas, 'Plan')).toBe(`---\ntitle: "Plan"\n---\n${canvas}`);
    expect(noteTitle(withFrontMatterTitle(canvas, 'Plan'))).toBe('Plan');
  });

  it('keeps a quote or a line break out of the name, and takes an empty name off', () => {
    expect(withFrontMatterTitle(canvas, ' Say "hi"\nthere ')).toContain(`title: "Say 'hi''there"`);
    expect(withFrontMatterTitle(`---\ntitle: "Plan"\nid: abc\n---\n${canvas}`, '')).toBe(`---\nid: abc\n---\n${canvas}`);
    expect(withFrontMatterTitle(`---\ntitle: "Plan"\n---\n${canvas}`, '  ')).toBe(canvas);
    expect(withFrontMatterTitle(canvas, '')).toBe(canvas);
  });
});
