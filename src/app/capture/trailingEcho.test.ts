import { describe, expect, it } from 'vitest';
import { segmentsWithoutTrailingEcho, withoutTrailingEcho } from './trailingEcho.ts';

describe("Whisper's echo at the end of a recording", () => {
  it.each([
    ['Add eggs to Go. Go.', 'Add eggs to Go.'],
    ['Add eggs to Go. Go. Go.', 'Add eggs to Go.'],
    ['Add to Go Detroit, Michigan and Marietta, Ohio. Go. Go.', 'Add to Go Detroit, Michigan and Marietta, Ohio.'],
    ['Put it on the work list. Work list.', 'Put it on the work list.'],
  ])('drops it: %s', (heard, kept) => {
    expect(withoutTrailingEcho(heard)).toBe(kept);
  });

  it.each(['Add eggs to Go.', 'We should go. Now.', 'It was fun. Really fun, actually, the whole day.', 'Go.', 'Remind me to call Sam. Tomorrow.'])('keeps speech: %s', (heard) => {
    expect(withoutTrailingEcho(heard)).toBe(heard);
  });

  it('takes it off the phrases too, however they were cut', () => {
    const segments = [
      { text: 'Add eggs to Go.', startMs: 0, endMs: 1000 },
      { text: 'Go.', startMs: 1000, endMs: 1500 },
      { text: 'Go.', startMs: 1500, endMs: 2000 },
    ];
    expect(segmentsWithoutTrailingEcho(segments)).toEqual([segments[0]]);
    expect(segmentsWithoutTrailingEcho([{ text: 'Add eggs to Go. Go.', startMs: 0, endMs: 2000 }])).toEqual([{ text: 'Add eggs to Go.', startMs: 0, endMs: 2000 }]);
  });
});
