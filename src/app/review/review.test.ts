import { describe, expect, it } from 'vitest';
import { wordChanges } from './diff.ts';
import { applyFindings, locate, readArray, readFindings } from './findings.ts';
import { reviewMessage } from './prompt.ts';

describe('where the two speech models disagree', () => {
  it('finds the runs, ignoring case and punctuation, with context to place them', () => {
    const changes = wordChanges('Hey Ghost add a list item to the hello trade. Fix the seat bar.', 'Hey Ghost, add a list item to the HelloTrade. Fix the seek bar.');
    expect(changes.map((c) => [c.heard, c.careful])).toEqual([
      ['hello trade.', 'HelloTrade.'],
      ['seat', 'seek'],
    ]);
    expect(changes[1]).toMatchObject({ before: 'trade. Fix the', after: 'bar.' });
  });

  it('sees words one of them missed', () => {
    expect(wordChanges('call Sam today', 'call Sam about the cabin today').map((c) => [c.heard, c.careful])).toEqual([['', 'about the cabin']]);
    expect(wordChanges('same words here', 'Same words, here!')).toEqual([]);
  });
});

describe('the reviewing model’s findings', () => {
  const self = { id: 'n', title: 'Bug bash', body: '# Bug bash\n\n- [ ] Fix the seat bar\n- [ ] Downloads stuck\n' };
  const other = { id: 'h', title: 'HelloTrade', body: '# HelloTrade\n\n- Ship the APK\n' };

  it('digs the array out of a fenced or chatty answer', () => {
    expect(readArray('Here you go:\n```json\n[{"a": 1},]\n```')).toEqual([{ a: 1 }]);
    expect(readArray('No problems found.')).toEqual([]);
  });

  it('keeps findings that quote real text, and drops invented ones', () => {
    const answer = JSON.stringify([
      { check: 'words', what: 'Seek, not seat', why: 'The slower model heard seek.', find: 'Fix the seat bar', replace: 'Fix the seek bar' },
      { check: 'words', what: 'Invented', why: 'Not in the note.', find: 'Fix the login', replace: 'Fix the logout' },
      { check: 'commands', what: 'Item went here', why: 'It was for HelloTrade.', note: 'hello trade', add: '- Update the readme' },
      { check: 'style', what: 'Nope', why: '', find: 'Bug bash', replace: 'Bugbash' },
      { check: 'names', what: 'Same', why: '', find: 'Downloads stuck', replace: 'Downloads stuck' },
    ]);
    const findings = readFindings(answer, self, [other]);
    expect(findings.map((f) => [f.check, f.noteTitle, f.change.kind])).toEqual([
      ['words', 'Bug bash', 'replace'],
      ['commands', 'HelloTrade', 'add'],
    ]);
  });

  it('changes the words just said when a note has them twice', () => {
    const twice = { id: 'n', title: 'Bug bash', body: 'Fix the seat bar.\n\nFix the seat bar.\n' };
    const findings = readFindings(JSON.stringify([{ check: 'words', what: 'Seek', why: '', find: 'seat bar', replace: 'seek bar' }]), twice, []);
    expect(applyFindings([twice], findings).get('n')).toBe('Fix the seat bar.\n\nFix the seek bar.\n');
  });

  it('forgives whitespace and case when finding the text', () => {
    expect(locate('Fix  the Seat bar', 'fix the seat bar')).toBe('Fix  the Seat bar');
  });

  it('applies accepted findings to the notes they name', () => {
    const findings = readFindings(
      JSON.stringify([
        { check: 'words', what: 'Seek', why: '', find: 'seat bar', replace: 'seek bar' },
        { check: 'commands', what: 'Readme', why: '', note: 'HelloTrade', add: '- Update the readme' },
      ]),
      self,
      [other],
    );
    const changed = applyFindings([self, other], findings);
    expect(changed.get('n')).toContain('- [ ] Fix the seek bar');
    expect(changed.get('h')).toBe('# HelloTrade\n\n- Ship the APK\n- Update the readme\n');
  });
});

describe('what the reviewing model is shown', () => {
  it('labels every piece and puts the note last', () => {
    const message = reviewMessage({
      title: 'Bug bash',
      body: '# Bug bash',
      heard: 'fix the seat bar',
      careful: 'fix the seek bar',
      changes: [{ heard: 'seat', careful: 'seek', before: 'fix the', after: 'bar' }],
      commands: ['Added “Fix the seek bar” to HelloTrade’s list'],
      titles: ['HelloTrade', 'Bug bash'],
      touched: [],
    });
    expect(message).toMatch(/^WHAT THE FAST SPEECH MODEL HEARD:/);
    expect(message).toContain('- …fix the [seat → seek] bar…');
    expect(message.trim().endsWith('# Bug bash')).toBe(true);
  });
});
