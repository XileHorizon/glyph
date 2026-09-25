import { describe, expect, it, vi } from 'vitest';
import { placeWords } from './listAppend.ts';
import { Take, type Offer, type TakeHost } from './take.ts';
import { classifyFinalTranscript } from './finalInstruction.ts';

type TestNote = { id: string; body: string };

function harness() {
  const todo: TestNote = { id: 'todo', body: 'To-Do' };
  const notes = [{ id: todo.id, title: 'To-Do', note: todo }];
  let offered: Offer<TestNote> | null = null;
  const addItems = vi.fn((note: TestNote, spoken: string, placement: Parameters<typeof placeWords>[2]) => {
    note.body = placeWords(note.body, spoken, placement).body;
  });
  const host: TakeHost<TestNote> = {
    notes: () => notes,
    target: () => null,
    commandWord: () => true,
    instructionCommands: () => true,
    voiceCommands: () => [],
    itemTargets: () => [],
    route: () => undefined,
    offer: (next) => { offered = next; },
    table: () => undefined,
    itemWords: () => undefined,
    haptic: () => undefined,
    changed: () => undefined,
    addItems,
    changeNote: () => undefined,
    addTable: () => undefined,
    moveTo: () => undefined,
    carryOn: () => undefined,
    newNote: () => undefined,
    undo: () => null,
    runPlugin: () => null,
    describePlugin: () => ({ title: '', action: '' }),
    clip: () => '',
    log: () => undefined,
    said: () => undefined,
  };
  const take = new Take(host);
  return { take, todo, addItems, offered: () => offered };
}

describe('instruction-aware final capture utterances', () => {
  it('listens through every phrase, then offers and confirms a final To-Do append', async () => {
    const { take, todo, addItems, offered } = harness();
    take.listen({ text: 'add to the to do', startMs: 0, endMs: 1200 });
    take.listen({ text: 'list wash dishes, take out trash, and fold clothes', startMs: 1200, endMs: 4200 });

    expect(take.segments.map((segment) => segment.text)).toEqual(['add to the to do', 'list wash dishes, take out trash, and fold clothes']);
    expect(offered()).toBeNull();

    const read = await classifyFinalTranscript(take.segments.map((segment) => segment.text).join(' '), [{ id: 'todo', title: 'To-Do', note: todo }]);
    expect(read).toMatchObject({ kind: 'offer', actions: [{ do: 'append', note: { id: 'todo' } }] });
    if (read.kind !== 'offer' || read.actions[0]?.do !== 'append') throw new Error('expected an append offer');
    take.offerChanges({ heading: 'Add to To-Do', action: 'Add', lines: [], detail: null }, 5000);
    expect(take.segments).toEqual([]);
    expect(offered()).toMatchObject({ kind: 'plan', heading: 'Add to To-Do' });
    // Confirming a finished recording's changes is the recorder's to carry out (CaptureScreen `runFinalActions`).
    take.confirm(5100);
    expect(addItems).not.toHaveBeenCalled();
    const append = read.actions[0];
    todo.body = placeWords(todo.body, append.text, append.placement).body;
    expect(todo.body).toBe('To-Do\n\n- [ ] Wash dishes\n- [ ] Take out trash\n- [ ] Fold clothes\n');
  });

  it.each([
    'my thoughts about the new iPhone, I like the folding display and want to add more later',
    'I told Sam to add wash dishes to the to do list when he gets home',
    'The phrase create a list appears in this ordinary explanation',
  ])('keeps near-miss prose as an ordinary new note: %s', async (utterance) => {
    const { take, offered } = harness();
    take.listen({ text: utterance, startMs: 0, endMs: 3000 });
    expect(offered()).toBeNull();
    await expect(classifyFinalTranscript(utterance, [{ id: 'todo', title: 'To-Do', note: { body: 'To-Do' } }])).resolves.toMatchObject({ kind: 'ordinary' });
    expect(take.segments.map((segment) => segment.text)).toEqual([utterance]);
  });
});
