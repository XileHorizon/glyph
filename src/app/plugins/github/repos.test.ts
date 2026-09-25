import { describe, expect, it } from 'vitest';
import { outline, parseRepo, pickFiles, readmeWords } from './repos.ts';

describe('reading a GitHub project', () => {
  it('takes a repo from the ways people paste one', () => {
    expect(parseRepo('https://github.com/InfamousVague/attackfm')).toEqual({ owner: 'InfamousVague', repo: 'attackfm' });
    expect(parseRepo('github.com/InfamousVague/glyph.git')).toEqual({ owner: 'InfamousVague', repo: 'glyph' });
    expect(parseRepo('InfamousVague/glyph/tree/main/src')).toEqual({ owner: 'InfamousVague', repo: 'glyph' });
    expect(parseRepo('not a repo')).toBeNull();
  });

  it('picks the files that say what the project is, README first', () => {
    const paths = [
      'src/main.rs',
      'docs/DESIGN.md',
      'README.md',
      'node_modules/x/README.md',
      'AGENTS.md',
      'package.json',
      'docs/notes/deep.md',
      'docs/setup.md',
      'vendor/lib/README.md',
    ];
    expect(pickFiles(paths)).toEqual(['README.md', 'AGENTS.md', 'docs/DESIGN.md', 'package.json', 'docs/setup.md']);
  });

  it('outlines the top-level folders by size', () => {
    expect(outline(['src/a.ts', 'src/b.ts', 'docs/x.md', 'README.md'])).toBe('src/ (2 files)\ndocs/ (1 file)\nREADME.md');
  });

  it('keeps a README’s words for the fallback briefing, not its markup', () => {
    const readme = '<picture><source srcset="/banner.png"></picture>\n\n# livekit-wakeword\n\n[![CI](https://x/badge.svg)](https://x)\n\nTrain a [wake word](https://docs) model.\n\n![diagram](d.png)';
    expect(readmeWords(readme)).toBe('# livekit-wakeword\n\nTrain a wake word model.');
  });
});
