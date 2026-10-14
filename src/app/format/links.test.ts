import { describe, expect, it } from 'vitest';
import { protectLinks, restoreLinks } from './links.ts';

const NOTION = 'https://www.notion.so/attackfm/Buy-milk-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';

describe('links through the model', () => {
  it('swaps a Notion link in a list item for a token and puts it back when the token is copied', () => {
    const note = `- [ ] [Buy milk](${NOTION}) on the way home\n- [ ] Call the plumber\n`;
    const { text, links } = protectLinks(note);
    expect(text).toBe('- [ ] [Buy milk](link-1) on the way home\n- [ ] Call the plumber\n');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ token: 'link-1', text: 'Buy milk', url: NOTION });

    const rewrite = '# Errands\n\n- [ ] [Buy milk](link-1) on the way home.\n- [ ] Call the plumber.\n';
    expect(restoreLinks(rewrite, links)).toBe(`# Errands\n\n- [ ] [Buy milk](${NOTION}) on the way home.\n- [ ] Call the plumber.\n`);
  });

  it('keeps the words the model chose around a token, and takes a token written loosely', () => {
    const { links } = protectLinks(`see [the task](${NOTION})`);
    expect(restoreLinks('See [the Notion task] (link 1).', links)).toBe(`See [the Notion task](${NOTION}).`);
    expect(restoreLinks('See <link-1>.', links)).toBe(`See [the task](${NOTION}).`);
    expect(restoreLinks('See link-1.', links)).toBe(`See [the task](${NOTION}).`);
  });

  it('makes the words the link again when the token was dropped but the words survived', () => {
    const { links } = protectLinks(`- [ ] [Buy milk](${NOTION}) today`);
    expect(restoreLinks('- [ ] Buy milk today.\n', links)).toBe(`- [ ] [Buy milk](${NOTION}) today.\n`);
    // Case is the model's; the words are still found.
    expect(restoreLinks('- [ ] buy milk today.\n', links)).toBe(`- [ ] [buy milk](${NOTION}) today.\n`);
  });

  it('adds a link whose token and words both vanished at the end of the note', () => {
    const note = `Ring the dentist. Details at https://example.com/dentist, and [the board](${NOTION}).`;
    const { text, links } = protectLinks(note);
    expect(text).toBe('Ring the dentist. Details at <link-2>, and [the board](link-1).');
    expect(restoreLinks('# Dentist\n\n- [ ] Ring the dentist.\n', links)).toBe(`# Dentist\n\n- [ ] Ring the dentist.\n\n[the board](${NOTION})\nhttps://example.com/dentist\n`);
  });

  it('keeps an autolink and a bare address as they were written', () => {
    const { text, links } = protectLinks('Read <https://a.example/x> then https://b.example/y.');
    expect(text).toBe('Read <link-1> then <link-2>.');
    expect(restoreLinks('Read <link-1>, then <link-2>.', links)).toBe('Read <https://a.example/x>, then https://b.example/y.');
  });

  it('tells link-1 from link-10', () => {
    const many = Array.from({ length: 10 }, (_, i) => `https://example.com/${i + 1}`).join(' ');
    const { text, links } = protectLinks(many);
    expect(text.endsWith('<link-10>')).toBe(true);
    const back = restoreLinks(text, links);
    expect(back).toBe(many);
  });

  it('leaves pictures alone', () => {
    const note = '![](image/abc.jpg)\n\nA picture of the sign.';
    expect(protectLinks(note)).toEqual({ text: note, links: [] });
  });

  it('only substitutes while the rewrite is still streaming', () => {
    const { links } = protectLinks(`[the board](${NOTION}) and https://example.com/more`);
    expect(restoreLinks('# Board\n\n- The board and', links, false)).toBe('# Board\n\n- The board and');
    expect(restoreLinks('- [the board](link-1) and <link-2>', links, false)).toBe(`- [the board](${NOTION}) and https://example.com/more`);
  });
});

describe('item marks through the model', () => {
  const URL = 'https://www.notion.so/attackfm/Buy-milk-1a2b3c4d';
  const NOTE = `# Errands\n\n- [ ] Buy milk on the way home [notion](${URL})\n- [ ] Call the plumber\n`;

  it('remembers the item a mark belongs to, and keeps a mark the model copied', () => {
    const { text, links } = protectLinks(NOTE);
    expect(text).toBe('# Errands\n\n- [ ] Buy milk on the way home [notion](link-1)\n- [ ] Call the plumber\n');
    expect(links[0]).toMatchObject({ token: 'link-1', text: 'notion', item: 'Buy milk on the way home' });
    expect(restoreLinks('# Errands\n\n- [ ] Buy milk on the way home. [notion](link-1)\n- [ ] Call the plumber.\n', links)).toBe(
      `# Errands\n\n- [ ] Buy milk on the way home. [notion](${URL})\n- [ ] Call the plumber.\n`,
    );
  });

  it('puts a lost mark back on the item it came from, found by its words', () => {
    const { links } = protectLinks(NOTE);
    const rewrite = '# Errands\n\n- [ ] Call the plumber about the tap.\n- [ ] **Buy milk** on the way home.\n';
    expect(restoreLinks(rewrite, links)).toBe(`# Errands\n\n- [ ] Call the plumber about the tap.\n- [ ] **Buy milk** on the way home. [notion](${URL})\n`);
  });

  it('adds a lost mark at the end when no item is left that matches its words', () => {
    const { links } = protectLinks(NOTE);
    expect(restoreLinks('# Errands\n\n- [ ] Call the plumber.\n', links)).toBe(`# Errands\n\n- [ ] Call the plumber.\n\n[notion](${URL})\n`);
  });

  it('does not take an ordinary link at the end of an item for a mark', () => {
    const { links } = protectLinks('- [ ] read [the board](https://www.notion.so/b)\n');
    expect(links[0]?.item).toBeUndefined();
  });
});

describe('a mark on an item a board names', () => {
  it('counts as the item\u2019s mark with the anchor after it, and goes back in before the anchor when lost', () => {
    const note = `- [ ] Buy milk [notion](${NOTION}) ^buy-milk\n`;
    const { links } = protectLinks(note);
    expect(links[0]?.item).toBe('Buy milk');
    // The model dropped the mark and kept the rest: it goes back where a mark goes, before the anchor.
    expect(restoreLinks('- [ ] Buy milk ^buy-milk\n', links, true)).toBe(`- [ ] Buy milk [notion](${NOTION}) ^buy-milk\n`);
  });
});
