import { describe, expect, it, vi } from 'vitest';
import { classifyFinalTranscript } from './finalInstruction.ts';
import { placeWords } from './listAppend.ts';
import type { StepResult, VoiceStep } from './voicePlan.ts';

const notes = [
  { id: 'go', title: 'Go', note: { body: '# Go\n' } },
  { id: 'todo', title: 'To-Do', note: { body: 'To-Do' } },
  { id: 'movies', title: 'Movies', note: { body: 'Movies\n\n- Jaws\n' } },
  { id: 'groceries', title: 'Groceries', note: { body: 'Groceries\n\n- Eggs\n' } },
];

/** A model that answers the sort with `sort` and the plan with `plan`; unavailable when not given. */
function model(sort?: string, plan?: unknown) {
  return vi.fn<VoiceStep>(async (stage): Promise<StepResult> => {
    if (stage === 'sort') return sort ? { status: 'answer', answer: { kind: sort }, raw: JSON.stringify({ kind: sort }), model: 'test' } : { status: 'unavailable', reason: 'no model' };
    return plan ? { status: 'answer', answer: plan, raw: JSON.stringify(plan), model: 'test' } : { status: 'unavailable', reason: 'no model' };
  });
}
const none = () => model();
const append = (note: string, items: string[], as = 'list') => ({ do: 'append', note, items, text: null, as });

describe('the rules: instant for the phrasings they know', () => {
  const places = ['Parkersburg, West Virginia', 'Marietta, Ohio', 'Balitmore, Maryland', 'Detroit, Michigan'];

  it.each([
    'add to my note labeled go a list with parkersburg west virginia marietta ohio balitmore maryland and detroit michigan',
    'Add to my note labeled Go, a list with Parkersburg, West Virginia, Marietta, Ohio, Balitmore, Maryland and Detroit, Michigan.',
    'Hey Ghost, add to my note labeled Go a list with Parkersburg West Virginia, Marietta Ohio, Balitmore Maryland and Detroit Michigan.',
  ])('offers the list for Go without the model: %s', async (words) => {
    const step = none();
    const read = await classifyFinalTranscript(words, notes, step);
    expect(read).toMatchObject({ kind: 'offer', conversational: false, actions: [{ do: 'append', note: { id: 'go' }, placement: { how: 'item', items: places } }] });
    expect(step).not.toHaveBeenCalled();
    if (read.kind !== 'offer' || read.actions[0]?.do !== 'append') throw new Error('no append');
    expect(placeWords('# Go\n', read.actions[0].text, read.actions[0].placement).body).toBe(`# Go\n\n${places.map((place) => `- ${place}`).join('\n')}\n`);
  });

  it('makes a titled list with its items', async () => {
    await expect(
      classifyFinalTranscript('make a new list called comic books and add to the list Spider-Man, Batman, Superman, the Fantastic Four and the Green Lantern.', notes, none()),
    ).resolves.toMatchObject({ kind: 'offer', actions: [{ do: 'create', title: 'comic books', items: ['Spider-Man', 'Batman', 'Superman', 'the Fantastic Four', 'the Green Lantern'] }] });
  });

  it('does not take “list?” after the note’s name, or an echo at the end, for items', async () => {
    await expect(classifyFinalTranscript('Can you add to my groceries list? Cauliflower, carrots and bread.', notes, none())).resolves.toMatchObject({
      kind: 'offer',
      actions: [{ do: 'append', note: { id: 'groceries' }, placement: { items: ['Cauliflower', 'carrots', 'bread'] } }],
    });
    await expect(classifyFinalTranscript('Add to Go list? Detroit, Michigan and Marietta, Ohio. Go. Go.', notes, none())).resolves.toMatchObject({
      kind: 'offer',
      actions: [{ do: 'append', note: { id: 'go' }, placement: { items: ['Detroit, Michigan', 'Marietta, Ohio'] } }],
    });
  });

  it('finds a request inside talk', async () => {
    await expect(
      classifyFinalTranscript('So I was at the store earlier and it was packed. Anyway, can you put oat milk and bread on the groceries list?', notes, none()),
    ).resolves.toMatchObject({ kind: 'offer', conversational: true, actions: [{ do: 'append', note: { id: 'groceries' }, placement: { items: ['oat milk', 'bread'] } }] });
  });
});

