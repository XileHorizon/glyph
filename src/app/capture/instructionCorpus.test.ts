import { beforeEach, describe, expect, it } from 'vitest';
import { applyCommandMutation, createNote, listNotes } from '../core/store.ts';
import { findKeyword, planCommand } from './command.ts';
import corpus from './instructionCorpus.json';
import { interpretWakeCommand, type InferenceResult, type InferenceRun } from './instructionIntent.ts';
import { instructionCreateBody, literalMarkdown } from './instructionMutation.ts';
import { placeInstruction } from './listAppend.ts';

const seed = async () => {
  const attack = await createNote('attack', 'AttackFM\n\n## Bugs\n\n- Existing\n\n## Ideas\n\n- Later', 'editor');
  const weekendA = await createNote('weekend-a', 'Weekend trip', 'editor');
  const weekendB = await createNote('weekend-b', 'Weekend plans', 'editor');
  return [attack, weekendA, weekendB].map((note) => ({ id: note.id, title: note.body.split('\n')[0]!, note }));
};

const fixtures: Record<string, InferenceResult> = {
  'attackfm-messy': { status: 'intent', model: 'fixture', intent: { action: 'append', target: 'Attack FM', content: 'the playback position gets lost', placement: 'bugs' } },
  'create-clean': { status: 'intent', model: 'fixture', intent: { action: 'create', target: 'apartment stuff', content: null } },
  'create-with-body': { status: 'intent', model: 'fixture', intent: { action: 'create', target: 'apartment stuff', content: 'call the landlord at 5' } },
  ambiguous: { status: 'intent', model: 'fixture', intent: { action: 'append', target: 'Weekend', content: 'book the hotel', placement: 'tasks' } },
  missing: { status: 'intent', model: 'fixture', intent: { action: 'append', target: 'Groceries', content: 'milk', placement: 'list' } },
  destructive: { status: 'intent', model: 'fixture', intent: { action: 'none', reason: 'destructive' } },
  compound: { status: 'intent', model: 'fixture', intent: { action: 'none', reason: 'compound' } },
  'quoted-numeric': { status: 'intent', model: 'fixture', intent: { action: 'append', target: 'Attack FM', content: 'the player saying "error 404" at 42 percent', placement: 'bugs' } },
};

const inferred = (result: InferenceResult): InferenceRun => ({ done: Promise.resolve(result), cancel: () => undefined });

beforeEach(() => localStorage.clear());

describe('repeatable instruction evaluation corpus', () => {
  it('evaluates expected action, target, content, placement, and rejection for every case', async () => {
    const required = ['attackfm-clean', 'attackfm-messy', 'create-clean', 'create-with-body', 'ambiguous', 'missing', 'destructive', 'compound', 'quoted-numeric', 'ordinary-memo'];
    expect(corpus.map((item) => item.id)).toEqual(required);

    for (const item of corpus) {
      localStorage.clear();
      const notes = await seed();
      const before = (await listNotes()).map((note) => ({ id: note.id, body: note.body }));
      if (item.expected.action === 'memo') {
        expect(item.wakeWord).toBe(false);
        expect(findKeyword(item.utterance)).toBeNull();
        expect(planCommand(item.utterance, { notes })).toBeNull();
        expect((await listNotes()).map((note) => ({ id: note.id, body: note.body }))).toEqual(before);
        continue;
      }

      const deterministic = planCommand(item.utterance, { notes });
      if (!deterministic) expect(fixtures[item.id], `missing model fixture for ${item.id}`).toBeDefined();
      const read = await interpretWakeCommand(item.utterance, { notes }, () => inferred(fixtures[item.id]!)).done;
      if (item.expected.action === 'none') {
        expect(read.source, item.id).toBe('rejected');
        expect((await listNotes()).map((note) => ({ id: note.id, body: note.body })), item.id).toEqual(before);
        continue;
      }

      if (read.source === 'deterministic') {
        if (item.expected.action === 'create') {
          expect(read.plan).toEqual({ kind: 'create-list', title: item.expected.target });
        } else {
          expect(read.plan).toMatchObject({ kind: 'place', note: { title: item.expected.target }, text: item.expected.content });
          expect(read.plan.kind === 'place' ? read.plan.near : null).toBe(item.expected.placement);
        }
        continue;
      }

      expect(read.source, item.id).toBe('inferred');
      if (read.source !== 'inferred') continue;
      expect(read.intent.action, item.id).toBe(item.expected.action);
      if (read.intent.action === 'create') expect(read.intent.target, item.id).toBe(item.expected.target);
      expect(read.intent.content, item.id).toBe(item.expected.content);
      if (read.intent.action === 'append' && 'note' in read) {
        expect(read.note.title).toBe(item.expected.target);
        expect(read.intent.placement).toBe(item.expected.placement);
        const preview = placeInstruction(read.note.note.body, literalMarkdown(read.intent.content), read.intent.placement);
        const applied = await applyCommandMutation({ mutationId: `m-${item.id}`, noteId: read.note.id, kind: 'append', beforeRevision: read.note.note.revision ?? 1, beforeBody: read.note.note.body, afterBody: preview.body, source: 'capture' });
        expect(applied.status).toBe('applied');
      } else if (read.intent.action === 'create') {
        const body = instructionCreateBody(read.intent.target, read.intent.content);
        const applied = await applyCommandMutation({ mutationId: `m-${item.id}`, noteId: `n-${item.id}`, kind: 'create', beforeRevision: null, beforeBody: null, afterBody: body, source: 'capture' });
        expect(applied.status).toBe('applied');
      }
    }
  });

  it('keeps the fixture harness honest: invalid or unavailable output cannot mutate', async () => {
    const notes = await seed();
    const before = await listNotes();
    for (const result of [
      { status: 'unavailable', reason: 'model missing' } as InferenceResult,
      { status: 'intent', model: 'fixture', intent: { action: 'none', reason: 'unclear' } } as InferenceResult,
    ]) {
      const read = await interpretWakeCommand('log something against Attack FM', { notes }, () => inferred(result)).done;
      expect(read.source).toBe('rejected');
    }
    expect(await listNotes()).toEqual(before);
  });
});
