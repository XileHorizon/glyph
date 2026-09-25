import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { drawnBoards, emptyLook } from './boards.ts';
import { glyphMarkdown } from './language.ts';

const note = [
  '# Launch week',
  '',
  '```board',
  'To do: ship-page',
  'Done: pick-date',
  '```',
  '',
  '- [ ] Ship the pricing page ^ship-page',
  '- [x] Pick a launch date ^pick-date',
  '',
].join('\n');

let view: EditorView | null = null;

function open(text: string): EditorView {
  view = new EditorView({ state: EditorState.create({ doc: text, extensions: [drawnBoards()] }), parent: document.body });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

/** The + on column `index`, pressed, and the field it opens. */
function addTo(target: EditorView, index: number): HTMLInputElement {
  const plus = target.dom.querySelectorAll<HTMLButtonElement>('.cm-boardAdd')[index]!;
  plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return target.dom.querySelectorAll<HTMLElement>('.cm-boardColumn')[index]!.querySelector<HTMLInputElement>('.cm-boardComposeField')!;
}

function type(field: HTMLInputElement, words: string): void {
  field.value = words;
  field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('the + on a board column', () => {
  it('asks for the words first, then writes a real task item named after them', () => {
    const target = open(note);
    const field = addTo(target, 0);
    expect(field).toBeTruthy();
    // Nothing is written by opening the field.
    expect(target.state.doc.toString()).toBe(note);

    type(field, 'Rename the weak anchors');
    const doc = target.state.doc.toString();
    // Under the board's last item, with a space after the box, the words, and an anchor that says what it is.
    expect(doc).toContain('- [x] Pick a launch date ^pick-date\n- [ ] Rename the weak anchors ^rename-weak-anchors\n');
    // At the top of the column it was typed into.
    expect(doc).toContain('To do: rename-weak-anchors, ship-page\nDone: pick-date');
    expect(doc).not.toContain('^item');
  });

  it('looks like the card it will be: an empty box where the tick goes, and Add waiting until there are words', () => {
    // Matt: "Add task input and button dont match up".
    const target = open(note);
    const field = addTo(target, 0);
    const form = field.form!;
    expect([...form.children].map((child) => child.className)).toEqual(['cm-boardComposeTick', 'cm-boardComposeField', 'cm-boardComposeAdd']);
    const add = form.querySelector<HTMLButtonElement>('.cm-boardComposeAdd')!;
    expect(add.disabled).toBe(true);
    field.value = 'Pack the stove';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(add.disabled).toBe(false);
    type(field, 'Pack the stove');
    // Added, the field is empty again, and so Add waits again.
    expect(add.disabled).toBe(true);
  });

  it('keeps the same field, emptied, for the next card', () => {
    const target = open(note);
    const field = addTo(target, 1);
    type(field, 'Book the ferry');
    // The board was redrawn in place, so the field typed into is still the one on the page.
    const again = target.dom.querySelectorAll<HTMLElement>('.cm-boardColumn')[1]!.querySelector('.cm-boardComposeField');
    expect(again).toBe(field);
    expect(field.value).toBe('');
    expect(target.dom.querySelectorAll('.cm-boardColumn')[1]!.getAttribute('aria-label')).toBe('Done, 2 cards');

    type(field, 'Pack the tent');
    expect(target.state.doc.toString()).toContain('Done: pack-tent, book-ferry, pick-date');
  });

  it('adds the card on Enter, the key a phone keyboard has for it', () => {
    const target = open(note);
    const field = addTo(target, 0);
    field.value = 'Call the venue';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(target.state.doc.toString()).toContain('- [ ] Call the venue ^call-venue\n');
    expect(field.value).toBe('');
  });

  it('writes nothing for no words, and a second press goes back to the open field', () => {
    const target = open(note);
    const field = addTo(target, 0);
    type(field, '   ');
    expect(target.state.doc.toString()).toBe(note);
    expect(addTo(target, 0)).toBe(field);
    expect(target.dom.querySelectorAll('.cm-boardCompose')).toHaveLength(1);
  });

  it('closes on Escape without writing anything', () => {
    const target = open(note);
    const field = addTo(target, 0);
    field.value = 'Half a thought';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(target.dom.querySelector('.cm-boardCompose')).toBeNull();
    expect(target.state.doc.toString()).toBe(note);
  });

  it('adds under the fence of a board that names nothing yet, and at the end of a note with no last newline', () => {
    const target = open('```board\nTo do:\n```');
    type(addTo(target, 0), 'First thing');
    expect(target.state.doc.toString()).toBe('```board\nTo do: first-thing\n```\n- [ ] First thing ^first-thing');
  });
});

describe('a card whose item is linked to a plugin', () => {
  it('shows the plugin’s mark rather than the link’s words', () => {
    const doc = ['```board', 'To do: pack', '```', '', '- [ ] Pack the tent [notion](https://app.notion.com/p/abc) ^pack'].join('\n');
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [glyphMarkdown([], []), drawnBoards()] }), parent: document.body });
    const card = view.dom.querySelector('.cm-boardCard');
    expect(card?.querySelector('.cm-boardWords')?.textContent).toBe('Pack the tent');
    expect(card?.querySelector('.cm-boardLinked')?.getAttribute('aria-label')).toBe('Linked to notion');
    view.destroy();
  });

  it('keeps an ordinary link’s words, which are part of what the item says', () => {
    const doc = ['```board', 'To do: read', '```', '', '- [ ] Read the [docs](https://example.com/docs) first ^read'].join('\n');
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [glyphMarkdown([], []), drawnBoards()] }), parent: document.body });
    const card = view.dom.querySelector('.cm-boardCard');
    expect(card?.querySelector('.cm-boardWords')?.textContent).toBe('Read the docs first');
    expect(card?.querySelector('.cm-boardLinked')).toBeNull();
    view.destroy();
  });
});

