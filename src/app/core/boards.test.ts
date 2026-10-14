import { describe, expect, it } from 'vitest';
import {
  addToBoard,
  anchorFor,
  boardCopy,
  boardFrom,
  boardFromList,
  addToLane,
  lanesOf,
  matchLane,
  moveToLane,
  nearAnchor,
  wordsEnd,
  withoutCard,
  BOARD_HEIGHT,
  boardsIn,
  cardText,
  clampHeight,
  cardsOf,
  columnFor,
  columnOf,
  doneColumn,
  isItemLine,
  itemAt,
  itemOnLine,
  itemWords,
  itemsIn,
  listAround,
  moveCard,
  newCard,
  putCard,
  putCardAt,
  readBoard,
  refFor,
  refsIn,
  setItemDone,
  settleBoards,
  settleTicks,
  settleColumns,
  withAnchor,
  withBoardHeight,
  writeBoard,
} from './boards.ts';

const note = `# Launch week

\`\`\`board
To do: ship-page, email-list
In progress: fix-login
Done: pick-date
\`\`\`

- [ ] Ship the pricing page ^ship-page
- [ ] Email the beta list ^email-list
- [ ] Fix the login button ^fix-login
- [x] Pick a launch date ^pick-date
- [ ] Something not on the board
`;

describe('a board in markdown', () => {
  it('reads the columns and the cards in them', () => {
    const columns = readBoard('To do: ship-page, email-list\nIn progress: fix-login\nDone: pick-date');
    expect(columns.map((c) => c.name)).toEqual(['To do', 'In progress', 'Done']);
    expect(columns[0]?.cards).toEqual(['ship-page', 'email-list']);
    expect(columns[2]?.cards).toEqual(['pick-date']);
  });

  it('gives an id in two lanes to the first of them, so a card is never drawn twice', () => {
    const doc = '```board\nTo do: alpha, beta\nDoing: alpha\nDone:\n```\n\n- [ ] Alpha ^alpha\n- [ ] Beta ^beta\n';
    const columns = boardsIn(doc)[0]!.columns;
    expect(columns.map((column) => column.cards)).toEqual([['alpha', 'beta'], [], []]);
    // Written back, the note says what the board shows: the second mention is gone, not drawn in a lane of its own.
    expect(writeBoard(columns)).toBe('To do: alpha, beta\nDoing:\nDone:');
  });

  it('reads a lane id written as words when the note has that anchor, and leaves other words alone', () => {
    const doc = '```board\nTo do: Fix Login, ^Add Controls To\nDoing: Sam to reply\n```\n\n- [ ] Fix login ^fix-login\n- [ ] Add controls ^add-controls-to\n';
    const columns = boardsIn(doc)[0]!.columns;
    expect(columns.map((column) => column.cards)).toEqual([['fix-login', 'add-controls-to'], []]);
    // An id no item answers is not made up out of words after the colon; a plain anchor still is, and shows as missing.
    expect(boardsIn('```board\nTo do: ship-page\n```\n')[0]?.columns[0]?.cards).toEqual(['ship-page']);
  });

  it('keeps an empty column, joins a name said twice, and ignores what is not an anchor', () => {
    const columns = readBoard('Blocked:\nTo do: a, Not An Anchor, b\nto do: c\n\n   \n: nothing');
    expect(columns.map((c) => c.name)).toEqual(['Blocked', 'To do']);
    expect(columns[0]?.cards).toEqual([]);
    expect(columns[1]?.cards).toEqual(['a', 'b', 'c']);
  });

  it('takes an anchor written with its caret, and drops a card named twice', () => {
    expect(readBoard('To do: ^a, a, ^b')[0]?.cards).toEqual(['a', 'b']);
  });

  it('writes the columns back the way a person types them', () => {
    const columns = readBoard('To do: a, b\nBlocked:\nDone: c');
    expect(writeBoard(columns)).toBe('To do: a, b\nBlocked:\nDone: c');
  });

  it('finds the boards in a note, with the lines their fences are on', () => {
    const boards = boardsIn(note);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.from).toBe(3);
    expect(boards[0]?.to).toBe(7);
    expect(boards[0]?.columns).toHaveLength(3);
  });

  it('reads an unclosed fence as a board that has not been finished', () => {
    const boards = boardsIn('```board\nTo do: a\n');
    expect(boards[0]?.from).toBe(1);
    expect(boards[0]?.to).toBe(1);
    expect(boards[0]?.columns).toEqual([]);
  });
});

