import { githubToken, type Project } from './repos.ts';
import { host } from './manifest.ts';

/**
 * Issues on a linked repo: a note's list items sent to GitHub, and what comes
 * back about them.
 *
 * Matt: "a GitHub issues plugin that allows us to sync list items with GitHub
 * project issues". A list item sent becomes an issue, and its words become a
 * link to that issue, the same shape the Notion plugin writes
 * (`- [ ] Ship the page [github](https://github.com/o/r/issues/12)`). From
 * then on the item and the issue are the same thing: the item's box ticked in
 * the note closes the issue, and an issue closed on GitHub ticks the box
 * (editor/doneSync.ts through core/markDetails.ts).
 *
 * Reading is the REST API, which answers a browser from any origin. Writing
 * needs a token, kept on this phone only (the repos side already asks for one
 * for private repos): without it the note says so rather than failing quietly.
 * Everything here is the plugin's own network permission, through its host.
 */

const API = 'https://api.github.com';

export interface Issue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  /** "completed" or "not_planned" on a closed issue, where GitHub says. */
  reason: string | null;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  updatedAt: number | null;
}

/** The repo and number in an issue's address: "https://github.com/owner/repo/issues/12". */
export function issueAt(url: string): { owner: string; repo: string; number: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)/.exec(parsed.pathname);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

/** Whether a link is an issue on GitHub, so its details are read even when it was pasted rather than sent. */
export const isIssueUrl = (url: string): boolean => issueAt(url) !== null;

interface RawIssue {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  state_reason?: string | null;
  updated_at?: string;
  labels?: ({ name?: string } | string)[];
  assignees?: { login?: string }[];
  milestone?: { title?: string } | null;
  pull_request?: unknown;
}

/** What GitHub answered, as an issue. */
export function asIssue(raw: RawIssue, owner: string, repo: string): Issue {
  const number = raw.number ?? 0;
  return {
    owner,
    repo,
    number,
    title: (raw.title ?? '').trim() || `Issue #${number}`,
    url: raw.html_url ?? `https://github.com/${owner}/${repo}/issues/${number}`,
    state: raw.state === 'closed' ? 'closed' : 'open',
    reason: raw.state_reason ?? null,
    labels: (raw.labels ?? []).map((label) => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean),
    assignees: (raw.assignees ?? []).map((who) => who.login ?? '').filter(Boolean),
    milestone: raw.milestone?.title ?? null,
    updatedAt: raw.updated_at ? Date.parse(raw.updated_at) : null,
  };
}

/** Whether the phone can make and close issues: reading needs nothing, writing needs a token. */
export function canWriteIssues(): boolean {
  return githubToken().trim().length > 0;
}

export const NEEDS_TOKEN = 'Add a GitHub token in Settings > Plugins > GitHub to send items as issues.';

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  host.require('network');
  const token = githubToken().trim();
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const answer = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!answer.ok) throw new Error(await trouble(answer, method));
  return (await answer.json()) as T;
}

/** GitHub's own words for what went wrong, said the way a person can act on. */
async function trouble(answer: Response, method: 'GET' | 'POST' | 'PATCH'): Promise<string> {
  const said = await answer
    .json()
    .then((body: { message?: string }) => body.message ?? '')
    .catch(() => '');
  if (answer.status === 401) return 'GitHub didn’t accept that token. Check it in Settings > Plugins > GitHub.';
  if (answer.status === 403 && /rate limit/i.test(said)) return 'GitHub is rate limiting this phone. Try again in a few minutes.';
  if (answer.status === 403 || answer.status === 404) {
    return method === 'GET' ? 'That issue isn’t readable with this token.' : 'That repo doesn’t allow this token to write issues.';
  }
  if (answer.status === 410) return 'Issues are switched off for that repo.';
  return said ? `GitHub: ${said}` : `GitHub answered ${answer.status}.`;
}

/** Makes an issue on `project`'s repo with `title`, and answers it. */
export async function createIssue(project: Pick<Project, 'owner' | 'repo'>, title: string, body?: string): Promise<Issue> {
  if (!canWriteIssues()) throw new Error(NEEDS_TOKEN);
  const raw = await call<RawIssue>('POST', `/repos/${project.owner}/${project.repo}/issues`, {
    title: title.slice(0, 250),
    ...(body ? { body } : {}),
  });
  return asIssue(raw, project.owner, project.repo);
}

/** Reads one issue. */
export async function readIssue(url: string): Promise<Issue> {
  const at = issueAt(url);
  if (!at) throw new Error('That isn’t a GitHub issue.');
  const raw = await call<RawIssue>('GET', `/repos/${at.owner}/${at.repo}/issues/${at.number}`);
  return asIssue(raw, at.owner, at.repo);
}

/** Closes an issue as done, or opens it again. */
export async function setIssueOpen(url: string, open: boolean): Promise<Issue> {
  const at = issueAt(url);
  if (!at) throw new Error('That isn’t a GitHub issue.');
  if (!canWriteIssues()) throw new Error(NEEDS_TOKEN);
  const raw = await call<RawIssue>('PATCH', `/repos/${at.owner}/${at.repo}/issues/${at.number}`, {
    state: open ? 'open' : 'closed',
    ...(open ? {} : { state_reason: 'completed' }),
  });
  return asIssue(raw, at.owner, at.repo);
}

/** The short facts for an issue's pill, most telling first: who it's on, its labels, its milestone. */
export function issueBrief(issue: Issue): string[] {
  const facts: string[] = [];
  if (issue.assignees[0]) facts.push(`@${issue.assignees[0]}`);
  if (issue.labels[0]) facts.push(issue.labels[0]);
  if (issue.milestone) facts.push(issue.milestone);
  return facts.slice(0, 2);
}

/** Everything worth listing on an issue's card. */
export function issueFields(issue: Issue): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [
    { label: 'Repo', value: `${issue.owner}/${issue.repo}` },
    { label: 'Number', value: `#${issue.number}` },
    { label: 'State', value: issueState(issue) },
  ];
  if (issue.assignees.length) fields.push({ label: issue.assignees.length === 1 ? 'Assignee' : 'Assignees', value: issue.assignees.map((who) => `@${who}`).join(', ') });
  if (issue.labels.length) fields.push({ label: issue.labels.length === 1 ? 'Label' : 'Labels', value: issue.labels.join(', ') });
  if (issue.milestone) fields.push({ label: 'Milestone', value: issue.milestone });
  return fields;
}

/** The word for where an issue is: "Open", "Closed", "Closed as not planned". */
export function issueState(issue: Issue): string {
  if (issue.state === 'open') return 'Open';
  return issue.reason === 'not_planned' ? 'Closed as not planned' : 'Closed';
}