/**
 * A pointer event, as a finger sends it. jsdom may have no PointerEvent of its own, so a mouse event stands in, given
 * the pointer's id and kind.
 */
function pointer(target: EventTarget, type: string, id: number, x = 0, y = 0): void {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  if (typeof PointerEvent === 'function') {
    target.dispatchEvent(new PointerEvent(type, { ...init, pointerId: id, pointerType: 'touch' }));
    return;
  }
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  target.dispatchEvent(event);
}

/** Where an element says it is, since jsdom lays nothing out. */
function place(element: Element, left: number, top: number, width: number, height: number): void {
  const rect = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => rect });
}

/** Longer than a finger has to rest on a card before it is picked up. */
const HELD = 400;

describe('dragging a card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.cm-boardGhost').forEach((ghost) => (ghost.parentElement ?? ghost).remove());
  });

  /** The note's board laid out side by side, To do on the left and Done on the right, and its first card. */
  function laidOut(target: EditorView) {
    const board = target.dom.querySelector<HTMLElement>('.cm-board')!;
    const stacks = [...target.dom.querySelectorAll<HTMLElement>('.cm-boardStack')];
    place(board, 0, 0, 400, 400);
    place(stacks[0]!, 0, 0, 180, 300);
    place(stacks[1]!, 200, 0, 180, 300);
    const card = target.dom.querySelector<HTMLElement>('.cm-boardCard[data-card="ship-page"]')!;
    place(card, 10, 20, 160, 40);
    return { board, card };
  }

  function lifted(target: EditorView): boolean {
    return target.dom.querySelector('[data-lifted]') !== null || document.querySelector('.cm-boardGhost') !== null;
  }

  it('is picked up by a finger that rests on it', () => {
    const target = open(note);
    const { board, card } = laidOut(target);
    pointer(card, 'pointerdown', 5, 30, 40);
    expect(lifted(target)).toBe(false);
    vi.advanceTimersByTime(HELD);
    expect(card.hasAttribute('data-lifted')).toBe(true);
    expect(board.hasAttribute('data-holding')).toBe(true);
    // The copy under the finger is drawn inside a layer that carries the editor's classes, or it has no look at all.
    const ghost = document.querySelector<HTMLElement>('.cm-boardGhost')!;
    expect(ghost.parentElement?.classList.contains('cm-editor')).toBe(true);
    pointer(document.body, 'pointercancel', 5);
  });

  it('ends when the cancel arrives somewhere other than the card', () => {
    // The drag moves the card to where it would land, which loses the pointer the card had captured: the cancel then
    // goes to whatever is under the finger. Heard only on the card, the drag was left held with its copy on screen.
    const target = open(note);
    const { board, card } = laidOut(target);
    pointer(card, 'pointerdown', 5, 30, 40);
    vi.advanceTimersByTime(HELD);
    pointer(window, 'pointermove', 5, 60, 150);
    expect(card.hasAttribute('data-lifted')).toBe(true);

    pointer(document.body, 'pointercancel', 5, 60, 150);
    expect(lifted(target)).toBe(false);
    expect(board.hasAttribute('data-holding')).toBe(false);
    expect(document.querySelectorAll('.cm-editor')).toHaveLength(1);
    // Cancelled, nothing was written.
    expect(target.state.doc.toString()).toBe(note);
  });

  it('lands where the finger lets go, even when the lift is heard somewhere else', () => {
    const target = open(note);
    const { card } = laidOut(target);
    // Done's own card sits lower than the finger will, so the card goes in above it.
    place(target.dom.querySelector('.cm-boardCard[data-card="pick-date"]')!, 210, 200, 160, 40);
    pointer(card, 'pointerdown', 5, 30, 40);
    vi.advanceTimersByTime(HELD);
    // Across to Done, clear of every edge the board or a column scrolls at.
    pointer(window, 'pointermove', 5, 290, 150);
    pointer(document.body, 'pointerup', 5, 290, 150);

    expect(lifted(target)).toBe(false);
    const doc = target.state.doc.toString();
    expect(doc).toContain('```board\nTo do:\nDone: ship-page, pick-date\n```');
    // Dragged into Done, the item is done: the note says so, not only the board.
    expect(doc).toContain('- [x] Ship the pricing page ^ship-page');
  });

  it('pays no mind to another finger', () => {
    const target = open(note);
    const { card } = laidOut(target);
    pointer(card, 'pointerdown', 5, 30, 40);
    vi.advanceTimersByTime(HELD);
    pointer(window, 'pointermove', 6, 290, 150);
    pointer(document.body, 'pointerup', 6, 290, 150);
    pointer(document.body, 'pointercancel', 6);
    expect(card.hasAttribute('data-lifted')).toBe(true);
    expect(target.state.doc.toString()).toBe(note);
    pointer(document.body, 'pointercancel', 5);
    expect(lifted(target)).toBe(false);
  });

  it('is not picked up by a finger that lets go, or moves away, before the hold is up', () => {
    const target = open(note);
    const { card } = laidOut(target);

    pointer(card, 'pointerdown', 5, 30, 40);
    vi.advanceTimersByTime(100);
    pointer(document.body, 'pointerup', 5, 30, 40);
    vi.advanceTimersByTime(HELD);
    expect(lifted(target)).toBe(false);

    // A finger that moves first is scrolling the board: the card is left where it is.
    pointer(card, 'pointerdown', 7, 30, 40);
    pointer(window, 'pointermove', 7, 30, 120);
    vi.advanceTimersByTime(HELD);
    expect(lifted(target)).toBe(false);
    pointer(document.body, 'pointerup', 7, 30, 120);
    expect(target.state.doc.toString()).toBe(note);
  });
});

