import { describe, expect, it } from 'vitest';
import { asIssue, isIssueUrl, issueAt, issueBrief, issueFields, issueState } from './issues.ts';
import { detailsFromRaw, issueKey } from './details.ts';
import { githubPlugin } from './index.tsx';
import { linkedLine, unsentItems } from '../../core/itemLinks.ts';

const raw = {
  number: 12,
  title: 'Ship the pricing page',
  html_url: 'https://github.com/glyph/app/issues/12',
  state: 'open',
  updated_at: '2026-09-15T10:00:00Z',
  labels: [{ name: 'bug' }, 'chore'],
  assignees: [{ login: 'matt' }],
  milestone: { title: '1.5' },
};

describe('an issue’s address', () => {
  it('finds the repo and number, and ignores anything else on github.com', () => {
    expect(issueAt('https://github.com/glyph/app/issues/12')).toEqual({ owner: 'glyph', repo: 'app', number: 12 });
    expect(issueAt('https://github.com/glyph/app/issues/12#issuecomment-99')).toEqual({ owner: 'glyph', repo: 'app', number: 12 });
    expect(issueAt('https://github.com/glyph/app/pull/12')).toBeNull();
    expect(issueAt('https://github.com/glyph/app')).toBeNull();
    expect(issueAt('https://notgithub.com/glyph/app/issues/12')).toBeNull();
    expect(issueAt('not a url')).toBeNull();
    expect(isIssueUrl('https://github.com/glyph/app/issues/3')).toBe(true);
  });

  it('keys an issue by its repo and number, so two repos never share one', () => {
    expect(issueKey('https://github.com/glyph/app/issues/12')).toBe('glyph/app#12');
    expect(issueKey('https://github.com/other/app/issues/12')).toBe('other/app#12');
    expect(issueKey('https://github.com/glyph/app')).toBeNull();
  });
});

describe('what GitHub answered', () => {
  it('reads an issue’s words, who has it and what it is labelled', () => {
    const issue = asIssue(raw, 'glyph', 'app');
    expect(issue.title).toBe('Ship the pricing page');
    expect(issue.state).toBe('open');
    expect(issue.labels).toEqual(['bug', 'chore']);
    expect(issue.assignees).toEqual(['matt']);
    expect(issueBrief(issue)).toEqual(['@matt', 'bug']);
    expect(issueFields(issue).map((field) => field.label)).toEqual(['Repo', 'Number', 'State', 'Assignee', 'Labels', 'Milestone']);
  });

  it('says where a closed issue stands, and why where GitHub says', () => {
    expect(issueState(asIssue({ ...raw, state: 'closed' }, 'glyph', 'app'))).toBe('Closed');
    expect(issueState(asIssue({ ...raw, state: 'closed', state_reason: 'not_planned' }, 'glyph', 'app'))).toBe('Closed as not planned');
  });

  it('stands an issue with nothing filled in on its own', () => {
    const issue = asIssue({ number: 4 }, 'glyph', 'app');
    expect(issue.title).toBe('Issue #4');
    expect(issue.url).toBe('https://github.com/glyph/app/issues/4');
    expect(issueBrief(issue)).toEqual([]);
  });
});

describe('an issue as a linked item', () => {
  it('is to do while open and done once closed, which is what ticks the box', () => {
    expect(detailsFromRaw(raw, 'glyph', 'app').status).toEqual({ label: 'Open', stage: 'todo' });
    expect(detailsFromRaw({ ...raw, state: 'closed' }, 'glyph', 'app').status).toEqual({ label: 'Closed', stage: 'done' });
  });

  it('carries the issue’s own address and when it last changed', () => {
    const details = detailsFromRaw(raw, 'glyph', 'app');
    expect(details.url).toBe('https://github.com/glyph/app/issues/12');
    expect(details.editedAt).toBe(Date.parse('2026-09-15T10:00:00Z'));
    expect(details.title).toBe('Ship the pricing page');
  });
});

describe('the GitHub plugin', () => {
  it('is one plugin for repos and issues, standard, reaching only GitHub', () => {
    expect(githubPlugin.manifest.id).toBe('github');
    expect(githubPlugin.manifest.standard).toBe(true);
    expect(githubPlugin.manifest.hosts).toEqual(['api.github.com']);
    expect(githubPlugin.marks).toBeTruthy();
    expect(githubPlugin.formatContext).toBeTruthy();
    expect(githubPlugin.itemAction?.label).toBe('GitHub');
  });

  it('writes an item’s link the way the editor reads it back', () => {
    const line = linkedLine('- [ ] Ship the pricing page', 'https://github.com/glyph/app/issues/12', 'github');
    expect(line).toBe('- [ ] Ship the pricing page [github](https://github.com/glyph/app/issues/12)');
    // Sent once, it is not offered again.
    expect(unsentItems(`${line}\n- [ ] Write the copy`).map((item) => item.text)).toEqual(['Write the copy']);
  });
});