describe('the model: sort, then plan', () => {
  it('asks the model when the rules do not know the phrasing, and takes its items as a real list', async () => {
    const step = model('new', { actions: [{ do: 'create', title: 'Comic Books', items: ['Spider-Man', 'Batman', 'The Fantastic Four'], as: 'list' }], note: null });
    const said = 'Okay so I was reading last night and honestly I could use something to keep track of comic books, spider man batman the fantastic four';
    await expect(classifyFinalTranscript(said, notes, step)).resolves.toMatchObject({
      kind: 'offer',
      actions: [{ do: 'create', title: 'Comic Books', items: ['Spider-Man', 'Batman', 'The Fantastic Four'] }],
    });
    expect(step).toHaveBeenNthCalledWith(1, 'sort', null, said, ['Go', 'To-Do', 'Movies', 'Groceries']);
    expect(step).toHaveBeenNthCalledWith(2, 'plan', 'new', said, ['Go', 'To-Do', 'Movies', 'Groceries']);
  });

  it('carries several changes and keeps the rest as a note', async () => {
    const step = model('mixed', {
      actions: [append('Movies', ['Heat', 'Alien']), append('Groceries', ['coffee'])],
      note: 'Meeting went long today. Sam wants the report by Friday.',
    });
    const said = 'Meeting went long today, Sam wants the report by Friday. Oh and throw Heat and Alien in movies, and coffee in groceries.';
    const read = await classifyFinalTranscript(said, notes, step);
    expect(read).toMatchObject({
      kind: 'offer',
      actions: [
        { do: 'append', note: { id: 'movies' }, placement: { how: 'item', items: ['Heat', 'Alien'] } },
        { do: 'append', note: { id: 'groceries' }, placement: { items: ['coffee'] } },
      ],
      note: 'Meeting went long today. Sam wants the report by Friday.',
    });
  });

  it('drops what was never said, and a note that does not exist', async () => {
    const step = model('add', { actions: [append('Movies', ['Heat', 'Superman III']), append('Camping', ['tent'])], note: null });
    const read = await classifyFinalTranscript('I watched stuff, go ahead and throw Heat into movies and a tent on camping', notes, step);
    expect(read).toMatchObject({ kind: 'offer', actions: [{ do: 'append', note: { id: 'movies' }, placement: { items: ['Heat'] } }] });
    if (read.kind === 'offer') expect(read.actions).toHaveLength(1);
  });

  it('leaves dictation as a note when the model sorts it as one', async () => {
    const step = model('note');
    await expect(classifyFinalTranscript('I need to make dinner and then maybe start on the photo album.', notes, step)).resolves.toMatchObject({ kind: 'ordinary', notice: null });
    expect(step).toHaveBeenCalledOnce();
  });

  it('spends no model time on dictation with no request words', async () => {
    const step = model('add');
    await expect(classifyFinalTranscript('It was a long day and the weather was great.', notes, step)).resolves.toMatchObject({ kind: 'ordinary', notice: null });
    expect(step).not.toHaveBeenCalled();
  });

  it('never loses a conversational recording: no model, or nothing usable, keeps it as a note', async () => {
    await expect(classifyFinalTranscript('So yeah, maybe throw something on a list somewhere.', notes, none())).resolves.toMatchObject({ kind: 'ordinary' });
    const empty = model('add', { actions: [append('Camping', ['tent'])], note: null });
    await expect(classifyFinalTranscript('Before I forget, can you add a tent to the camping list?', notes, empty)).resolves.toMatchObject({
      kind: 'ordinary',
      notice: expect.stringMatching(/Saved this recording as a note/),
    });
  });

  it('rejects a command the recording began with when its note does not exist', async () => {
    await expect(classifyFinalTranscript('add to the note labeled Missing buy milk', notes, none())).resolves.toMatchObject({ kind: 'rejected' });
  });

  it('keeps reported speech as a note', async () => {
    await expect(classifyFinalTranscript('I told Sam, “add to the note labeled Go pack sunscreen,” but I have not done it.', notes, model('note'))).resolves.toMatchObject({ kind: 'ordinary' });
  });

  it('refuses destructive requests without asking the model to plan, and keeps the recording', async () => {
    const step = vi.fn<VoiceStep>(async () => ({ status: 'refused', reason: 'Deleting notes by voice is not supported.' }));
    await expect(classifyFinalTranscript('delete everything on my groceries list', notes, step)).resolves.toMatchObject({
      kind: 'ordinary',
      notice: expect.stringMatching(/not supported\. Saved this recording as a note/),
    });
    expect(step).toHaveBeenCalledOnce();
  });
});

describe('the voice log', () => {
  it('writes each step and the decision', async () => {
    const lines: string[] = [];
    let decided = '';
    const trace = { at: 1, step: (line: string) => lines.push(line), decide: (outcome: string) => (decided = outcome) };
    await classifyFinalTranscript('go ahead and throw Heat into movies', notes, model('add', { actions: [append('Movies', ['Heat'])], note: null }), trace);
    expect(lines.join('\n')).toMatch(/sort \(test\): \{"kind":"add"\}/);
    expect(lines.join('\n')).toMatch(/plan \(test\):/);
    expect(decided).toMatch(/offer: add to Movies/);
  });
});