describe('changing a card’s status keeps you on the board', () => {
  const card = (on: EditorView, id: string) => on.dom.querySelector<HTMLElement>(`.cm-boardCard[data-card="${id}"]`)!;
  const tap = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const caretLine = (on: EditorView) => on.state.doc.lineAt(on.state.selection.main.head).number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('ticks the card and moves it to Done without going to the line', () => {
    const on = open(note);
    tap(card(on, 'ship-page').querySelector('.cm-boardTick')!);
    expect(on.state.doc.toString()).toContain('- [x] Ship the pricing page ^ship-page');
    expect(on.state.doc.toString()).toContain('Done: pick-date, ship-page');
    expect(caretLine(on)).toBe(1);
  });

  it('ignores a press on the words that comes straight after, the one a finger a little off makes', () => {
    const on = open(note);
    tap(card(on, 'ship-page').querySelector('.cm-boardTick')!);
    vi.advanceTimersByTime(200);
    tap(card(on, 'ship-page').querySelector('.cm-boardWords')!);
    expect(caretLine(on), 'the note must not have gone to the line').toBe(1);
  });

  it('still goes to the line when the words are pressed on their own, a moment later', () => {
    const on = open(note);
    tap(card(on, 'ship-page').querySelector('.cm-boardTick')!);
    vi.advanceTimersByTime(1000);
    tap(card(on, 'ship-page').querySelector('.cm-boardWords')!);
    expect(on.state.doc.line(caretLine(on)).text).toContain('Ship the pricing page');
  });
});

describe('a slow tap on a card’s controls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not pick the card up, however long the finger rests on the tick', () => {
    const on = open(note);
    const tick = on.dom.querySelector<HTMLElement>('.cm-boardCard[data-card="ship-page"] .cm-boardTick')!;
    tick.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(600);
    expect(on.dom.querySelector('[data-lifted]'), 'the card must not lift from its tick box').toBeNull();
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch' }));
    tick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(on.state.doc.toString()).toContain('- [x] Ship the pricing page ^ship-page');
  });

  it('still picks the card up from its words', () => {
    const on = open(note);
    const words = on.dom.querySelector<HTMLElement>('.cm-boardCard[data-card="ship-page"] .cm-boardWords')!;
    words.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', clientX: 10, clientY: 10 }));
    vi.advanceTimersByTime(600);
    expect(on.dom.querySelector('[data-lifted]')).not.toBeNull();
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 8, pointerType: 'touch' }));
  });
});

