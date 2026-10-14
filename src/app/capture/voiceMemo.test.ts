import { describe, expect, it } from 'vitest';
import { endsMemo, startsMemo } from './voiceMemo.ts';

describe('the voice memo cue', () => {
  it('starts on the cue said as its own phrase, however it is asked for', () => {
    for (const said of [
      'Voice memo.',
      'voice memo',
      'Audio note.',
      'Leave a voice memo.',
      'Okay, record a voice clip.',
      'Start a voice recording.',
      'Voice memo:',
      // Whisper can open a phrase with the full stop of the one before.
      '. Voice memo.',
    ]) {
      expect(startsMemo(said), said).toBe(true);
    }
  });

  it('is not started by words that only mention it', () => {
    for (const said of [
      'I left a voice memo on your phone.',
      'Voice memo of the meeting is in the drawer.',
      'The audio note taker is broken.',
      'Memo.',
      'Bullet point: voice memo about the roof.',
    ]) {
      expect(startsMemo(said), said).toBe(false);
    }
  });

  it('ends on the closing cue, and not on ordinary words', () => {
    for (const said of ['End memo.', 'end of memo', 'Stop the voice note.', 'Finish clip.', 'Okay, end memo!', '. End memo.']) {
      expect(endsMemo(said), said).toBe(true);
    }
    for (const said of ['That was the end of the road.', 'End bold.', 'Stop by the shop.', 'And then it ended.']) {
      expect(endsMemo(said), said).toBe(false);
    }
  });
});