describe('the items a board points at', () => {
  it('finds every anchored item, with its words and its box', () => {
    const items = itemsIn(note);
    expect(items.map((t) => t.id)).toEqual(['ship-page', 'email-list', 'fix-login', 'pick-date']);
    expect(items[0]).toMatchObject({ text: 'Ship the pricing page', done: false, line: 9 });
    expect(items[3]?.done).toBe(true);
  });

  it('anchors any kind of list item, not only a to-do', () => {
    const items = itemsIn('- Ask Sam about the copy ^ask-sam\n1. Unplug it ^unplug\n* A star ^star\n- [x] Ticked ^ticked');
    expect(items.map((item) => item.id)).toEqual(['ask-sam', 'unplug', 'star', 'ticked']);
    // An item with no box has nothing to tick, which is not the same as being unticked.
    expect(items.map((item) => item.done)).toEqual([null, null, null, true]);
    expect(items[1]?.text).toBe('Unplug it');
  });

  it('leaves a superscript alone: an anchor needs a space before it and the line to end after it', () => {
    expect(itemOnLine('- E = mc^2^')).toBeNull();
    expect(itemOnLine('- the 2 ^nd^ of June')).toBeNull();
    expect(itemOnLine('- a fact ^unsure^ and more')).toBeNull();
    // The boundary: a closing caret makes it a superscript, and nothing else does.
    expect(itemOnLine('- item ^a^')).toBeNull();
    expect(itemOnLine('- Ship it ^ship-page')).toMatchObject({ id: 'ship-page', text: 'Ship it' });
  });

  it('reads an item whose words are not written yet, which is what the + on a column leaves behind', () => {
    expect(itemOnLine('- [ ] ^item')).toMatchObject({ id: 'item', text: '', done: false });
    expect(isItemLine('- [ ] ^item')).toBe(true);
    expect(setItemDone('- [ ] ^item', true)).toBe('- [x] ^item');
  });

  it('finds an item whose Notion mark was written after its anchor, and keeps the mark with its words', () => {
    // Matt: "the last two items show up weird on the board as only their label no title".
    const doc = [
      '```board',
      'To do: add-task-input, make-board-height',
      '```',
      '',
      '- [ ] Add task input and button dont match up ^add-task-input [notion](https://app.notion.com/p/Add-task-input-3dd5)',
      '- [ ] make board height configurable with glacierUI split view ^make-board-height [notion](https://app.notion.com/p/make-board-height-3dd5)',
      '- [ ] ',
    ].join('\n');
    const cards = cardsOf(boardsIn(doc)[0]!.columns, itemsIn(doc));
    expect(cards.map((card) => card.item?.text)).toEqual([
      'Add task input and button dont match up [notion](https://app.notion.com/p/Add-task-input-3dd5)',
      'make board height configurable with glacierUI split view [notion](https://app.notion.com/p/make-board-height-3dd5)',
    ]);
    // Ticking it leaves the line as it was written, anchor and mark both where they were.
    expect(setItemDone(doc.split('\n')[4]!, true)).toBe(
      '- [x] Add task input and button dont match up ^add-task-input [notion](https://app.notion.com/p/Add-task-input-3dd5)',
    );
    // Only a mark may follow the anchor: anything else, and the caret is words.
    expect(itemOnLine('- [ ] Ship ^ship-it and then more')).toBeNull();
    expect(itemOnLine('- [ ] Ship ^ship-it [a link](not-a-url)')).toBeNull();
  });

  it('takes the first item of a repeated anchor', () => {
    expect(itemsIn('- [ ] One ^a\n- [ ] Two ^a')).toHaveLength(1);
  });

  it('knows a list item from a line of words, and finds an item by its anchor', () => {
    expect(isItemLine('- [ ] Ship it')).toBe(true);
    expect(isItemLine('  1. Unplug it')).toBe(true);
    expect(isItemLine('Just a line')).toBe(false);
    expect(isItemLine('- ')).toBe(false);
    expect(itemAt(note, 'fix-login')).toMatchObject({ text: 'Fix the login button', line: 11 });
    expect(itemAt(note, 'nowhere')).toBeNull();
  });

  it('reads one line, and ticks or clears it keeping its words and anchor', () => {
    expect(itemOnLine('  - [ ] Ship it ^ship-page')).toMatchObject({ id: 'ship-page', text: 'Ship it', done: false });
    expect(itemOnLine('- [ ] no anchor here')).toBeNull();
    expect(setItemDone('  - [ ] Ship it ^ship-page', true)).toBe('  - [x] Ship it ^ship-page');
    expect(setItemDone('- [X] Ship it ^ship-page', false)).toBe('- [ ] Ship it ^ship-page');
    expect(setItemDone('- [ ] No anchor', true)).toBe('- [x] No anchor');
    // A bullet has no box: ticking it would have to write one, and the note is the person's.
    expect(setItemDone('- Ask Sam ^ask-sam', true)).toBe('- Ask Sam ^ask-sam');
  });

  it('gives a line its anchor once', () => {
    expect(withAnchor('- Ask Sam  ', 'ask-sam')).toBe('- Ask Sam ^ask-sam');
    expect(withAnchor('- Ask Sam ^mine', 'ask-sam')).toBe('- Ask Sam ^mine');
  });

  it('pairs cards with their items, and says when one is gone', () => {
    const board = boardsIn(note)[0]!;
    const cards = cardsOf(board.columns, itemsIn(note));
    expect(cards).toHaveLength(4);
    expect(cards[0]).toMatchObject({ id: 'ship-page', column: 0 });
    expect(cards[0]?.item?.text).toBe('Ship the pricing page');
    const gone = cardsOf(readBoard('To do: nowhere'), itemsIn(note));
    expect(gone[0]).toMatchObject({ id: 'nowhere', item: null });
  });
});

describe('an anchor pointed at from the words', () => {
  it('is found anywhere in a line, and reads as the item it names', () => {
    const line = 'the copy is waiting on [[#^ask-sam]] and [[#^ship-page]]';
    expect(refsIn(line).map((ref) => ref.id)).toEqual(['ask-sam', 'ship-page']);
    expect(refsIn(line, 10)[0]?.from).toBe(33);
    expect(refFor('ask-sam')).toBe('[[#^ask-sam]]');
  });

  it('is not a link to another note, and takes only an anchor between the brackets', () => {
    expect(refsIn('[[The cabin trip]]')).toEqual([]);
    expect(refsIn('[[#^Not An Anchor]]')).toEqual([]);
    expect(refsIn('[[#^ok]]')).toHaveLength(1);
  });

  it('is said by a card as the anchor, not as its brackets', () => {
    expect(cardText('waiting on [[#^ask-sam]]')).toBe('waiting on ^ask-sam');
  });
});

