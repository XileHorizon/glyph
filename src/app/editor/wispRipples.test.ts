import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { wisp, wispArrivals } from './wispArrivals.ts';
import { follow, rippledRanges, shape } from './wispRipples.ts';

describe('ripples through the arriving words', () => {
  it('ripples only the words still arriving, one stretch a phrase, and none of the text already set', () => {
    const settled = EditorState.create({ doc: 'Already said.\n', extensions: [wispArrivals()] });
    expect(rippledRanges(settled)).toEqual([]);
    const heard = settled.update({ changes: { from: settled.doc.length, insert: 'oat milk' }, annotations: wisp.of({ kind: 'heard' }) }).state;
    const stretches = rippledRanges(heard);
    expect(stretches.map((r) => heard.doc.sliceString(r.from, r.to))).toEqual(['oat milk']);
    expect(stretches[0]!.from).toBe('Already said.\n'.length);
  });

  it('keeps a phrase on each line its own stretch, and takes no part in text leaving', () => {
    const start = EditorState.create({ doc: 'one two', extensions: [wispArrivals()] });
    const heard = start.update({ changes: { from: 7, insert: '\nthree' }, annotations: wisp.of({ kind: 'heard' }) }).state;
    expect(rippledRanges(heard).map((r) => heard.doc.sliceString(r.from, r.to))).toEqual(['three']);
    const rewrite = heard.update({ changes: { from: 0, to: 3, insert: '' }, annotations: wisp.of({ kind: 'rewrite' }) }).state;
    expect(rippledRanges(rewrite).every((r) => r.to > r.from)).toBe(true);
  });

  it('follows a voice up quickly and down slowly, and settles to nothing', () => {
    const up = follow(0, 0.6);
    expect(up).toBeGreaterThan(0.2);
    const down = follow(up, 0);
    expect(down).toBeLessThan(up);
    expect(up - down).toBeLessThan(up * 0.2);
    let level = up;
    for (let i = 0; i < 200; i += 1) level = follow(level, 0);
    expect(level).toBe(0);
  });

  it('bends nothing in silence and a full wave by ordinary talking', () => {
    expect(shape(0)).toEqual({ scale: 0, blur: 0 });
    expect(shape(0.15).scale).toBeGreaterThan(0);
    expect(shape(0.15).scale).toBeLessThan(shape(0.3).scale);
    expect(shape(0.3)).toEqual(shape(1));
    expect(shape(1).scale).toBe(30);
  });
});
