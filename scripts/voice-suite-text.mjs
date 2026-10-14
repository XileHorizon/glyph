#!/usr/bin/env node
/**
 * Writes the voice test suite (voice-tests/suite.json) as a plain text file to read and record from:
 * `node scripts/voice-suite-text.mjs [out]`, by default ~/Desktop/Glyph voice tests.txt.
 *
 * Every test is one audio file. The file name is the test's name; each line is followed by the silence after it,
 * which is what the capture rules read (a breath under two seconds, a paragraph over two). The ElevenLabs version
 * of each script writes those silences as break tags, for generating by hand in the web app.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const suite = JSON.parse(readFileSync(join(ROOT, 'voice-tests/suite.json'), 'utf8'));
const out = process.argv[2] ?? join(homedir(), 'Desktop', 'Glyph voice tests.txt');

const setupWords = (setup) => {
  if (setup === 'blank') return 'Start a new note (tap Speak on the list, memo mode off).';
  if (setup === 'fixtures') return 'Start a new note. The standard notes below must exist.';
  const [, name] = setup.split(':');
  return `Continue the note "${name}" (open it and tap its microphone). The standard notes below must exist.`;
};

const expectWords = (expect) => {
  const lines = [];
  if (expect.note !== undefined) lines.push(expect.note ? `This note reads exactly:\n${indent(expect.note)}` : 'This note stays empty (nothing is saved for it).');
  if (expect.match) lines.push(`This note matches: ${expect.match}`);
  for (const [name, body] of Object.entries(expect.notes ?? {})) lines.push(`"${name}" reads exactly:\n${indent(body)}`);
  for (const [name, parts] of Object.entries(expect.notesContain ?? {})) lines.push(`"${name}" contains:\n${parts.map((p) => indent(p)).join('\n')}`);
  for (const [name, parts] of Object.entries(expect.notesMatch ?? {})) lines.push(`"${name}" matches: ${parts.join('   ')}`);
  for (const [name, parts] of Object.entries(expect.notesLack ?? {})) lines.push(`"${name}" no longer contains: ${parts.join(' | ')}`);
  if (expect.contains) lines.push(`This note contains: ${expect.contains.map((c) => JSON.stringify(c)).join(', ')}`);
  if (expect.lacks) lines.push(`This note does not contain: ${expect.lacks.map((c) => JSON.stringify(c)).join(', ')}`);
  if (expect.offers) lines.push(`Glyph offers: ${expect.offers.join(', ')} (answer nothing; the test only checks the offer)`);
  if (expect.newNote === false) lines.push('No new note is made.');
  if (expect.stopsWithinMs) lines.push(`The recording stops by itself within ${expect.stopsWithinMs / 1000} s of the last word.`);
  return lines.join('\n');
};

const indent = (text) =>
  text
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');

const breakTag = (seconds) => `<break time="${seconds}s" />`;

const parts = [];
parts.push(`GLYPH VOICE TESTS
=================

${suite.tests.length} recordings, one per feature. Generate each as its own audio file, named exactly as shown
(for example 001-title-cue.mp3), and put them all in one folder:

    ~/Desktop/glyph-voice-tests/

Voice: ${suite.voiceNote}
Format: mp3 or wav, any sample rate (they are converted to 16 kHz mono for testing).
Say the punctuation as written: a colon after a cue word ("Title: …") is a short pause, and the pause is what
the rules read. Keep the silences exactly as given; long silences matter (two seconds or more is a new paragraph,
and a few tests end in several seconds of silence on purpose).

Each test gives the lines with the silence after each, the same script with ElevenLabs break tags (break tags
top out near three seconds, so for longer silences add the silence in an editor, or use the generator:
  python3 scripts/voice-tests/make_audio.py --voice <voice id>
which reads the suite and splices exact silences), what to have open first, and what should happen.

STANDARD NOTES
--------------
Tests marked "the standard notes below must exist" need these notes in the app first (titles matter; the
bodies are what the expectations start from):
`);
for (const [name, body] of Object.entries(suite.fixtures)) parts.push(`  "${name}":\n${indent(body.trimEnd())}\n`);

let group = '';
for (const test of suite.tests) {
  if (test.group !== group) {
    group = test.group;
    parts.push(`\n${'='.repeat(group.length + 4)}\n  ${group.toUpperCase()}\n${'='.repeat(group.length + 4)}\n`);
  }
  const prefs = Object.entries(test.prefs ?? {})
    .map(([key, value]) => `${key} ${value ? 'on' : 'off'}`)
    .join(', ');
  parts.push(`${test.file}.mp3
  Tests: ${test.tests}
  Before: ${setupWords(test.setup)}${prefs ? `\n  Settings: ${prefs === 'quietStop on' ? 'Recording > Stop when I go quiet ON' : prefs}` : ''}
  Lines (silence after each):
${test.lines.map(([line, pause]) => `      ${line}   [${pause}s]`).join('\n')}
  ElevenLabs:
      ${test.lines.map(([line, pause]) => `${line} ${breakTag(Math.min(pause, 3))}`).join(' ')}
  Expected:
${expectWords(test.expect)
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
`);
}

writeFileSync(out, `${parts.join('\n')}\n`);
console.log(`wrote ${suite.tests.length} tests to ${out}`);
