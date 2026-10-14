import { describe, expect, it } from 'vitest';
import { CHAPTERS, LESSONS, lessonsIn, readProgress, writeProgress } from './lessons.ts';

describe('Ghost.md Academy’s lessons', () => {
  it('teaches every lesson with an example that passes its own check', () => {
    for (const lesson of LESSONS) {
      expect(lesson.passes(lesson.example), `${lesson.id}: its own example`).toBe(true);
    }
  });

  it('has a lesson for every part of a mark: what it is, what to type, what to do, and a way out', () => {
    for (const lesson of LESSONS) {
      expect(lesson.title, lesson.id).toBeTruthy();
      expect(lesson.symbol, lesson.id).toBeTruthy();
      expect(lesson.teach.length, lesson.id).toBeGreaterThan(30);
      expect(lesson.task, lesson.id).toBeTruthy();
      expect(lesson.hint, lesson.id).toBeTruthy();
      expect(lesson.praise, lesson.id).toBeTruthy();
      expect(CHAPTERS).toContain(lesson.chapter);
    }
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length);
    expect(lessonsIn('Markdown basics').length).toBe(LESSONS.length);
  });

  it('passes words of a person’s own, not only the example', () => {
    const passes = (id: string, text: string) => LESSONS.find((lesson) => lesson.id === id)!.passes(text);
    expect(passes('title', '# Camping in June')).toBe(true);
    expect(passes('heading', 'notes\n\n## What to pack')).toBe(true);
    // The lesson offers ### as well as ##, so it has to take it (Matt: "the lesson isn't passed").
    expect(passes('heading', '### Friday')).toBe(true);
    expect(passes('heading', '#### Friday morning')).toBe(true);
    expect(passes('bold', 'bring the **big tent**')).toBe(true);
    expect(passes('italic', 'the _small_ one leaks')).toBe(true);
    // Stars lean words over too, and the page below shows it, so the lesson takes them.
    expect(passes('italic', 'the *small* one leaks')).toBe(true);
    expect(passes('struck', '~~Thursday~~ Friday')).toBe(true);
    expect(passes('code', 'type `ls` to look')).toBe(true);
    expect(passes('link', 'see [the map](https://maps.example.com/x)')).toBe(true);
    expect(passes('list', '- tent\n- stove')).toBe(true);
    expect(passes('number', '1) Pack\n2) Go')).toBe(true);
    expect(passes('todo', '- [ ] ring the site')).toBe(true);
    expect(passes('quote', '> no dogs in July')).toBe(true);
    expect(passes('rule', 'before\n\n***\n\nafter')).toBe(true);
    expect(passes('fence', '```\nkeep this\n```')).toBe(true);
  });

  it('is not passed by the words alone, or by another mark', () => {
    const passes = (id: string, text: string) => LESSONS.find((lesson) => lesson.id === id)!.passes(text);
    expect(passes('title', 'Weekend trip')).toBe(false);
    // A title is not a heading: the lesson wants its own mark.
    expect(passes('heading', '# Weekend trip')).toBe(false);
    expect(passes('bold', '*one star*')).toBe(false);
    expect(passes('italic', 'snake_case_words')).toBe(false);
    // Bold is two stars, and is its own lesson.
    expect(passes('italic', '**Friday at noon**')).toBe(false);
    expect(passes('struck', '~one squiggle~')).toBe(false);
    expect(passes('code', 'no backticks here')).toBe(false);
    expect(passes('link', '[words] (https://example.com)')).toBe(false);
    expect(passes('list', 'milk and bread')).toBe(false);
    expect(passes('number', '2026 was the year')).toBe(false);
    expect(passes('todo', '- ring the site')).toBe(false);
    expect(passes('quote', 'she said no dogs')).toBe(false);
    expect(passes('rule', '- -')).toBe(false);
    // One fence is a block that never closes.
    expect(passes('fence', '```js\nconst x = 1;')).toBe(false);
  });

  it('keeps what has been learned, and shrugs off a store it cannot read', () => {
    writeProgress(new Set(['title', 'bold']));
    expect(readProgress()).toEqual(new Set(['title', 'bold']));
    localStorage.setItem('glyph-academy', 'not json');
    expect(readProgress()).toEqual(new Set());
    localStorage.removeItem('glyph-academy');
    expect(readProgress()).toEqual(new Set());
  });
});
