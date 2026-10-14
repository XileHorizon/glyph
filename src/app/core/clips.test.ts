import { describe, expect, it } from 'vitest';
import { clipLength, clipMarkdown, clipsIn, freshTapeId, hasClips, parseClip, playsOn, setTapeId, tapeId } from './clips.ts';

describe('a voice memo in a note', () => {
  it('is written as a mark that says how long it is', () => {
    expect(clipMarkdown({ startMs: 12_000, endMs: 19_500 })).toBe('![voice 0:08](tape:12000-19500)');
    expect(clipMarkdown({ startMs: 0, endMs: 125_000 })).toBe('![voice 2:05](tape:0-125000)');
    expect(clipLength({ startMs: 1000, endMs: 1400 })).toBe('0:00');
  });

  it('rounds times and never ends before it starts', () => {
    expect(clipMarkdown({ startMs: -50, endMs: 900.6 })).toBe('![voice 0:01](tape:0-901)');
    expect(clipMarkdown({ startMs: 5000, endMs: 4000 })).toBe('![voice 0:00](tape:5000-5000)');
  });

  it('is read back, and nothing else is', () => {
    expect(parseClip('![voice 0:08](tape:12000-19500)')).toEqual({ startMs: 12_000, endMs: 19_500, tape: null });
    expect(parseClip('![a picture](image/abc.jpg)')).toBeNull();
    expect(parseClip('[notion](https://www.notion.so/x)')).toBeNull();
    expect(parseClip('![voice](tape:900-900)')).toBeNull();
    expect(parseClip('![voice](tape:9-x)')).toBeNull();
  });

  it('is found where it sits, bulleted or mid-sentence', () => {
    const note = `- Milk ![voice 0:03](tape:0-3000)\n\nHe said ![voice 0:05](tape:8000-13000) and left.\n`;
    const found = clipsIn(note);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ startMs: 0, endMs: 3000, tape: null });
    expect(note.slice(found[1]!.from, found[1]!.to)).toBe('![voice 0:05](tape:8000-13000)');
    expect(hasClips('plain words')).toBe(false);
  });

  it('says which tape it is a piece of, when it knows', () => {
    expect(clipMarkdown({ startMs: 1000, endMs: 4000, tape: 'k3f9x2' })).toBe('![voice 0:03](tape:1000-4000@k3f9x2)');
    expect(parseClip('![voice 0:03](tape:1000-4000@k3f9x2)')).toEqual({ startMs: 1000, endMs: 4000, tape: 'k3f9x2' });
    // Nothing odd gets into a note's text.
    expect(clipMarkdown({ startMs: 0, endMs: 1000, tape: 'no spaces here' })).toBe('![voice 0:01](tape:0-1000)');
  });

  it('plays only against the tape it was cut from', () => {
    const mine = { startMs: 0, endMs: 1000, tape: 'aaa' };
    expect(playsOn(mine, 'aaa')).toBe(true);
    expect(playsOn(mine, 'bbb')).toBe(false);
    expect(playsOn(mine, null)).toBe(false);
    // A mark from before tapes were named plays against whatever recording the note has.
    expect(playsOn({ startMs: 0, endMs: 1000 }, 'aaa')).toBe(true);
    expect(playsOn({ startMs: 0, endMs: 1000, tape: null }, null)).toBe(true);
  });
});

describe('the tape a note holds', () => {
  it('is remembered per note, and forgotten with the recording', () => {
    localStorage.clear();
    expect(tapeId('a')).toBeNull();
    setTapeId('a', 'k3f9x2');
    setTapeId('b', 'zzz111');
    expect(tapeId('a')).toBe('k3f9x2');
    setTapeId('a', null);
    expect(tapeId('a')).toBeNull();
    expect(tapeId('b')).toBe('zzz111');
  });

  it('gets an id that is only ever compared with itself', () => {
    expect(freshTapeId()).toMatch(/^[a-z0-9]{6,10}$/);
    expect(freshTapeId()).not.toBe(freshTapeId());
  });
});
