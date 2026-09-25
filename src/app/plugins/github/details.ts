import { markDetailsChanged, type MarkAction, type MarkDetails, type MarkDetailsProvider, type MarkEntry } from '../../core/markDetails.ts';
import { asIssue, canWriteIssues, isIssueUrl, issueAt, issueBrief, issueFields, issueState, readIssue, setIssueOpen, type Issue } from './issues.ts';
import { host } from './manifest.ts';

/**
 * A linked item's issue, read back from GitHub: whether it is open, who has
 * it, what it is labelled, for the pill on the item and the card a tap opens
 * (core/markDetails.ts).
 *
 * The stage is the plain thing GitHub says: open is to do, closed is done.
 * That is what makes the tick work both ways (editor/doneSync.ts): the
 * actions here are called `done` and `reopen`, so ticking the box in the note
 * closes the issue, and an issue closed on GitHub ticks the box the next time
 * the note is read.
 *
 * Reads are paced two at a time, an answer is fresh for 45 seconds so
 * scrolling a list doesn't re-read it, and the last answers are kept
 * (`glyph-github-issues`, at most 300) so a note opened offline still shows
 * the state its issues last had, with when it was read on the card.
 */

const ISSUES_KEY = 'glyph-github-issues';
const FRESH_MS = 45_000;
const KEEP = 300;
const AT_ONCE = 2;

/** The key an issue is kept under: its repo and number. */
export function issueKey(url: string): string | null {
  const at = issueAt(url);
  return at ? `${at.owner}/${at.repo}#${at.number}` : null;
}

/** What the card and the pill show for an issue. */
export function detailsOf(issue: Issue, readAt = Date.now()): MarkDetails {
  const closed = issue.state === 'closed';
  return {
    url: issue.url,
    title: issue.title,
    status: { label: issueState(issue), stage: closed ? 'done' : 'todo' },
    brief: issueBrief(issue),
    fields: issueFields(issue),
    editedAt: issue.updatedAt,
    readAt,
  };
}

interface Known {
  details?: MarkDetails;
  issue?: Issue;
  failed?: string;
  /** When the last read failed: an issue never read is tried again once this is as old as a stale answer. */
  failedAt?: number;
  loading: boolean;
}

const known = new Map<string, Known>();
const queue: { key: string; url: string }[] = [];
let running = 0;
let restored = false;

function restore(): void {
  if (restored) return;
  restored = true;
  const saved = host.storage.get<Record<string, MarkDetails>>(ISSUES_KEY, {});
  if (!saved || typeof saved !== 'object') return;
  for (const [key, details] of Object.entries(saved)) {
    if (details && typeof details.title === 'string' && Array.isArray(details.fields)) known.set(key, { details, loading: false });
  }
}

function persist(): void {
  const kept = [...known.entries()]
    .filter(([, entry]) => entry.details)
    .sort(([, a], [, b]) => (b.details?.readAt ?? 0) - (a.details?.readAt ?? 0))
    .slice(0, KEEP);
  host.storage.set(ISSUES_KEY, Object.fromEntries(kept.map(([key, entry]) => [key, entry.details])));
}

/** Keeps what was just read, and tells everything showing it. */
function keep(key: string, issue: Issue): void {
  known.set(key, { details: detailsOf(issue), issue, loading: false });
  persist();
  markDetailsChanged();
}

async function read(key: string, url: string): Promise<void> {
  const entry = known.get(key) ?? { loading: true };
  try {
    keep(key, await readIssue(url));
    return;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    known.set(key, { details: entry.details, issue: entry.issue, failed: entry.details ? undefined : message, failedAt: Date.now(), loading: false });
  }
  markDetailsChanged();
}

function pump(): void {
  while (running < AT_ONCE && queue.length) {
    const next = queue.shift()!;
    running += 1;
    void read(next.key, next.url).finally(() => {
      running -= 1;
      pump();
    });
  }
}

/** Puts an issue into what is known without reading it: what `createIssue` just made. */
export function rememberIssue(issue: Issue): void {
  restore();
  keep(`${issue.owner}/${issue.repo}#${issue.number}`, issue);
}

export const githubDetails: MarkDetailsProvider = {
  peek(url) {
    const key = issueKey(url);
    if (!key) return null;
    restore();
    const entry = known.get(key);
    if (entry?.details) return { state: 'ready', details: entry.details, loading: entry.loading } satisfies MarkEntry;
    if (entry?.failed) return { state: 'failed', message: entry.failed };
    return entry?.loading ? { state: 'loading' } : null;
  },
  want(url, fresh = false) {
    const key = issueKey(url);
    if (!key) return;
    restore();
    const entry = known.get(key);
    if (entry?.loading) return;
    if (!fresh && entry?.details && Date.now() - entry.details.readAt < FRESH_MS) return;
    // A failed read is tried again after a while, as a stale answer is, not only on a Refresh by hand (the Notion
    // plugin's details.ts says why).
    if (!fresh && entry?.failed && Date.now() - (entry.failedAt ?? 0) < FRESH_MS) return;
    known.set(key, { details: entry?.details, issue: entry?.issue, loading: true });
    queue.push({ key, url });
    pump();
  },
  open: (url) => host.openUrl(url),
  // A GitHub issue pasted into a sentence reads the same as one Glyph sent.
  reads: isIssueUrl,
  actions(url) {
    const key = issueKey(url);
    const entry = key ? known.get(key) : undefined;
    if (!key || !entry?.details || !canWriteIssues()) return [];
    const closed = entry.details.status?.stage === 'done';
    const action: MarkAction = {
      id: closed ? 'reopen' : 'done',
      label: closed ? 'Open again' : 'Close issue',
      icon: closed ? 'reopen' : 'done',
      busyLabel: closed ? 'Opening…' : 'Closing…',
      async run() {
        const issue = await setIssueOpen(url, closed);
        keep(key, issue);
        return closed ? `#${issue.number} is open again.` : `#${issue.number} is closed.`;
      },
    };
    return [action];
  },
};

/** Turns GitHub's answer into what a card shows, without a request: for the tests. */
export const detailsFromRaw = (raw: Parameters<typeof asIssue>[0], owner: string, repo: string): MarkDetails => detailsOf(asIssue(raw, owner, repo));
