import { describe, expect, it } from 'vitest';
import { BOARD_TITLE } from '../core/boardNote.ts';
import { noteTitle } from '../core/store.ts';
import { SAMPLE_TITLE } from '../core/sampleNote.ts';
import { HOW_TITLE, howCanvas, howCanvasBody } from './howCanvas.ts';
import { canvasOf, parseCanvas, serializeCanvas } from './jsonCanvas.ts';

describe('the canvas that says how Ghost.md works', () => {
  it('is eight plain cards in a group, opening the example board and the sample note, with the order on the lines', () => {
    const canvas = howCanvas();
    const cards = canvas.nodes.filter((n) => n.type !== 'group');
    expect(canvas.nodes.filter((n) => n.type === 'group')).toHaveLength(1);
    expect(cards).toHaveLength(8);
    const files = cards.filter((n) => n.type === 'file').map((n) => (n as { file: string }).file);
    expect(files).toEqual([`${BOARD_TITLE}.md`, `${SAMPLE_TITLE}.md`]);
    // Every line joins two cards that are there, and the first three tell the order of saying.
    const ids = new Set(canvas.nodes.map((n) => n.id));
    for (const edge of canvas.edges) {
      expect(ids.has(edge.fromNode)).toBe(true);
      expect(ids.has(edge.toNode)).toBe(true);
    }
    expect(canvas.edges.slice(0, 2).map((e) => [e.fromNode, e.toNode])).toEqual([
      ['speak', 'marks'],
      ['marks', 'note'],
    ]);
    // Said simply: no card runs past a few lines, and none of them is a chart or a table.
    for (const card of cards) {
      if (card.type !== 'text') continue;
      expect(card.text.length).toBeLessThan(160);
      expect(card.text).not.toMatch(/```|\|/);
    }
  });

  it('is a canvas note under its own title, and comes back the same from the file', () => {
    const body = howCanvasBody();
    expect(noteTitle(body)).toBe(HOW_TITLE);
    expect(canvasOf(body)).toEqual(howCanvas());
    expect(parseCanvas(serializeCanvas(howCanvas()))).toEqual(howCanvas());
  });
});