describe('the line under a board', () => {
  /** The board's divider, and the lanes' height it has set. */
  function split(target: EditorView) {
    const line = target.dom.querySelector<HTMLElement>('.cm-boardSplit')!;
    const board = target.dom.querySelector<HTMLElement>('.cm-board')!;
    return { line, board, height: () => board.style.getPropertyValue('--cm-lane-height') };
  }

  it('is a separator under every board, and draws a height the fence sets', () => {
    const target = open(note.replace('```board', '```board height=18'));
    const { line, board, height } = split(target);
    expect(line.getAttribute('role')).toBe('separator');
    // A handle to take hold of, at its middle (Matt: "Add resize handle in the bottom middle of board to resize"): the
    // plain grip pill, nothing drawn on it ("doesnt match the simplistic version anymore").
    expect(line.querySelector('.cm-boardGrip')).not.toBeNull();
    expect(line.querySelector('.cm-boardGrip')?.childElementCount).toBe(0);
    expect(line.title).toBe('Drag to resize the board');
    expect(line.getAttribute('aria-valuenow')).toBe('18');
    expect(board.hasAttribute('data-sized')).toBe(true);
    expect(height()).toBe('18em');
  });

  it('steps with the arrow keys and goes to either end with Home and End, writing the fence each time', () => {
    const target = open(note.replace('```board', '```board height=18'));
    const key = (name: string) => split(target).line.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    key('ArrowDown');
    expect(target.state.doc.toString()).toContain('```board height=19\n');
    key('Home');
    expect(target.state.doc.toString()).toContain('```board height=5\n');
    key('End');
    expect(target.state.doc.toString()).toContain('```board height=60\n');
    // The same line is kept through each change, so the focus stays where the keys are.
    expect(split(target).height()).toBe('60em');
  });

  it('goes back to the board\u2019s own height on a double tap', () => {
    const target = open(note.replace('```board', '```board height=18'));
    split(target).line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(target.state.doc.toString()).toContain('```board\nTo do:');
    const { board, height } = split(target);
    expect(board.hasAttribute('data-sized')).toBe(false);
    expect(height()).toBe('');
  });

  it('follows a drag as a style and writes the height when the finger lifts, and not at all when called off', () => {
    vi.useFakeTimers();
    try {
      const target = open(note.replace('```board', '```board height=18'));
      const { line, height } = split(target);
      // The lanes' ems are 16px, which jsdom does not work out.
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '16px', maxHeight: '304px' } as unknown as CSSStyleDeclaration);
      pointer(line, 'pointerdown', 3, 100, 500);
      pointer(window, 'pointermove', 3, 100, 580);
      // Eighty pixels down is five ems more, drawn but not written.
      expect(height()).toBe('23em');
      expect(target.state.doc.toString()).toContain('```board height=18\n');
      pointer(document.body, 'pointerup', 3, 100, 580);
      expect(target.state.doc.toString()).toContain('```board height=23\n');

      pointer(split(target).line, 'pointerdown', 4, 100, 500);
      pointer(window, 'pointermove', 4, 100, 400);
      pointer(document.body, 'pointercancel', 4);
      expect(target.state.doc.toString()).toContain('```board height=23\n');
      expect(split(target).height()).toBe('23em');
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});

describe('an empty column', () => {
  // Matt: "add an icon when there are no items in a board like no todo items or no doing tasks".
  it('shows a picture and says it is empty, by what the column is for', () => {
    const target = open('```board\nTo do:\nDoing:\nDone: ship\nWaiting on Sam:\n```\n\n- [x] Ship it ^ship\n');
    const columns = [...target.dom.querySelectorAll<HTMLElement>('.cm-boardColumn')];
    const empty = columns.map((column) => column.querySelector<HTMLElement>('.cm-boardEmpty')!);
    // Every column has the place; only the empty ones show it at rest.
    expect(empty.map((place) => place.hasAttribute('data-none'))).toEqual([true, true, false, true]);
    expect(empty.map((place) => place.querySelector('.cm-boardEmptyRest')?.textContent)).toEqual([
      'Nothing to do',
      'Nothing in progress',
      'Nothing done yet',
      'Nothing to do',
    ]);
    expect(empty.every((place) => place.querySelector('.cm-boardEmptyIcon') instanceof SVGSVGElement)).toBe(true);
    // Held, a card is dropped on the same place, which says so.
    expect(empty[0]?.querySelector('.cm-boardEmptyDrop')?.textContent).toBe('Drop a card here');
  });

  it('stops being empty when a card arrives, and is empty again when it goes', () => {
    const target = open('```board\nTo do:\nDone:\n```\n');
    const place = (index: number) => target.dom.querySelectorAll<HTMLElement>('.cm-boardColumn')[index]!.querySelector('.cm-boardEmpty')!;
    expect(place(0).hasAttribute('data-none')).toBe(true);
    type(addTo(target, 0), 'Book the ferry');
    expect(place(0).hasAttribute('data-none')).toBe(false);
    expect(place(1).hasAttribute('data-none')).toBe(true);
    // Moved along with its arrow, the card leaves To do empty and Done not.
    const right = target.dom.querySelector<HTMLButtonElement>('.cm-boardCard[data-card="book-ferry"] .cm-boardMove:last-child')!;
    right.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(target.state.doc.toString()).toContain('To do:\nDone: book-ferry');
    expect(place(0).hasAttribute('data-none')).toBe(true);
    expect(place(1).hasAttribute('data-none')).toBe(false);
  });

  it('reads the common column names, and gives any other the plain tray', () => {
    expect(emptyLook('Backlog')).toEqual({ icon: 'todo', words: 'Nothing to do' });
    expect(emptyLook('In progress')).toEqual({ icon: 'doing', words: 'Nothing in progress' });
    expect(emptyLook('Done')).toEqual({ icon: 'done', words: 'Nothing done yet' });
    expect(emptyLook('Ideas')).toEqual({ icon: 'inbox', words: 'No cards' });
  });
});

describe('a tap on a card\u2019s words', () => {
  it('puts the caret at the end of the item\u2019s words, before its mark and anchor', () => {
    // Clear of the moment after a card was moved in an earlier test, when a tap on words is taken for a near miss.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    const url = 'https://app.notion.com/p/x';
    const target = open(`\`\`\`board\nTo do: ship\n\`\`\`\n\n- [ ] Ship it [notion](${url}) ^ship\n`);
    const words = target.dom.querySelector<HTMLButtonElement>('.cm-boardCard[data-card="ship"] .cm-boardWords')!;
    words.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const head = target.state.selection.main.head;
    const line = target.state.doc.lineAt(head);
    expect(line.text.slice(0, head - line.from)).toBe('- [ ] Ship it');
    vi.useRealTimers();
  });
});

describe('a board not yet on the screen', () => {
  // The editor sizes what it has not drawn by the widget's own guess: a board used to be one line tall until it was
  // drawn, and the note jumped by the difference as it came into view (Matt: "scrolling past boards is glitchy and
  // stops scroll momentum").
  const height = (text: string) => {
    const target = open(text);
    const at = target.state.doc.toString().indexOf('```board');
    const tall = target.lineBlockAt(at).height;
    target.destroy();
    view = null;
    return tall;
  };

  it('is as tall as its cards, not one line', () => {
    const two = height(note);
    expect(two).toBeGreaterThan(120);
    const more = note.replace('To do: ship-page', 'To do: ship-page, a1, a2, a3') + '- [ ] One ^a1\n- [ ] Two ^a2\n- [ ] Three ^a3\n';
    expect(height(more)).toBeGreaterThan(two + 150);
  });

  it('gives long words more lines, and a set height its own', () => {
    const long = note.replace('Ship the pricing page', 'Ship the pricing page and the launch post and the changelog and the rest of it');
    expect(height(long)).toBeGreaterThan(height(note));
    const set = height(note.replace('```board', '```board height=30'));
    const setTaller = height(note.replace('```board', '```board height=40'));
    expect(Math.round(setTaller - set)).toBe(Math.round(10 * 16.64));
  });
});

describe('the + field and password managers', () => {
  it('says it is not a login, in each of the ways they read', () => {
    const target = open(note);
    addTo(target, 0);
    const form = target.dom.querySelector<HTMLFormElement>('.cm-boardCompose')!;
    const field = form.querySelector<HTMLInputElement>('.cm-boardComposeField')!;
    // Matt: "New Tasks are popping password manager save modal".
    for (const box of [form, field]) {
      expect(box.getAttribute('autocomplete')).toBe('off');
      expect(box.getAttribute('data-form-type')).toBe('other');
      expect(box.hasAttribute('data-1p-ignore')).toBe(true);
      expect(box.getAttribute('data-lpignore')).toBe('true');
    }
    // A field with a name is a field they can tell apart from a username.
    expect(field.name).toBe('card');
  });
});
