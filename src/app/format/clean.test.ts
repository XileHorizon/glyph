import { describe, expect, it } from 'vitest';
import { cleanNote, cleanRewrite } from './clean.ts';

const NOTION = 'https://www.notion.so/attackfm/Buy-milk-1a2b3c4d5e6f';

describe('the note as the model sees it', () => {
  it('turns an old Notion item link into the mark form, and leaves other links alone', () => {
    expect(cleanNote(`- [ ] [Buy milk](${NOTION})\n- [ ] [Old one](${NOTION}).\n- read [the docs](https://example.com/docs)\nSee [the board](${NOTION}) too.\n`)).toBe(
      `- [ ] Buy milk [notion](${NOTION})\n- [ ] Old one. [notion](${NOTION})\n- read [the docs](https://example.com/docs)\nSee [the board](${NOTION}) too.\n`,
    );
  });
});

describe('the rewrite, tidy', () => {
  it('unwinds a link nested in a link, keeping the inner one', () => {
    expect(cleanRewrite(`- [ ] [[Buy milk](${NOTION})](${NOTION}) today\n`)).toBe(`- [ ] Buy milk today [notion](${NOTION})\n`);
    expect(cleanRewrite(`See [[the docs](https://a.example/d)](https://b.example/x).\n`)).toBe('See [the docs](https://a.example/d).\n');
    expect(cleanRewrite(`- [x [inner](https://a.example/i) y](https://b.example/o)\n`)).toBe('- x [inner](https://a.example/i) y\n');
  });

  it('keeps an item’s mark once and last, whatever the model did with it', () => {
    expect(cleanRewrite(`- [ ] [notion](${NOTION}) Buy milk on the way home.\n`)).toBe(`- [ ] Buy milk on the way home. [notion](${NOTION})\n`);
    expect(cleanRewrite(`- [ ] Buy milk [notion](${NOTION}) [notion](${NOTION})\n`)).toBe(`- [ ] Buy milk [notion](${NOTION})\n`);
    expect(cleanRewrite(`- [ ] [Buy milk](${NOTION}) [notion](${NOTION})\n`)).toBe(`- [ ] Buy milk [notion](${NOTION})\n`);
  });

  it('makes the markdown the plain kind: dashes, task boxes with spaces, a space after the hashes, no runs of blank lines', () => {
    expect(cleanRewrite('#Title\n\n\n\n* one  \n+ two\n-[ ]three\n- [X] four\n-  [ ]  five\n')).toBe('# Title\n\n- one\n- two\n- [ ] three\n- [x] four\n- [ ] five\n');
  });

  it('leaves words alone', () => {
    const text = '# Call the plumber\n\n- [ ] Call the plumber about the leaking tap before **Thursday**, because it\'s getting worse.\n- [ ] Pick up eggs and coffee on the way home.\n';
    expect(cleanRewrite(text)).toBe(text);
  });
});
