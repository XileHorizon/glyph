import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * How the note's pills read their tasks from Notion (details.ts `notionDetails`), with Notion itself stood in for:
 * a read that fails is tried again after a while, as a stale answer is, rather than never.
 */
const request = vi.fn();
vi.mock('./client.ts', () => ({
  notionAvailable: async () => true,
  notionRequest: (...args: unknown[]) => request(...args),
}));

const { notionDetails, forgetTaskDetails } = await import('./details.ts');
// The provider learns Notion is usable a moment after it loads.
await Promise.resolve();

const URL = 'https://www.notion.so/Ship-it-3df522a4563081dc91a2cfa7d6be2ba6';

function page(status: string) {
  return {
    id: '3df522a4-5630-81dc-91a2-cfa7d6be2ba6',
    url: URL,
    last_edited_time: '2026-09-18T18:04:53.000Z',
    properties: { Title: { type: 'title', title: [{ plain_text: 'Ship it' }] }, Status: { type: 'status', status: { name: status } } },
  };
}

/** Until what is queued has been read. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe('reading a task again after a failure', () => {
  beforeEach(() => {
    forgetTaskDetails();
    request.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-18T18:10:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('does not ask again at once, but does once a stale answer would be read again', async () => {
    request.mockRejectedValueOnce(new Error('The network is not back yet.'));
    notionDetails.want(URL);
    await settle();
    expect(notionDetails.peek(URL)).toEqual({ state: 'failed', message: 'The network is not back yet.' });

    // Straight after, from the next line scrolled past or the next keystroke: not again.
    notionDetails.want(URL);
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    // A while later, from the note's own minute-by-minute read: again, and this time it answers.
    vi.setSystemTime(Date.now() + 60_000);
    request.mockResolvedValueOnce(page('Done'));
    notionDetails.want(URL);
    await settle();
    await settle();
    const entry = notionDetails.peek(URL);
    expect(entry?.state === 'ready' && entry.details.status).toEqual({ label: 'Done', stage: 'done' });
  });
});