describe('moving a card', () => {
  const columns = readBoard('To do: a, b\nDoing: c\nDone: d');

  it('goes one column along, and stops at either end', () => {
    expect(writeBoard(moveCard(columns, 'a', 1))).toBe('To do: b\nDoing: c, a\nDone: d');
    expect(writeBoard(moveCard(columns, 'a', -1))).toBe('To do: a, b\nDoing: c\nDone: d');
    expect(writeBoard(moveCard(columns, 'd', 1))).toBe('To do: a, b\nDoing: c\nDone: d');
    expect(writeBoard(moveCard(columns, 'nothing', 1))).toBe(writeBoard(columns));
  });

  it('is put in a column outright, and leaves the one it was in', () => {
    expect(writeBoard(putCard(columns, 'a', 2))).toBe('To do: b\nDoing: c\nDone: d, a');
    expect(writeBoard(putCard(columns, 'a', 0))).toBe('To do: b, a\nDoing: c\nDone: d');
    expect(writeBoard(putCard(columns, 'a', 9))).toBe(writeBoard(columns));
  });

  it('is dropped between two cards, at the place the gap was shown', () => {
    expect(writeBoard(putCardAt(columns, 'c', 0, 0))).toBe('To do: c, a, b\nDoing:\nDone: d');
    expect(writeBoard(putCardAt(columns, 'c', 0, 1))).toBe('To do: a, c, b\nDoing:\nDone: d');
    expect(writeBoard(putCardAt(columns, 'c', 0, 99))).toBe('To do: a, b, c\nDoing:\nDone: d');
  });

  it('is reordered inside its own column, counting the places without itself', () => {
    expect(writeBoard(putCardAt(columns, 'a', 0, 1))).toBe('To do: b, a\nDoing: c\nDone: d');
    expect(writeBoard(putCardAt(columns, 'b', 0, 0))).toBe('To do: b, a\nDoing: c\nDone: d');
    expect(writeBoard(putCardAt(columns, 'a', 0, 0))).toBe(writeBoard(columns));
    // The columns given are never changed, only answered anew.
    expect(columns[0]?.cards).toEqual(['a', 'b']);
  });

  it('knows which column is Done, and where a ticked item belongs', () => {
    expect(doneColumn(columns)).toBe(2);
    expect(doneColumn(readBoard('To do: a\nWaiting: b'))).toBe(-1);
    expect(columnOf(columns, 'c')).toBe(1);
    expect(columnFor(columns, { id: 'a', text: 'A', done: true, line: 1 })).toBe(2);
    expect(columnFor(columns, { id: 'a', text: 'A', done: false, line: 1 })).toBe(0);
    // An item with no box is wherever the board has it, ticks being nothing to do with it.
    expect(columnFor(columns, { id: 'c', text: 'C', done: null, line: 1 })).toBe(1);
    // With no Done column, a ticked item stays where the board has it.
    const plain = readBoard('To do: a\nWaiting: b');
    expect(columnFor(plain, { id: 'a', text: 'A', done: true, line: 1 })).toBe(0);
  });
});

describe('putting a list item on a board', () => {
  it('names an item that has no anchor, from its own words', () => {
    expect(anchorFor('Book the ferry before Friday', [])).toBe('book-ferry-before');
    expect(anchorFor('Book the ferry', ['book-ferry'])).toBe('book-ferry-2');
    expect(anchorFor('!!!', [])).toBe('item');
  });

  it('leaves the filler out, so two items that start alike are not named alike', () => {
    expect(anchorFor('Add ability to auto-tag notes', [])).toBe('add-ability-auto');
    expect(anchorFor('Add ability to add tags', [])).toBe('add-ability-add');
    expect(anchorFor('Git icon is messed up', [])).toBe('git-icon-messed');
    expect(anchorFor('The fade in is too slow', [])).toBe('fade-too-slow');
    // Words that are all filler keep them, rather than come out as nothing.
    expect(anchorFor('Is it on', [])).toBe('is-it-on');
  });

  it('adds the card to the first column, and gives the line its anchor', () => {
    const added = addToBoard(note, 13)!;
    expect(added.id).toBe('something-not-board');
    expect(added.line).toEqual({ number: 13, text: '- [ ] Something not on the board ^something-not-board' });
    expect(added.fence).toMatchObject({ from: 3, to: 7 });
    expect(added.fence.body.split('\n')[0]).toBe('To do: ship-page, email-list, something-not-board');
    expect(added.column).toBe('To do');
  });

  it('takes a bullet as readily as a to-do', () => {
    const doc = note.replace('- [ ] Something not on the board', '- Ask Sam about the copy');
    const added = addToBoard(doc, 13)!;
    expect(added.id).toBe('ask-sam-about');
    expect(added.line?.text).toBe('- Ask Sam about the copy ^ask-sam-about');
    expect(added.column).toBe('To do');
  });

  it('uses the board its own list is already on, not the nearest one above', () => {
    // Two boards: the list at the foot belongs to the second, though the first is also above it.
    const doc = [
      '```board',
      'To do: alpha',
      'Done:',
      '```',
      '',
      '- [ ] Alpha ^alpha',
      '',
      '## Later',
      '',
      '```board',
      'Next: beta',
      'Done:',
      '```',
      '',
      '- [ ] Beta ^beta',
      '- [ ] Gamma',
      '',
    ].join('\n');
    const added = addToBoard(doc, 16)!;
    expect(added.fence).toMatchObject({ from: 10, to: 13 });
    expect(added.fence.body).toBe('Next: beta, gamma\nDone:');
    expect(added.column).toBe('Next');
  });

  it('goes in beside the neighbour it follows in the list, keeping the list\u2019s order', () => {
    const doc = ['```board', 'To do: one, three', 'Done:', '```', '', '- [ ] One ^one', '- [ ] Two', '- [ ] Three ^three', ''].join('\n');
    // Two sits between one and three in the list, so its card goes between theirs.
    expect(addToBoard(doc, 7)?.fence.body).toBe('To do: one, two, three\nDone:');
  });

  it('is not offered for an item already on the board', () => {
    expect(addToBoard(note, 9)).toBeNull();
    expect(addToBoard(note, 1)).toBeNull();
  });

  it('puts a ticked item straight in Done, and keeps the anchor it has', () => {
    const doc = note.replace('- [ ] Something not on the board', '- [x] Something not on the board ^later');
    const added = addToBoard(doc, 13)!;
    expect(added.id).toBe('later');
    expect(added.line).toBeNull();
    expect(added.column).toBe('Done');
    expect(added.fence.body).toContain('Done: pick-date, later');
  });

  it('answers nothing for a line that is no list item, a note with no board, or an item already on one', () => {
    expect(addToBoard(note, 1)).toBeNull();
    expect(addToBoard('- [ ] Alone in the world', 1)).toBeNull();
    expect(addToBoard(note, 9)).toBeNull();
  });
});

