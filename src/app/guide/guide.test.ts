import { describe, expect, it } from 'vitest';
import { CUE_ALONE, PHRASES, renderExample } from './phrases.ts';

/**
 * The guide may only teach what the speech rules do. Each example is rendered
 * by the real rules and must still produce its marker; a failure here means a
 * rule changed and the guide (src/app/guide/phrases.ts) has to change with it.
 */
describe('the spoken-markdown guide', () => {
  for (const group of PHRASES) {
    it(`"${group.title}" still produces ${JSON.stringify(group.example.expect)}`, () => {
      const markdown = renderExample(group.example);
      expect(markdown).toContain(group.example.expect);
    });
  }

  it('never shows a cue word left behind as text', () => {
    for (const group of PHRASES) {
      const markdown = renderExample(group.example);
      expect(markdown).not.toMatch(/\b(bullet point|next point|heading:|new paragraph|new section|quote:|check box|divider|end bold|end italic|number one|number two)\b/i);
    }
  });

  it('applies a cue said on its own to the next sentence, as the guide promises', () => {
    expect(renderExample(CUE_ALONE)).toContain(CUE_ALONE.expect);
  });

  it('shows beside each cue the mark its example really writes', () => {
    for (const group of PHRASES) {
      const first = group.symbol.split(' ')[0] ?? '';
      if (first) expect(renderExample(group.example), group.title).toContain(first);
    }
  });
});
