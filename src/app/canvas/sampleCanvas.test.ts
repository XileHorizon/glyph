import { describe, expect, it } from 'vitest';
import { canvasOf, isOnlyTable, parseCanvas, serializeCanvas } from './jsonCanvas.ts';
import { CANVAS_TITLE, sampleCanvas, sampleCanvasBody } from './sampleCanvas.ts';
import { noteTitle } from '../core/store.ts';

describe('the example canvas', () => {
  it('holds one of everything: a group, words, notes, a link, a chart, a table, a picture, and lines with words', () => {
    const canvas = sampleCanvas('view.jpg');
    const kinds = canvas.nodes.map((n) => n.type);
    expect(kinds.filter((k) => k === 'group').length).toBe(1);
    expect(kinds.filter((k) => k === 'file').length).toBe(3);
    expect(kinds.filter((k) => k === 'link').length).toBe(1);
    const words = canvas.nodes.filter((n) => n.type === 'text') as { text: string }[];
    expect(words.some((n) => n.text.startsWith('```mermaid'))).toBe(true);
    expect(words.some((n) => isOnlyTable(n.text))).toBe(true);
    expect(canvas.nodes.find((n) => n.id === 'view')).toMatchObject({ type: 'file', file: 'view.jpg' });
    expect(canvas.edges.length).toBe(8);
    expect(canvas.edges.filter((e) => e.label).length).toBeGreaterThanOrEqual(4);
    // Every line joins two cards that are there.
    const ids = new Set(canvas.nodes.map((n) => n.id));
    for (const e of canvas.edges) expect(ids.has(e.fromNode) && ids.has(e.toNode)).toBe(true);
  });

  it('is made without the picture where none could be drawn, and reads back through the spec unchanged', () => {
    const plain = sampleCanvas();
    expect(plain.nodes.find((n) => n.id === 'view')).toBeUndefined();
    expect(plain.edges.length).toBe(7);
    expect(parseCanvas(serializeCanvas(plain))).toEqual(plain);
    const body = sampleCanvasBody('view.jpg');
    expect(noteTitle(body)).toBe(CANVAS_TITLE);
    expect(canvasOf(body)).toEqual(sampleCanvas('view.jpg'));
  });
});
