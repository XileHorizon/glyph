import { describe, expect, it, vi } from 'vitest';
import { interpretWakeCommand, validateInference, type InferenceRun } from './instructionIntent.ts';
import { placeInstruction, placeWords } from './listAppend.ts';

const notes = [
  { id: 'attack', title: 'AttackFM', note: { body: '# AttackFM' } },
  { id: 'weekend-a', title: 'Weekend trip', note: { body: 'Weekend trip' } },
  { id: 'weekend-b', title: 'Weekend plans', note: { body: 'Weekend plans' } },
];

const inferred = (value: unknown): InferenceRun => ({
  done: Promise.resolve(value as Awaited<InferenceRun['done']>),
  cancel: vi.fn(),
});

describe('instruction inference contract', () => {
  it('strictly validates all fields and rejects malformed IPC values', () => {
    expect(
      validateInference({
        status: 'intent',
        model: 'qwen3.5-2b',
        intent: { action: 'append', target: 'Attack FM', content: 'losing position at 42%', placement: 'bugs' },
      }),
    ).toMatchObject({ status: 'intent', intent: { action: 'append', target: 'Attack FM' } });
    expect(validateInference({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'create', target: '', content: null } })).toBeNull();
    expect(validateInference({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'append', target: 'AttackFM', content: 'x', placement: 'bugs', id: 'attack' } })).toBeNull();
    expect(validateInference({ status: 'unavailable', reason: '' })).toBeNull();
    expect(validateInference('{"status":"intent"}')).toBeNull();
    for (const content of ['bad\nheading', 'bad\ttable', `bad${String.fromCharCode(0)}value`]) {
      expect(validateInference({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'append', target: 'AttackFM', content, placement: 'bugs' } })).toBeNull();
      expect(validateInference({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'create', target: 'Safe', content } })).toBeNull();
    }
  });

  it('gives the deterministic parser absolute precedence', async () => {
    const fallback = vi.fn(() => inferred({ status: 'unavailable', reason: 'must not run' }));
    const run = interpretWakeCommand('Put a bug about losing playback position in Attack FM', { notes }, fallback);
    const read = await run.done;
    // "a bug about" is the kind of thing, not the thing: OBJECT_NOUN consumes it
    // and routes the phrase to bug placement, matching instructionCorpus attackfm-clean.
    expect(read).toMatchObject({ source: 'deterministic', plan: { kind: 'place', note: { id: 'attack' }, text: 'losing playback position' } });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses inference only on parser miss, then resolves the title deterministically', async () => {
    const fallback = vi.fn(() =>
      inferred({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'append', target: 'Attack FM', content: 'losing playback position', placement: 'bugs' } }),
    );
    const read = await interpretWakeCommand('log losing playback position as a bug against Attack FM', { notes }, fallback).done;
    expect(fallback).toHaveBeenCalledOnce();
    expect(read).toMatchObject({ source: 'inferred', note: { id: 'attack' }, intent: { placement: 'bugs' } });
  });

  it('uses application-owned list semantics for generic deterministic phrases', async () => {
    const targets = [
      { id: 'groceries', title: 'Groceries', note: { body: 'Groceries' } },
      { id: 'todo', title: 'To Do', note: { body: 'To Do' } },
    ];
    const groceries = await interpretWakeCommand('add eggs to groceries', { notes: targets }).done;
    const todo = await interpretWakeCommand('add call Sam to to do', { notes: targets }).done;

    expect(groceries).toMatchObject({ source: 'deterministic', plan: { kind: 'place' } });
    expect(todo).toMatchObject({ source: 'deterministic', plan: { kind: 'place' } });
    if (groceries.source === 'deterministic' && groceries.plan.kind === 'place' && todo.source === 'deterministic' && todo.plan.kind === 'place') {
      expect(placeWords(groceries.plan.note.note.body, groceries.plan.text, groceries.plan).body).toBe('Groceries\n\n- Eggs\n');
      expect(placeWords(todo.plan.note.note.body, todo.plan.text, todo.plan).body).toBe('To Do\n\n- [ ] Call Sam\n');
    }
  });

  it('uses the same policy when inferred placement is unspecified', () => {
    expect(placeInstruction('Groceries', 'eggs', null).body).toBe('Groceries\n\n- Eggs\n');
    expect(placeInstruction('To Do', 'call Sam', null).body).toBe('To Do\n\n- [ ] Call Sam\n');
  });

  it('rejects ambiguous and unavailable results without an action', async () => {
    const ambiguous = await interpretWakeCommand('record book the hotel under weekend', { notes }, () =>
      inferred({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'append', target: 'weekend', content: 'book it', placement: 'tasks' } }),
    ).done;
    expect(ambiguous).toMatchObject({ source: 'rejected' });

    const unavailable = await interpretWakeCommand('make a note named apartment stuff', { notes }, () =>
      inferred({ status: 'unavailable', reason: 'No compatible installed model.' }),
    ).done;
    expect(unavailable).toEqual({ source: 'rejected', reason: 'No compatible installed model.' });
  });

  it('starts each inference with only that Speak session’s current utterance', async () => {
    const prompts: string[] = [];
    const fallback = (words: string): InferenceRun => {
      prompts.push(words);
      return inferred({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'create', target: words, content: null } });
    };

    await interpretWakeCommand('first session Brofries', { notes }, fallback).done;
    await interpretWakeCommand('second session groceries', { notes }, fallback).done;

    expect(prompts).toEqual(['first session Brofries', 'second session groceries']);
    expect(prompts[1]).not.toContain('Brofries');
  });

  it('accepts create title and optional body but no ids or Markdown decisions', async () => {
    const read = await interpretWakeCommand('make a new note called apartment stuff', { notes }, () =>
      inferred({ status: 'intent', model: 'qwen3.5-2b', intent: { action: 'create', target: 'apartment stuff', content: 'call landlord at 5' } }),
    ).done;
    expect(read).toEqual({ source: 'inferred', intent: { action: 'create', target: 'apartment stuff', content: 'call landlord at 5' } });
  });
});