describe('a card added from the board itself', () => {
  it('writes a to-do with its words under the last item the board names, named after them', () => {
    const made = newCard(note, 3, 1, 'Rename the weak anchors')!;
    expect(made.id).toBe('rename-weak-anchors');
    expect(made.at).toBe(13);
    // A real task list item anywhere: a space after the box, the words, then the anchor.
    expect(made.text).toBe('- [ ] Rename the weak anchors ^rename-weak-anchors');
    expect(itemOnLine(made.text)).toMatchObject({ id: 'rename-weak-anchors', text: 'Rename the weak anchors', done: false });
  });

  it('puts the card at the top of the column tapped, or where it is told', () => {
    expect(newCard(note, 3, 1, 'Book the ferry')!.fence.body).toBe('To do: ship-page, email-list\nIn progress: book-ferry, fix-login\nDone: pick-date');
    expect(newCard(note, 3, 0, 'Book the ferry', 99)!.fence.body.split('\n')[0]).toBe('To do: ship-page, email-list, book-ferry');
  });

  it('makes nothing without words, so no card is ever named after nothing', () => {
    expect(newCard(note, 3, 0, '')).toBeNull();
    expect(newCard(note, 3, 0, '   ')).toBeNull();
  });

  it('keeps each name its own, and tidies the words it is given', () => {
    const made = newCard(note, 3, 0, '  Ship   the page  ')!;
    expect(made.text).toBe('- [ ] Ship the page ^ship-page-2');
  });

  it('goes under the fence when the board names nothing yet, and answers nothing off a board', () => {
    const empty = '```board\nTo do:\nDone:\n```\n';
    expect(newCard(empty, 1, 0, 'First')).toMatchObject({ at: 5, text: '- [ ] First ^first' });
    expect(newCard(note, 9, 0, 'Words')).toBeNull();
    expect(newCard(note, 3, 7, 'Words')).toBeNull();
  });
});

describe('a list made into a board', () => {
  const list = [
    '# Task Management',
    '',
    '- [ ] Ship the pricing page',
    '- [x] Pick a launch date',
    '- [ ] Email the [beta list](https://example.com/list)',
    '',
  ].join('\n');

  it('anchors every item and lays the columns out under the title', () => {
    const made = boardFrom(list)!;
    expect(made.cards).toBe(3);
    expect(made.done).toBe(1);
    expect(made.doc.split('\n')).toEqual([
      '# Task Management',
      '',
      '```board',
      'To do: ship-pricing-page, email-beta-list',
      'Doing:',
      'Done: pick-launch-date',
      '```',
      '',
      '- [ ] Ship the pricing page ^ship-pricing-page',
      '- [x] Pick a launch date ^pick-launch-date',
      '- [ ] Email the [beta list](https://example.com/list) ^email-beta-list',
      '',
    ]);
  });

  it('reads back as the board it looks like', () => {
    const made = boardFrom(list)!;
    const board = boardsIn(made.doc)[0]!;
    const cards = cardsOf(board.columns, itemsIn(made.doc));
    expect(cards.map((card) => card.item?.text)).toEqual(['Ship the pricing page', 'Email the [beta list](https://example.com/list)', 'Pick a launch date']);
  });

  it('takes a plain list as well, whose cards have no box to tick', () => {
    const made = boardFrom('- Oat milk\n- Rye bread')!;
    expect(made.cards).toBe(2);
    expect(made.done).toBe(0);
    expect(made.doc.split('\n').slice(6)).toEqual(['- Oat milk ^oat-milk', '- Rye bread ^rye-bread']);
    expect(itemsIn(made.doc).map((item) => item.done)).toEqual([null, null]);
  });

  it('leaves a list inside a block of code exactly as it is', () => {
    const made = boardFrom('- Real item\n\n```md\n- [ ] not a task, an example\n```\n')!;
    expect(made.cards).toBe(1);
    expect(made.doc).toContain('- [ ] not a task, an example\n');
    expect(made.doc).not.toContain('example ^');
  });

  it('keeps an anchor an item already has, and leaves the words alone', () => {
    const made = boardFrom('- [ ] Already named ^mine\n- [ ] The other one')!;
    expect(made.doc.split('\n').slice(6)).toEqual(['- [ ] Already named ^mine', '- [ ] The other one ^other-one']);
    expect(made.doc.split('\n')[1]).toBe('To do: mine, other-one');
  });

  it('takes the columns it is given, and puts what is ticked in the one called Done', () => {
    const made = boardFrom('- [x] One\n- [ ] Two', ['Later', 'Done now'])!;
    expect(made.doc.split('\n').slice(0, 4)).toEqual(['```board', 'Later: two', 'Done now: one', '```']);
  });

  it('answers nothing for a note with no list, or one that is a board already', () => {
    expect(boardFrom('# Notes\n\nJust words.')).toBeNull();
    expect(boardFrom(note)).toBeNull();
  });
});

describe('what a card says', () => {
  it('says a link by its words and drops the marks around them', () => {
    expect(cardText('Fix the [login button](https://example.com/a/very/long/url) *today*')).toBe('Fix the login button today');
    expect(cardText('Read <https://example.com/x>')).toBe('Read https://example.com/x');
    expect(cardText('  lots   of   room  ')).toBe('lots of room');
  });
});

describe('a board taken away as words', () => {
  it('gives the fence and the items it names, in the order the note has them', () => {
    expect(boardCopy(note, 4)).toBe(
      [
        '```board',
        'To do: ship-page, email-list',
        'In progress: fix-login',
        'Done: pick-date',
        '```',
        '',
        '- [ ] Ship the pricing page ^ship-page',
        '- [ ] Email the beta list ^email-list',
        '- [ ] Fix the login button ^fix-login',
        '- [x] Pick a launch date ^pick-date',
        '',
      ].join('\n'),
    );
  });

  it('is the same board again when it is pasted into an empty note', () => {
    const again = boardCopy(note, 3)!;
    expect(boardsIn(again)[0]?.columns).toEqual(boardsIn(note)[0]?.columns);
    expect(itemsIn(again).map((item) => item.id)).toEqual(['ship-page', 'email-list', 'fix-login', 'pick-date']);
  });

  it('takes a board with no items yet, and answers nothing off a board', () => {
    expect(boardCopy('```board\nTo do:\n```', 2)).toBe('```board\nTo do:\n```\n');
    expect(boardCopy(note, 9)).toBeNull();
    expect(boardCopy('- [ ] Alone', 1)).toBeNull();
  });
});

