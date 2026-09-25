import { beforeEach, describe, expect, it } from 'vitest';
import { applyCommandMutation, listNotes, newNoteId, noteTitle } from '../core/store.ts';
import { isStandaloneCommandLike, planCommand } from './command.ts';
import { instructionCreateBody, listTitle } from './instructionMutation.ts';
import { placeWords } from './listAppend.ts';

beforeEach(() => localStorage.clear());

/** Test driver for the same deterministic preview + confirmed CAS path as CaptureScreen. */
async function confirmedStandaloneSpeak(utterance: string): Promise<void> {
  expect(isStandaloneCommandLike(utterance)).toBe(true);
  const notes = (await listNotes()).map((note) => ({ id: note.id, title: noteTitle(note.body), note }));
  const plan = planCommand(utterance, { notes });
  expect(plan, utterance).not.toBeNull();
  if (!plan) return;
  if (plan.kind === 'create-list') {
    const title = listTitle(plan.title);
    const id = newNoteId();
    expect(await applyCommandMutation({ mutationId: newNoteId(), noteId: id, kind: 'create', beforeRevision: null, beforeBody: null, afterBody: instructionCreateBody(title, null), source: 'capture' })).toMatchObject({ status: 'applied' });
    return;
  }
  expect(plan.kind).toBe('place');
  if (plan.kind !== 'place') return;
  const preview = placeWords(plan.note.note.body, plan.text, plan);
  expect(await applyCommandMutation({ mutationId: newNoteId(), noteId: plan.note.id, kind: 'append', beforeRevision: plan.note.note.revision ?? 1, beforeBody: plan.note.note.body, afterBody: preview.body, source: 'capture' })).toMatchObject({ status: 'applied' });
}

describe('Kevin’s four standalone Speak sessions', () => {
  it('creates two notes, appends five separate groceries, and never memo-saves command prose or End', async () => {
    await confirmedStandaloneSpeak('make a new list called groceries');
    await confirmedStandaloneSpeak('add to the grocery list that I need eggs milk bread');
    await confirmedStandaloneSpeak('add to the grocery list that I need apples and oranges');
    await confirmedStandaloneSpeak('I need a new list called to do. End.');

    const notes = await listNotes();
    expect(notes).toHaveLength(2);
    const groceries = notes.find((note) => noteTitle(note.body) === 'Groceries');
    const todo = notes.find((note) => noteTitle(note.body) === 'To Do');
    expect(groceries?.body).toBe('Groceries\n\n- Eggs\n- Milk\n- Bread\n- Apples\n- Oranges\n');
    expect(todo?.body).toBe('To Do');
    for (const note of notes) {
      expect(note.body).not.toMatch(/make a new|add to the grocery|I need a new list|\bEnd\b/i);
    }
  });

  it('routes the requested full utterance to To-Do and leaves ordinary prose as a memo', async () => {
    const todoId = newNoteId();
    await applyCommandMutation({ mutationId: newNoteId(), noteId: todoId, kind: 'create', beforeRevision: null, beforeBody: null, afterBody: 'To-Do', source: 'editor' });

    await confirmedStandaloneSpeak('add to the to do list wash dishes, take out trash, and fold clothes');
    const todo = (await listNotes()).find((note) => note.id === todoId);
    expect(todo?.body).toBe('To-Do\n\n- [ ] Wash dishes\n- [ ] Take out trash\n- [ ] Fold clothes\n');

    const notes = (await listNotes()).map((note) => ({ id: note.id, title: noteTitle(note.body), note }));
    const prose = 'my thoughts about the new iPhone, I like the folding display and want to add more later';
    expect(isStandaloneCommandLike(prose)).toBe(false);
    expect(planCommand(prose, { notes })).toBeNull();
  });

  it('does not silently correct an unsafe ASR title or mutate it through a grocery reference', async () => {
    await confirmedStandaloneSpeak('make a new list called Brofries');
    const notes = (await listNotes()).map((note) => ({ id: note.id, title: noteTitle(note.body), note }));
    expect(notes[0]?.title).toBe('Brofries');
    expect(planCommand('add to the grocery list that I need eggs', { notes })).toEqual({ kind: 'no-note', name: 'grocery' });
  });
});
