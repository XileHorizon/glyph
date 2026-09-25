import { BOARD_TITLE } from '../core/boardNote.ts';
import { SAMPLE_TITLE } from '../core/sampleNote.ts';
import { canvasNoteBody, type Canvas } from './jsonCanvas.ts';

/**
 * The second example canvas, added from Settings beside the first (sampleCanvas.ts): how Glyph works, in plain
 * words (Matt: "Add a simpler canvas explaining how Glyph works in simpler terms"). Where the first shows one of
 * everything a canvas can hold, this one says what the app does, in eight cards a person can read in a minute,
 * with the lines telling the order: you say it, the marks are said too, it lands as a note, the note is kept,
 * it can be a board or a canvas, and none of it leaves the phone.
 *
 * Two of the cards are the example board and the sample note themselves, so tapping them opens the real thing.
 * Written in JSON Canvas as the first is (docs/CANVAS.md).
 */

export const HOW_TITLE = 'How Ghost.md works';

export function howCanvas(): Canvas {
  return {
    nodes: [
      // Saying it, in a group on the left: the three steps from a voice to a note.
      { id: 'saying', type: 'group', x: -40, y: -60, width: 640, height: 480, label: 'From your voice to the page', color: '5' },
      {
        id: 'speak',
        type: 'text',
        x: 0,
        y: 0,
        width: 260,
        height: 170,
        color: '4',
        text: '# Say it\n\nTap **Speak**, or press the side key, and talk. Ghost.md writes the words as you say them.',
      },
      {
        id: 'marks',
        type: 'text',
        x: 320,
        y: 0,
        width: 260,
        height: 170,
        text: '# Say the marks too\n\nSay *heading*, *list*, *done* or *table*, and Ghost.md draws them. No menus.',
      },
      {
        id: 'note',
        type: 'text',
        x: 160,
        y: 220,
        width: 260,
        height: 170,
        text: '# It lands as a note\n\nPlain Markdown you can read anywhere. Fix a word with a finger or with your voice.',
      },
      // Where a note goes, on the right.
      {
        id: 'library',
        type: 'text',
        x: 760,
        y: -40,
        width: 260,
        height: 170,
        text: '# All your notes\n\nThe sidebar keeps them. Search finds any word. Tabs hold the ones you are using.',
      },
      { id: 'board', type: 'file', x: 760, y: 170, width: 260, height: 150, file: `${BOARD_TITLE}.md` },
      {
        id: 'canvas',
        type: 'text',
        x: 760,
        y: 360,
        width: 260,
        height: 190,
        text: '# Or a canvas\n\nCards on a page with lines between them. This is one: hold a card to move it, double-tap the page to add one.',
      },
      {
        id: 'phone',
        type: 'text',
        x: 160,
        y: 480,
        width: 260,
        height: 170,
        color: '2',
        text: '# It stays on your phone\n\nThe AI that hears you runs on the phone itself. Nothing you say goes anywhere else.',
      },
      { id: 'every', type: 'file', x: 1120, y: 170, width: 260, height: 150, file: `${SAMPLE_TITLE}.md` },
    ],
    edges: [
      { id: 'e1', fromNode: 'speak', toNode: 'marks', fromSide: 'right', toSide: 'left', label: 'and' },
      { id: 'e2', fromNode: 'marks', toNode: 'note', fromSide: 'bottom', toSide: 'top', label: 'then' },
      { id: 'e3', fromNode: 'note', toNode: 'library', fromSide: 'right', toSide: 'left', label: 'kept with' },
      { id: 'e4', fromNode: 'note', toNode: 'board', fromSide: 'right', toSide: 'left', label: 'with columns, it is a board' },
      { id: 'e5', fromNode: 'note', toNode: 'canvas', fromSide: 'right', toSide: 'left', label: 'or laid out' },
      { id: 'e6', fromNode: 'note', toNode: 'phone', fromSide: 'bottom', toSide: 'top', toEnd: 'none', color: '2' },
      { id: 'e7', fromNode: 'board', toNode: 'every', fromSide: 'right', toSide: 'left', toEnd: 'none', label: 'every mark a note can hold' },
    ],
  };
}

export function howCanvasBody(): string {
  return canvasNoteBody(HOW_TITLE, howCanvas());
}
