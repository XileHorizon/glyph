import { describe, expect, it } from 'vitest';
import { refinedBody, refinedSegments, type RefineJob, withClips, withoutCommands } from './refine.ts';

const job = (over: Partial<RefineJob> = {}): RefineJob => ({
  id: 'n1',
  fromMs: 0,
  recordingMs: 4000,
  baseBody: '',
  savedBody: '# Grocery run\n\nIt has to happen before Saturday.',
  titled: true,
  priorSegments: [],
  promptTail: '',
  tries: 0,
  ...over,
});

describe('the better words after a recording', () => {
  it('renders a first take with a title, from the better phrases', () => {
    const body = refinedBody(job(), [
      { text: 'Grocery run.', startMs: 0, endMs: 1000 },
      { text: 'It has to happen before Saturday morning.', startMs: 1300, endMs: 3000 },
    ]);
    expect(body).toBe('# Grocery run\n\nIt has to happen before Saturday morning.');
  });

  it('puts a later take under the note it continued, without a new title', () => {
    const body = refinedBody(
      job({ baseBody: '# Grocery run\n\nBook the cabin.', fromMs: 10_000, titled: false }),
      [{ text: 'Ask Sam about the dog.', startMs: 10_000, endMs: 12_000 }],
    );
    expect(body).toBe('# Grocery run\n\nBook the cabin.\n\nAsk Sam about the dog.');
  });

  it("replaces only the take's phrases in the recording's list", () => {
    const prior = [
      { text: 'Book the cabin.', startMs: 0, endMs: 2000 },
      { text: 'live guess of the take', startMs: 10_000, endMs: 12_000 },
    ];
    const merged = refinedSegments(job({ fromMs: 10_000, priorSegments: prior }), [
      { text: 'Ask Sam about the dog.', startMs: 10_000, endMs: 12_000 },
    ]);
    expect(merged.map((s) => s.text)).toEqual(['Book the cabin.', 'Ask Sam about the dog.']);
  });
});

describe('the better words leave commands out', () => {
  const seg = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
  it('drops phrases inside a command’s stretch and cuts a phrase at “hey Ghost”', () => {
    const refined = [seg('Pick up the parcel.', 0, 1800), seg('Pick up milk, hey Ghost, add eggs to', 2000, 4000), seg('work.', 4000, 4800), seg('Yes.', 5200, 5600), seg('Call Sam.', 6000, 7000)];
    const kept = withoutCommands({ skip: [{ startMs: 3950, endMs: 4900 }, { startMs: 5100, endMs: 5700 }], keywordAt: [{ startMs: 2100, endMs: 3900 }] }, refined);
    expect(kept.map((s) => s.text)).toEqual(['Pick up the parcel.', 'Pick up milk', 'Call Sam.']);
  });

  it('keeps everything for a job from before commands were kept out', () => {
    const refined = [seg('Ghost is the app.', 0, 1000)];
    expect(withoutCommands({}, refined)).toEqual(refined);
  });
});

describe('voice memos in the better words', () => {
  const clip = { text: '![voice 0:05](tape:12000-17000)', startMs: 12_000, endMs: 17_000 };
  const refined = [
    { text: 'Before the memo.', startMs: 8_000, endMs: 11_000 },
    { text: 'After it.', startMs: 18_000, endMs: 20_000 },
  ];

  it('puts each memo back where it was spoken', () => {
    const job = { clips: [clip] };
    expect(withClips(job, refined).map((s) => s.text)).toEqual(['Before the memo.', '![voice 0:05](tape:12000-17000)', 'After it.']);
  });

  it('leaves a take with no memo exactly as it was', () => {
    expect(withClips({}, refined)).toEqual(refined);
    expect(withClips({ clips: [] }, refined)).toEqual(refined);
  });
});