describe('how tall a board is', () => {
  it('is read from the fence, and is the board\u2019s own height when the fence says nothing', () => {
    expect(boardsIn(note)[0]?.height).toBeNull();
    expect(boardsIn('```board height=18\nTo do: a\n```')[0]).toMatchObject({ height: 18, columns: [{ name: 'To do', cards: ['a'] }] });
    expect(boardsIn('~~~ board height=12.5em\nTo do:\n~~~')[0]?.height).toBe(12.5);
    // Junk after the word is a setting nobody reads, and the board is still a board.
    expect(boardsIn('```board wide\nTo do:\n```')[0]).toMatchObject({ height: null, columns: [{ name: 'To do', cards: [] }] });
    // A word that only starts with "board" is not a board.
    expect(boardsIn('```boards\nTo do:\n```')).toEqual([]);
  });

  it('is kept between a card and a half and a long screen, to the half em', () => {
    expect(boardsIn('```board height=1\nTo do:\n```')[0]?.height).toBe(BOARD_HEIGHT.min);
    expect(boardsIn('```board height=900\nTo do:\n```')[0]?.height).toBe(BOARD_HEIGHT.max);
    expect(clampHeight(17.3)).toBe(17.5);
  });

  it('is written into the fence and taken out again, the rest of the line as it was', () => {
    expect(withBoardHeight('```board', 18)).toBe('```board height=18');
    expect(withBoardHeight('```board height=18', 24.2)).toBe('```board height=24');
    expect(withBoardHeight('  ~~~~ Board wide height=18 ', 9)).toBe('  ~~~~ Board height=9 wide');
    expect(withBoardHeight('```board height=18 wide', null)).toBe('```board wide');
    expect(withBoardHeight('```board height=18', null)).toBe('```board');
    expect(withBoardHeight('```js', 18)).toBe('```js');
    // What it writes, it reads back.
    expect(boardsIn(`${withBoardHeight('```board', 21.5)}\nTo do:\n\`\`\``)[0]?.height).toBe(21.5);
  });
});

describe('one list made into a board', () => {
  // Matt: "add ability to auto list a section of list items into a board".
  const doc = [
    '# Trip',
    '',
    'Packing:',
    '- [ ] Tent',
    '- [x] Stove',
    '  bring the spare gas',
    '',
    '- [ ] Maps',
    '',
    '',
    '- Not this list',
    '',
    '## Errands',
    '1. Post office',
    '2. Bank',
    '',
    '```md',
    '- [ ] an example, not a list',
    '```',
  ].join('\n');

  it('finds the list a line is in, blank line and indented lines included, and stops at two blank lines', () => {
    expect(listAround(doc, 4)).toEqual({ from: 4, to: 8 });
    expect(listAround(doc, 6)).toEqual({ from: 4, to: 8 });
    expect(listAround(doc, 8)).toEqual({ from: 4, to: 8 });
    expect(listAround(doc, 11)).toEqual({ from: 11, to: 11 });
    expect(listAround(doc, 15)).toEqual({ from: 14, to: 15 });
  });

  it('finds no list on a line of words, a heading, a blank line, or inside a block of code', () => {
    expect(listAround(doc, 3)).toBeNull();
    expect(listAround(doc, 13)).toBeNull();
    expect(listAround(doc, 9)).toBeNull();
    expect(listAround(doc, 18)).toBeNull();
  });

  it('makes that list a board set in just above it, and leaves everything else alone', () => {
    const made = boardFromList(doc, 4, 8)!;
    expect(made).toMatchObject({ cards: 3, done: 1, open: 5 });
    expect(made.doc.split('\n').slice(2, 14)).toEqual([
      'Packing:',
      '',
      '```board',
      'To do: tent, maps',
      'Doing:',
      'Done: stove',
      '```',
      '',
      '- [ ] Tent ^tent',
      '- [x] Stove ^stove',
      '  bring the spare gas',
      '',
    ]);
    // The other lists are untouched.
    expect(made.doc).toContain('- Not this list\n');
    expect(made.doc).toContain('1. Post office\n2. Bank\n');
  });

  it('says what to change in the note as it was: the item lines, and the fence to put in above the list', () => {
    const made = boardFromList(doc, 4, 8)!;
    expect(made.lines).toEqual([
      { number: 4, text: '- [ ] Tent ^tent' },
      { number: 5, text: '- [x] Stove ^stove' },
      { number: 8, text: '- [ ] Maps ^maps' },
    ]);
    expect(made.fence).toEqual({ before: 4, text: '\n```board\nTo do: tent, maps\nDoing:\nDone: stove\n```\n\n' });
    // Applied that way round, the note is the one `doc` says.
    const lines = doc.split('\n');
    for (const line of made.lines) lines[line.number - 1] = line.text;
    lines[made.fence.before - 1] = `${made.fence.text}${lines[made.fence.before - 1]}`;
    expect(lines.join('\n')).toBe(made.doc);
  });

  it('can be done while the note has another board, and not twice to the same list', () => {
    const first = boardFromList(doc, 14, 15)!;
    // Straight under a heading, the board keeps a blank line from it.
    expect(first.open).toBe(15);
    expect(first.doc.split('\n').slice(12, 21)).toEqual(['## Errands', '', '```board', 'To do: post-office, bank', 'Doing:', 'Done:', '```', '', '1. Post office ^post-office']);
    expect(boardsIn(first.doc)).toHaveLength(1);
    const again = boardFromList(first.doc, 4, 8)!;
    expect(boardsIn(again.doc)).toHaveLength(2);
    // The list under the new board is already a board.
    const list = listAround(first.doc, 21)!;
    expect(list).toEqual({ from: 21, to: 22 });
    expect(boardFromList(first.doc, list.from, list.to)).toBeNull();
  });

  it('keeps anchors an item has, and makes nothing of lines with no items', () => {
    const made = boardFromList('- [ ] Tent ^mine\n- Stove', 1, 2)!;
    expect(made.doc).toBe('```board\nTo do: mine, stove\nDoing:\nDone:\n```\n\n- [ ] Tent ^mine\n- Stove ^stove');
    expect(made.lines).toEqual([{ number: 2, text: '- Stove ^stove' }]);
    expect(boardFromList(doc, 1, 3)).toBeNull();
  });
});

describe('choices and counters on a board', () => {
  it('reads a choice as an item with no box, its words after the choice\u2019s own', () => {
    expect(itemOnLine('- ( ) Pick the red one ^red')).toEqual({ id: 'red', text: 'Pick the red one', done: null, line: 0 });
    expect(itemOnLine('- (x) Pick the blue one ^blue')).toMatchObject({ text: 'Pick the blue one', done: null });
    // Only after a bullet, and only the exact box: a numbered line and a spaced box are words.
    expect(itemOnLine('1. ( ) Not a choice ^one')?.text).toBe('( ) Not a choice');
    expect(itemOnLine('- ( x ) Not a choice ^two')?.text).toBe('( x ) Not a choice');
    // A picked choice is not a done item: dragging it into Done does not touch its line.
    expect(setItemDone('- (x) Pick the blue one ^blue', false)).toBe('- (x) Pick the blue one ^blue');
  });

  it('makes a list of choices into cards named after their words', () => {
    const made = boardFrom('- ( ) Pick red\n- (x) Pick blue')!;
    expect(made.done).toBe(0);
    expect(made.doc.split('\n').slice(6)).toEqual(['- ( ) Pick red ^pick-red', '- (x) Pick blue ^pick-blue']);
  });

  it('finds an item whose counter was typed after its anchor, and keeps the counter with its words', () => {
    // Typed at the end of the line, the counter lands after the anchor.
    expect(itemOnLine('- [ ] Pack socks ^pack-socks [3/8]')).toMatchObject({ id: 'pack-socks', text: 'Pack socks [3/8]' });
    expect(itemOnLine('- [ ] Pack socks ^pack-socks [3/8] [notion](https://app.notion.com/p/x)')).toMatchObject({
      id: 'pack-socks',
      text: 'Pack socks [3/8] [notion](https://app.notion.com/p/x)',
    });
    expect(itemOnLine('- [ ] Pack socks [3/8] ^pack-socks')).toMatchObject({ id: 'pack-socks', text: 'Pack socks [3/8]' });
    // A link after the anchor is still not allowed: only marks and counters.
    expect(itemOnLine('- [ ] Pack ^pack [3/8](https://x.y)')).toBeNull();
  });

  it('leaves a counter out of an anchor it makes', () => {
    expect(anchorFor('Pack socks [3/8]', [])).toBe('pack-socks');
    expect(withAnchor('- [ ] Pack socks [3/8]', 'pack-socks')).toBe('- [ ] Pack socks [3/8] ^pack-socks');
  });
});

describe('lanes, by voice', () => {
  // Matt: "add voice commands and cues for adding to swimlanes on the board".
  const doc = [
    '# Launch',
    '',
    '```board height=18',
    'To do: ship-page',
    'In progress:',
    'Waiting on Sam: photos',
    'Done: pick-date',
    '```',
    '',
    '- [ ] Ship the pricing page ^ship-page',
    '- [ ] Get the photos back ^photos',
    '- [x] Pick a launch date ^pick-date',
    '- [ ] Email the beta list',
    '- A thought with no box',
    '',
    '```md',
    '- [ ] Fix the login button in an example',
    '```',
  ].join('\n');

  it('lists every board\u2019s lanes, with where each board opens', () => {
    expect(lanesOf(doc)).toEqual([
      { name: 'To do', board: 3, column: 0 },
      { name: 'In progress', board: 3, column: 1 },
      { name: 'Waiting on Sam', board: 3, column: 2 },
      { name: 'Done', board: 3, column: 3 },
    ]);
    expect(lanesOf('- [ ] No board here')).toEqual([]);
  });

  it('finds the lane a name says, however it is said', () => {
    const lanes = lanesOf(doc);
    const named = (spoken: string) => matchLane(spoken, lanes)?.lane.name ?? null;
    expect(named('todo')).toBe('To do');
    expect(named('the to-do column')).toBe('To do');
    expect(named('In Progress lane')).toBe('In progress');
    expect(named('waiting')).toBe('Waiting on Sam');
    expect(named('finished')).toBe('Done');
    expect(named('done swimlane')).toBe('Done');
    expect(named('groceries')).toBeNull();
    expect(matchLane('done', lanes)?.score).toBe(1);
  });

  it('adds a to-do to a lane: the line under the board\u2019s last item, the card at the top of the lane', () => {
    const lane = matchLane('in progress', lanesOf(doc))!.lane;
    const added = addToLane(doc, lane, 'Call Sam about the copy')!;
    expect(added.line).toBe('- [ ] Call Sam about the copy ^call-sam-about');
    const lines = added.body.split('\n');
    expect(lines.slice(2, 8)).toEqual(['```board height=18', 'To do: ship-page', 'In progress: call-sam-about', 'Waiting on Sam: photos', 'Done: pick-date', '```']);
    expect(lines[12]).toBe('- [ ] Call Sam about the copy ^call-sam-about');
    expect(addToLane(doc, lane, '  ')).toBeNull();
  });

  it('moves an item on the board to a lane, and ticks it going into Done', () => {
    const lanes = lanesOf(doc);
    const moved = moveToLane(doc, 'the pricing page', matchLane('done', lanes)!.lane)!;
    expect(moved.item).toEqual({ id: 'ship-page', text: 'Ship the pricing page', line: 10 });
    expect(moved.ticked).toBe(true);
    expect(moved.body).toContain('To do:\nIn progress:\nWaiting on Sam: photos\nDone: pick-date, ship-page\n');
    expect(moved.body).toContain('- [x] Ship the pricing page ^ship-page\n');
  });

  it('unticks an item taken out of Done, and leaves a box alone between other lanes', () => {
    const lanes = lanesOf(doc);
    const back = moveToLane(doc, 'launch date', matchLane('in progress', lanes)!.lane)!;
    expect(back.ticked).toBe(false);
    expect(back.body).toContain('- [ ] Pick a launch date ^pick-date');
    expect(back.body).toContain('In progress: pick-date\n');
    const across = moveToLane(doc, 'photos back', matchLane('to do', lanes)!.lane)!;
    expect(across.ticked).toBeNull();
    expect(across.body).toContain('To do: ship-page, photos\nIn progress:\nWaiting on Sam:\n');
  });

  it('names an item not yet on the board and puts it there, a box or none', () => {
    const lanes = lanesOf(doc);
    const email = moveToLane(doc, 'email beta list', matchLane('waiting', lanes)!.lane)!;
    expect(email.item).toMatchObject({ id: 'email-beta-list', line: 13 });
    expect(email.body).toContain('- [ ] Email the beta list ^email-beta-list\n');
    expect(email.body).toContain('Waiting on Sam: photos, email-beta-list\n');
    // An item with no box goes into Done without a tick, since there is nothing to tick.
    const thought = moveToLane(doc, 'a thought with no box', matchLane('done', lanes)!.lane)!;
    expect(thought.ticked).toBeNull();
    expect(thought.body).toContain('- A thought with no box ^thought-no-box\n');
  });

  it('finds nothing in a block of code, nothing for words that match no item, and nothing for a lane that is gone', () => {
    const lanes = lanesOf(doc);
    expect(moveToLane(doc, 'fix the login button', lanes[0]!)).toBeNull();
    expect(moveToLane(doc, 'water the plants', lanes[0]!)).toBeNull();
    const renamed = doc.replace('In progress:', 'Doing:');
    expect(moveToLane(renamed, 'pricing page', lanes[1]!)).toBeNull();
    expect(addToLane(renamed, lanes[1]!, 'Anything')).toBeNull();
  });
});

describe('a card whose anchor has slipped', () => {
  // Matt's board named `blur-bottom-swimlanes`, and the line had become `^blur-bottom-swimlaness`.
  const url = 'https://app.notion.com/p/the-blur-3de5';
  const doc = [
    '```board height=19',
    'To do: we-should-show, blur-bottom-swimlanes',
    'Done: switching',
    '```',
    '',
    '- [x] Switching workspaces scrolls smoothly ^switching',
    '- [ ] we should show the bookmark as a physical symbol ^we-should-show',
    `- [ ] the blur at the bottom of the swimlanes should be the wisp effect [notion](${url}) ^blur-bottom-swimlaness`,
  ].join('\n');

  it('shows the item it meant, when exactly one item no board names is a slip of it', () => {
    const board = boardsIn(doc)[0]!;
    const cards = cardsOf(board.columns, itemsIn(doc));
    expect(cards.map((card) => [card.id, card.item?.id ?? null])).toEqual([
      ['we-should-show', 'we-should-show'],
      ['blur-bottom-swimlanes', 'blur-bottom-swimlaness'],
      ['switching', 'switching'],
    ]);
    expect(cards[1]?.item?.text).toBe(`the blur at the bottom of the swimlanes should be the wisp effect [notion](${url})`);
  });

  it('takes nothing a board already names, nothing when two items could be it, and nothing for a short anchor', () => {
    const named = doc.replace('Done: switching', 'Done: switching, blur-bottom-swimlaness');
    const board = boardsIn(named)[0]!;
    expect(cardsOf(board.columns, itemsIn(named)).find((card) => card.id === 'blur-bottom-swimlanes')?.item).toBeNull();

    const twice = `${doc}\n- [ ] another ^blur-bottom-swimlanez`;
    expect(cardsOf(boardsIn(twice)[0]!.columns, itemsIn(twice))[1]?.item).toBeNull();

    const short = '```board\nTo do: abc\n```\n\n- [ ] Thing ^abcd';
    expect(cardsOf(boardsIn(short)[0]!.columns, itemsIn(short))[0]?.item).toBeNull();
  });

  it('counts one letter added, dropped or changed, or up to two more at the end, as a slip', () => {
    expect(nearAnchor('blur-bottom-swimlanes', 'blur-bottom-swimlaness')).toBe(true);
    expect(nearAnchor('ship-page', 'ship-pages-')).toBe(true);
    expect(nearAnchor('ship-page', 'shp-page')).toBe(true);
    expect(nearAnchor('ship-page', 'ship-paje')).toBe(true);
    expect(nearAnchor('ship-page', 'ship-page')).toBe(false);
    expect(nearAnchor('ship-page', 'ship-pages-now')).toBe(false);
    expect(nearAnchor('ship-page', 'shop-paje')).toBe(false);
  });
});

describe('ticking an item that is not a card', () => {
  const note = [
    '```board',
    'To do: milk, eggs',
    'Done:',
    '```',
    '',
    '- [ ] Milk ^milk',
    '- [ ] Eggs ^eggs',
    '- [ ] Bread',
    '',
    '## Later',
    '',
    '- [ ] Something else entirely',
    '',
  ].join('\n');

  it('puts it on its list\u2019s board, in Done, and names its line', () => {
    // From Matt's note: three ticked items had no anchor, so ticking them moved nothing while 57 others worked.
    const settled = settleTicks(note, new Map([[8, true]]));
    expect(settled.lines).toEqual([{ number: 8, anchor: 'bread' }]);
    expect(settled.fences[0]?.body).toBe('To do: milk, eggs\nDone: bread');
  });

  it('leaves a list that is not on a board alone', () => {
    // The item under a heading of its own belongs to no board: a board never has to hold every item in the note.
    expect(settleTicks(note, new Map([[12, true]]))).toEqual({ fences: [], lines: [] });
  });

  it('still just moves an item that is already a card', () => {
    const settled = settleTicks(note, new Map([[6, true]]));
    expect(settled.lines).toEqual([]);
    expect(settled.fences[0]?.body).toBe('To do: eggs\nDone: milk');
  });

  it('takes a batch, as a set of tasks arriving from Notion does', () => {
    const settled = settleTicks(note, new Map([[6, true], [8, true]]));
    expect(settled.lines).toEqual([{ number: 8, anchor: 'bread' }]);
    expect(settled.fences[0]?.body).toBe('To do: eggs\nDone: milk, bread');
  });

  it('does nothing for a box being cleared, or a line that is not an item', () => {
    expect(settleTicks(note, new Map([[8, false]]))).toEqual({ fences: [], lines: [] });
    expect(settleTicks(note, new Map([[10, true]]))).toEqual({ fences: [], lines: [] });
  });
});

describe('a card taken off the board', () => {
  it('goes from every lane and leaves the item where it is', () => {
    const doc = '```board\nTo do: milk, eggs\nDone:\n```\n\n- [ ] Milk ^milk\n- [ ] Eggs ^eggs\n';
    const columns = boardsIn(doc)[0]!.columns;
    expect(writeBoard(withoutCard(columns, 'milk'))).toBe('To do: eggs\nDone:');
    // An id the board does not have changes nothing.
    expect(writeBoard(withoutCard(columns, 'bread'))).toBe(writeBoard(columns));
    expect(itemsIn(doc).map((item) => item.id)).toEqual(['milk', 'eggs']);
  });
});

describe('the ticks and the lanes', () => {
  const note = ['```board', 'To do: milk, eggs, bread', 'Doing:', 'Done:', '```', '', '- [ ] Milk ^milk', '- [x] Eggs ^eggs', '- [x] Bread ^bread', ''].join('\n');

  it('writes the ticked cards where the board draws them: in Done', () => {
    expect(settleBoards(note)).toEqual([{ from: 1, to: 5, body: 'To do: milk\nDoing:\nDone: eggs, bread' }]);
  });

  it('moves a box being ticked, and takes a box being cleared out of Done', () => {
    expect(settleBoards(note, new Map([[7, true]]))[0]?.body).toBe('To do:\nDoing:\nDone: milk, eggs, bread');
    const settled = '```board\nTo do: milk\nDoing:\nDone: eggs, bread\n```\n\n- [ ] Milk ^milk\n- [x] Eggs ^eggs\n- [x] Bread ^bread\n';
    expect(settleBoards(settled, new Map([[8, false]]))[0]?.body).toBe('To do: milk, eggs\nDoing:\nDone: bread');
    // A batch, the way a set of tasks arrives from Notion at once.
    expect(
      settleBoards(
        settled,
        new Map([
          [8, false],
          [9, false],
        ]),
      )[0]?.body,
    ).toBe('To do: milk, eggs, bread\nDoing:\nDone:');
  });

  it('says nothing when there is nothing to move, and leaves a board with no Done lane alone', () => {
    const settled = '```board\nTo do: milk\nDone: eggs\n```\n\n- [ ] Milk ^milk\n- [x] Eggs ^eggs\n';
    expect(settleBoards(settled)).toEqual([]);
    expect(settleBoards('```board\nTo do: milk\nNext: eggs\n```\n\n- [ ] Milk ^milk\n- [x] Eggs ^eggs\n')).toEqual([]);
  });

  it('leaves the card a person has just moved where they put it', () => {
    const board = boardsIn(note)[0]!;
    const items = itemsIn(note);
    // Bread dragged into Doing: it stays there, and the other ticked card still settles into Done.
    const moved = putCard(board.columns, 'bread', 1);
    expect(writeBoard(settleColumns(moved, items, 'bread'))).toBe('To do: milk\nDoing: bread\nDone: eggs');
    expect(writeBoard(settleColumns(moved, items))).toBe('To do: milk\nDoing:\nDone: eggs, bread');
  });
});

describe('where an item\u2019s words end', () => {
  it('is before its mark, counters and anchor, so a caret there types on the words', () => {
    const url = 'https://app.notion.com/p/x';
    const line = `- [ ] Pack socks [3/8] [notion](${url}) ^pack-socks`;
    expect(line.slice(0, wordsEnd(line))).toBe('- [ ] Pack socks');
    expect(wordsEnd('- [ ] Ship it ^ship-it  ')).toBe('- [ ] Ship it'.length);
    expect(wordsEnd(`- [ ] Old order ^old [notion](${url})`)).toBe('- [ ] Old order'.length);
    // A superscript at the end is words, and so is a line that is not an item.
    expect(wordsEnd('- E = mc^2^')).toBe('- E = mc^2^'.length);
    expect(wordsEnd('Just words ^not-an-item')).toBe('Just words ^not-an-item'.length);
    // An item with no words yet: the caret goes after its box.
    expect(wordsEnd('- [ ] ^item')).toBe('- [ ] '.length);
  });

  it('is before the bookmark too, which no card, anchor or lane match says', () => {
    const url = 'https://app.notion.com/p/x';
    const line = `- [ ] Ship it §§ [notion](${url}) ^ship-it`;
    expect(line.slice(0, wordsEnd(line))).toBe('- [ ] Ship it');
    expect(wordsEnd('- [ ] §§')).toBe('- [ ] '.length);
    expect(itemOnLine(line)?.text).toBe(`Ship it [notion](${url})`);
    expect(itemWords('- [ ] Ship it §§ ^ship-it')).toBe('Ship it');
    expect(cardText('Ship it §§')).toBe('Ship it');
    expect(anchorFor('Ship the page §§', [])).toBe('ship-page');
    // Two section signs in the middle of words are words.
    expect(itemWords('- See §§12 ^see')).toBe('See §§12');
  });
});
