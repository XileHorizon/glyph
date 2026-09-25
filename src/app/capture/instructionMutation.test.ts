import { beforeEach, describe, expect, it } from 'vitest';
import { applyCommandMutation, createNote, getNote, updateNote } from '../core/store.ts';
import { instructionCreateBody, literalMarkdown, previewSameNoteInstruction, resumeSameNoteCapture } from './instructionMutation.ts';

beforeEach(() => localStorage.clear());

const dangerous = [
  '# injected',
  '![alt](https://bad.example/image.png)',
  '[click](https://bad.example)',
  '**bold** and _emphasis_',
  '```js console.log(1) ```',
  '| column | value |',
];

describe('model text is serialized only as literal Markdown text', () => {
  it.each(dangerous)('escapes append payload %s', (payload) => {
    const preview = previewSameNoteInstruction('AttackFM\n\n## Bugs\n\n- Existing', '', payload, 'bugs');
    expect(preview.afterBody).toContain(literalMarkdown(payload));
    expect(preview.afterBody).not.toContain(`- ${payload.charAt(0).toUpperCase()}${payload.slice(1)}`);
  });

  it.each(dangerous)('escapes create payload %s', (payload) => {
    const body = instructionCreateBody('Safe note', payload);
    expect(body).toBe(`Safe note\n\n${literalMarkdown(payload)}`);
  });

  it('escapes a model-proposed create title too', () => {
    expect(instructionCreateBody('# injected', null)).toBe('\\# injected');
  });
});

describe('active capture inferred-append handoff', () => {
  it('preserves the command through a later segment and autosave without duplicating the earlier take', async () => {
    const baseBefore = 'AttackFM\n\n## Bugs\n\n- Existing';
    const continued = await createNote('attack', baseBefore, 'capture');
    const firstTake = 'Discussed the player state.';
    const preview = previewSameNoteInstruction(baseBefore, firstTake, 'losing playback position', 'bugs');

    // The current draft is flushed before confirmation, so its revision/body
    // are the exact CAS base rather than the stale note-list candidate.
    const flushed = await updateNote(continued.id, preview.beforeBody, continued.revision ?? 1);
    const applied = await applyCommandMutation({
      mutationId: 'active-capture-command',
      noteId: flushed.id,
      kind: 'append',
      beforeRevision: flushed.revision ?? 1,
      beforeBody: flushed.body,
      afterBody: preview.afterBody,
      source: 'capture',
    });
    expect(applied).toMatchObject({ status: 'applied' });

    // Capture continues after confirmation. Autosave composes from baseAfter,
    // not from the stale pre-command body or the full command result.
    const laterTake = `${firstTake}\n\nThen checked Android recovery.`;
    await updateNote(flushed.id, resumeSameNoteCapture(preview.baseAfter, laterTake), (await getNote(flushed.id))?.revision ?? 1);
    const stored = (await getNote(flushed.id))!;
    expect(stored.body).toContain('- Losing playback position');
    expect(stored.body).toContain('Then checked Android recovery.');
    expect(stored.body.match(/Discussed the player state\./g)).toHaveLength(1);
  });
});
