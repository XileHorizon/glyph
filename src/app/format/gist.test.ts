import { beforeEach, describe, expect, it } from 'vitest';
import { gistFor, gistStands, tidyGist } from './gist.ts';
import { bodyHash } from './formatter.ts';
import { keepGist } from './results.ts';

describe('the gist as a card line', () => {
  it('takes the first line, bare: no heading marks, bullets, quotes, bold or closing punctuation', () => {
    expect(tidyGist('# Call the plumber by Thursday.\n\nMore.')).toBe('Call the plumber by Thursday');
    expect(tidyGist('- "Pick up **eggs** and coffee!"\n')).toBe('Pick up eggs and coffee');
    expect(tidyGist('```\nPlans for the weekend\n```')).toBe('Plans for the weekend');
    expect(tidyGist('\n\n   Errands for tomorrow   \n')).toBe('Errands for tomorrow');
    expect(tidyGist('')).toBe('');
  });

  it('cuts a long answer at a word and says so', () => {
    const long = 'A very long line that goes on and on about the plumber and the tap and the eggs and the coffee and the cabin and the ferry';
    const cut = tidyGist(long);
    expect(cut.length).toBeLessThanOrEqual(91);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });
});

describe('what the home page shows', () => {
  beforeEach(() => localStorage.clear());

  it('shows a gist while it stands for the note: the same body, or one changed in a small way', () => {
    const body = 'things for tomorrow\n- milk and the good coffee from the corner shop\n- call the dentist before ten\n';
    keepGist('n1', { text: 'Plans for tomorrow', for: bodyHash(body), model: 'qwen3.5-2b', len: body.length, head: 'things for tomorrow' });
    expect(gistFor('n1', body)).toBe('Plans for tomorrow');
    // A fixed word: still stands.
    expect(gistFor('n1', body.replace('good coffee', 'nice coffee'))).toBe('Plans for tomorrow');
    // A new paragraph, or a new first line: a meaningful change, asked again.
    expect(gistFor('n1', `${body}\nAnd the whole plan for the weekend trip to the cabin with Sam.\n`)).toBeNull();
    expect(gistFor('n1', body.replace('things for tomorrow', 'plans for the week'))).toBeNull();
    expect(gistFor('n2', 'anything')).toBeNull();
  });

  it('asks again for a gist kept before lengths were recorded, unless the body is the same', () => {
    keepGist('n3', { text: 'Old', for: bodyHash('a note'), model: 'qwen3.5-2b' });
    expect(gistStands({ for: bodyHash('a note') }, 'n3', 'a note')).toBe(true);
    expect(gistStands({ for: bodyHash('a note') }, 'n3', 'a note!')).toBe(false);
  });
});
