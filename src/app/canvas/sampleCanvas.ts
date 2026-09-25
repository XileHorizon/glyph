import { BOARD_TITLE } from '../core/boardNote.ts';
import { SAMPLE_TITLE } from '../core/sampleNote.ts';
import { canvasNoteBody, type Canvas } from './jsonCanvas.ts';

/**
 * The example canvas, added from Settings the way the example board is (core/boardNote.ts): a note that is a
 * working canvas, with one of each thing a canvas holds (Matt: "make an example canvas with images, charts,
 * tables, notes and lines linking") - a group, cards of words, cards that are other notes, a link, a chart drawn
 * from Mermaid, a table, a picture, and lines between them with words on. It is written in JSON Canvas exactly as
 * Obsidian would write it (docs/CANVAS.md), so it is also the file to hand to Obsidian to see the same thing there.
 *
 * The note cards point at the example board and the sample note by their titles: added together, tapping a card
 * opens the note. The picture is the sample note's own drawing, kept by the picture store when the canvas is made
 * (core/seed.ts `addCanvasNote`); with no picture store to hand the canvas is made without it.
 */

export const CANVAS_TITLE = 'Cabin weekend, laid out';

export function sampleCanvas(picture: string | null = null): Canvas {
  const nodes: Canvas['nodes'] = [
    // The plan, in a group on the left.
    { id: 'before', type: 'group', x: -40, y: -60, width: 640, height: 500, label: 'Before we go', color: '5' },
    { id: 'book', type: 'text', x: 0, y: 0, width: 260, height: 110, color: '4', text: '# Book the cabin\n\nBy Friday. The deposit is **200**.' },
    { id: 'pack', type: 'text', x: 320, y: 0, width: 260, height: 110, text: '- [ ] Snacks\n- [ ] A charger for the drive\n- [x] The good coffee' },
    { id: 'sam', type: 'text', x: 0, y: 160, width: 260, height: 90, color: '2', text: 'Ask Sam about the dog' },
    {
      id: 'kit',
      type: 'text',
      x: 320,
      y: 160,
      width: 260,
      height: 150,
      text: '| Who | Brings |\n| --- | --- |\n| Sam | The tent |\n| Ali | Food for Saturday |\n| Me | The car, and the coffee |',
    },
    { id: 'board', type: 'file', x: 0, y: 300, width: 260, height: 130, file: `${BOARD_TITLE}.md` },
    { id: 'site', type: 'link', x: 320, y: 340, width: 260, height: 90, color: '5', url: 'https://attack.fm/glyph' },
    // The weekend itself, on the right: the days as a chart, and what it looks like.
    {
      id: 'days',
      type: 'text',
      x: 720,
      y: -40,
      width: 380,
      height: 220,
      color: '6',
      text: '```mermaid\nflowchart LR\n  F[Friday: drive up] --> S[Saturday: the lake]\n  S --> U[Sunday: the long walk]\n  U --> H[Home by dark]\n```\n',
    },
    { id: 'there', type: 'text', x: 720, y: 220, width: 380, height: 110, color: '6', text: '# The weekend\n\nSaturday the lake, Sunday the long walk if it is dry. Nothing planned for the evenings.' },
    { id: 'marks', type: 'file', x: 720, y: 370, width: 380, height: 120, file: `${SAMPLE_TITLE}.md` },
  ];
  if (picture) nodes.push({ id: 'view', type: 'file', x: 1160, y: 40, width: 320, height: 240, file: picture });
  return {
    nodes,
    edges: [
      { id: 'e1', fromNode: 'book', toNode: 'pack', fromSide: 'right', toSide: 'left', label: 'then' },
      { id: 'e2', fromNode: 'book', toNode: 'sam', fromSide: 'bottom', toSide: 'top' },
      { id: 'e3', fromNode: 'pack', toNode: 'kit', fromSide: 'bottom', toSide: 'top', color: '2', label: 'who brings what' },
      { id: 'e4', fromNode: 'before', toNode: 'days', fromSide: 'right', toSide: 'left', label: 'and then' },
      { id: 'e5', fromNode: 'sam', toNode: 'board', fromSide: 'bottom', toSide: 'top', toEnd: 'none' },
      { id: 'e6', fromNode: 'days', toNode: 'there', fromSide: 'bottom', toSide: 'top', color: '6' },
      { id: 'e7', fromNode: 'there', toNode: 'marks', fromSide: 'bottom', toSide: 'top', toEnd: 'none', label: 'every mark, if you need one' },
      ...(picture ? [{ id: 'e8', fromNode: 'days', toNode: 'view', fromSide: 'right' as const, toSide: 'left' as const, label: 'the view' }] : []),
    ],
  };
}

export function sampleCanvasBody(picture: string | null = null): string {
  return canvasNoteBody(CANVAS_TITLE, sampleCanvas(picture));
}
