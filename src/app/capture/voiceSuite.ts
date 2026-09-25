import { boardFrom } from '../core/boards.ts';
import { clipMarkdown } from '../core/clips.ts';
import { noteTitle } from '../core/store.ts';
import type { VoiceCommand } from '../plugins/types.ts';
import { appendBody } from './appendBody.ts';
import { placeWords } from './listAppend.ts';
import { renderNote, setLinkTitles, spokenNumber, type Segment } from './markdown.ts';
import { QuietWatch } from './quiet.ts';
import { appendBlock } from './table.ts';
import { Take, type TakeCandidate, type TakeNote } from './take.ts';

/**
 * The voice test suite (voice-tests/suite.json): a recording per feature, replayed through the recorder's own logic
 * (capture/take.ts) and checked against the notes it should leave.
 *
 * Two ways in. From the script, each line is one committed phrase with the silence written after it, which checks
 * the rules. From the audio (`npm run voice:suite`), Whisper on this machine hears the recording exactly as the phone
 * would (src-tauri/src/whisper/suite.rs writes what it heard), which checks the rules against real speech.
 */

export interface SuiteTest {
  id: string;
  file: string;
  group: string;
  tests: string;
  /** "blank", "fixtures", or "continue:<title>". */
  setup: string;
  prefs: { quietStop?: boolean; commandWord?: boolean };
  /** Each line, and the seconds of silence after it. */
  lines: [string, number][];
  expect: Expectation;
}

export interface Expectation {
  /** The recording's own note, exactly ('' when nothing is saved for it). */
  note?: string;
  /** A regular expression the recording's own note matches. */
  match?: string;
  contains?: string[];
  lacks?: string[];
  /** Other notes, exactly. */
  notes?: Record<string, string>;
  notesContain?: Record<string, string[]>;
  notesMatch?: Record<string, string[]>;
  notesLack?: Record<string, string[]>;
  /** Offers made, as "plugin:<id>" or a plan kind. */
  offers?: string[];
  newNote?: boolean;
  /** The recording stops by itself this soon after the last words. */
  stopsWithinMs?: number;
}

export interface Suite {
  fixtures: Record<string, string>;
  tests: SuiteTest[];
}

export interface Heard {
  segments: Segment[];
  /** The recording's length. */
  audioMs: number;
}

/** A line's length, spoken at an ordinary pace: about a third of a second a word, and never under half a second. */
function spokenMs(line: string): number {
  return Math.max(500, line.split(/\s+/).filter(Boolean).length * 330);
}

/**
 * The script as the phone's streamer would commit it: a phrase per line, timed the way stream.rs times them. A phrase
 * keeps 300 ms of the quiet after it and the next one starts where it ended, unless two seconds of quiet built up
 * first, which are dropped but for 300 ms: so a pause shows as no gap, or 1.7 s for every two seconds past 300 ms.
 */
export function scriptHeard(lines: readonly [string, number][]): Heard {
  const segments: Segment[] = [];
  let start = 0;
  let speech = 300;
  for (const [text, pause] of lines) {
    const end = speech + spokenMs(text) + Math.min(300, pause * 1000);
    segments.push({ text, startMs: start, endMs: end });
    const quiet = Math.max(0, pause * 1000 - 300);
    const drops = Math.floor(quiet / 2000);
    start = end + drops * 1700;
    speech = end + quiet;
  }
  return { segments, audioMs: speech };
}

interface StoredNote extends TakeNote {
  title: string;
}

export interface Outcome {
  /** The recording's own note when it made one, else null. */
  note: string | null;
  /** Every note by title, after the recording. */
  notes: Record<string, string>;
  offers: string[];
  newNote: boolean;
  stoppedAtMs: number | null;
  lastWordsMs: number;
  log: string[];
}

/** How long after the audio of a phrase ends the phone commits it. */
const COMMIT_LAG_MS = 400;
const TICK_MS = 250;
const QUIET_STOP_MS = 4000;

/** One recording, played through the take with the suite's notes, and what came of it. */
export function runTest(test: SuiteTest, fixtures: Record<string, string>, heard: Heard, voiceCommands: readonly VoiceCommand[] = []): Outcome {
  const store = new Map<string, StoredNote>();
  const withFixtures = test.setup !== 'blank';
  if (withFixtures) {
    let n = 0;
    for (const [title, body] of Object.entries(fixtures)) store.set(`fixture-${n++}`, { id: `fixture-${n - 1}`, title, body });
  }
  // The recorder gives spoken note links the titles it knows, as CaptureScreen does.
  setLinkTitles(withFixtures ? Object.keys(fixtures) : []);
  const byTitle = (title: string) => [...store.values()].find((note) => note.title === title) ?? null;
  let target: StoredNote | null = test.setup.startsWith('continue:') ? byTitle(test.setup.slice('continue:'.length)) : null;
  let newNote = false;
  const offers: string[] = [];
  const log: string[] = [];
  const candidates = (): TakeCandidate<StoredNote>[] => [...store.values()].map((note) => ({ id: note.id, title: noteTitle(note.body) || note.title, note }));
  /** The last change to a note, for "undo": its body before. */
  let lastChange: { id: string; before: string; what: string } | null = null;
  const change = (id: string, next: (body: string) => string | null, what?: string) => {
    const note = store.get(id);
    if (!note) return;
    const body = next(note.body);
    if (body !== null) {
      if (what) lastChange = { id, before: note.body, what };
      store.set(id, { ...note, body });
    }
    if (target?.id === id && body !== null) target = { ...target, body };
  };
  /** The words so far onto the note being recorded, as the recorder's draft saves them, before the take carries on elsewhere. */
  const flush = () => {
    const current = target;
    if (!current) return;
    const markdown = take.markdown({ titled: false, board: (text) => boardFrom(text)?.doc ?? text });
    if (renderNote(take.segments).plain.trim() || take.tables.length || take.clips.length) change(current.id, (body) => appendBody(body, markdown));
    take.fork();
  };
  let made = 0;

  const take: Take<StoredNote> = new Take<StoredNote>({
    notes: candidates,
    target: () => target,
    commandWord: () => test.prefs.commandWord ?? true,
    instructionCommands: () => false,
    voiceCommands: () => voiceCommands,
    itemTargets: () => [],
    route: () => undefined,
    offer: (offer) => {
      if (offer) offers.push(offer.kind === 'plugin' ? `plugin:${offer.voice.id.split('-')[0] ?? offer.voice.id}` : offer.kind);
    },
    table: () => undefined,
    itemWords: () => undefined,
    haptic: () => undefined,
    changed: () => undefined,
    addItems: (note, spoken, placement) =>
      change(
        note.id,
        (body) => {
          const placed = placeWords(body, spoken, placement);
          return placed.added.length ? placed.body : null;
        },
        `“${spoken}”`,
      ),
    changeNote: (note, next, title) => change(note.id, next, title),
    addTable: (note, _title, markdown) => change(note.id, (body) => appendBlock(body, markdown), 'the table'),
    moveTo: (note) => {
      target = store.get(note.id) ?? note;
    },
    carryOn: (note) => {
      flush();
      target = store.get(note.id) ?? note;
    },
    newNote: (title) => {
      flush();
      if (title) {
        const named = `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
        const id = `made-${made++}`;
        store.set(id, { id, title: named, body: `# ${named}` });
        target = store.get(id)!;
        return;
      }
      target = null;
      newNote = true;
    },
    undo: () => {
      const last = lastChange;
      if (!last) return null;
      lastChange = null;
      change(last.id, () => last.before);
      return last.what;
    },
    runPlugin: () => null,
    describePlugin: (voice) => ({ title: voice.id, action: 'Go' }),
    clip: (span) => clipMarkdown({ startMs: span.startMs, endMs: span.endMs, tape: 'suite' }),
    log: (line) => log.push(line),
    said: () => undefined,
  });

  const quiet = test.prefs.quietStop ? new QuietWatch(QUIET_STOP_MS) : null;
  const commits = heard.segments.map((segment) => ({ at: segment.endMs + COMMIT_LAG_MS, segment }));
  const end = heard.audioMs + COMMIT_LAG_MS;
  let stoppedAtMs: number | null = null;
  let next = 0;
  for (let now = 0; now <= end; now += TICK_MS) {
    while (next < commits.length && commits[next]!.at <= now) {
      const { segment } = commits[next++]!;
      quiet?.words(now);
      take.phrase(segment, now);
    }
    const commanding = take.commanding;
    take.tick(now);
    if (!commanding && quiet?.due(now)) {
      stoppedAtMs = now;
      break;
    }
  }

  take.end(stoppedAtMs ?? heard.audioMs);
  const titled = target === null;
  const markdown = take.markdown({ titled, board: (text) => boardFrom(text)?.doc ?? text });
  const said = renderNote(take.segments).plain.trim() || take.tables.length || take.clips.length;
  let note: string | null = null;
  if (said) {
    if (target) change(target.id, (body) => appendBody(body, markdown));
    else note = markdown;
  }

  const notes: Record<string, string> = {};
  for (const stored of store.values()) notes[stored.title] = stored.body;
  const lastWordsMs = heard.segments.length ? heard.segments[heard.segments.length - 1]!.endMs : 0;
  return { note, notes, offers, newNote, stoppedAtMs, lastWordsMs, log };
}

const NUMBER_RUN = /\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[\s-]+(?:and[\s-]+)?(?=\w)|\b))+/gi;

/**
 * Text as it is compared for recorded audio: a number said is a number however Whisper wrote it ("four thousand",
 * "4,000", "4000"). The rules decide the marks; the spelling of a number is the recogniser's.
 */
export function heardForm(text: string): string {
  return text
    .replace(NUMBER_RUN, (run) => {
      const trimmed = run.trim();
      const value = spokenNumber(trimmed);
      return value === null ? run : `${value}${run.endsWith(' ') ? ' ' : ''}`;
    })
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
}

/** A line's shape: its block mark, and the inline marks in it, in order. */
function shapeOf(line: string): string {
  const lead = /^\s*(?:#{1,6} |[-*+] (?:\[[ xX]\] |\([ xX]\) )?|\d+[.)] |>\| ?|> (?:\[![A-Z]+\])?|\||= |---$)?/.exec(line)?.[0] ?? '';
  const marks = line.match(/\*\*|~~|==|%%|\?\?|\^\^|\+\+|\|\||`|\[\[|\]\]|\[\d+\/\d+\]|#[a-z][\w/-]*|!\[voice|\| --- /g) ?? [];
  return `${lead.replace(/[xX]/, 'x')}${marks.join(' ')}`;
}

const lettersOf = (line: string) => line.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

/** How alike two lines' words are, 0 to 1, by edit distance over their letters. */
function wordLikeness(a: string, b: string): number {
  const x = lettersOf(a);
  const y = lettersOf(b);
  if (!x.length && !y.length) return 1;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[y.length]! / Math.max(x.length, y.length);
}

/**
 * Whether a note heard from audio is the note expected, allowing for Whisper mishearing a word or two: every line has
 * the same marks in the same places, and most of its words. The rules are what is tested; the recogniser's
 * vocabulary is not.
 */
export function sameShape(expected: string, actual: string): boolean {
  const want = expected.split('\n');
  const got = actual.split('\n');
  if (want.length !== got.length) return false;
  return want.every((line, i) => shapeOf(line) === shapeOf(got[i]!) && wordLikeness(line, got[i]!) >= 0.6);
}

/** What an outcome gets wrong against its test's expectation, as sentences; empty when it passes. */
export function problems(test: SuiteTest, outcome: Outcome, { heard = false }: { heard?: boolean } = {}): string[] {
  if (heard) {
    const form = (value: unknown): unknown =>
      typeof value === 'string' ? heardForm(value) : Array.isArray(value) ? value.map(form) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, form(v)])) : value;
    const expect = { ...(form(test.expect) as Expectation), match: test.expect.match };
    const note = outcome.note === null ? null : heardForm(outcome.note);
    const notes = Object.fromEntries(Object.entries(outcome.notes).map(([k, v]) => [k, heardForm(v)]));
    // Whole notes are compared by shape; a misheard word in one is Whisper's, not the rules'.
    const out: string[] = [];
    if (expect.note !== undefined && !(expect.note === '' ? (note ?? '') === '' : sameShape(expect.note, note ?? ''))) out.push(`the note is ${JSON.stringify(note ?? '')}, not the shape of ${JSON.stringify(expect.note)}`);
    for (const [title, body] of Object.entries(expect.notes ?? {})) {
      if (!sameShape(body, notes[title] ?? '')) out.push(`"${title}" is ${JSON.stringify(notes[title] ?? '(missing)')}, not the shape of ${JSON.stringify(body)}`);
    }
    const rest = { ...test, expect: { ...expect, note: undefined, notes: undefined } };
    return [...out, ...problems(rest, { ...outcome, note, notes })];
  }
  const out: string[] = [];
  const expect = test.expect;
  const own = outcome.note ?? '';
  const show = (text: string) => JSON.stringify(text);
  if (expect.note !== undefined && own !== expect.note) out.push(`the note is ${show(own)}, not ${show(expect.note)}`);
  if (expect.match && !new RegExp(expect.match).test(own)) out.push(`the note ${show(own)} doesn't match /${expect.match}/`);
  for (const part of expect.contains ?? []) if (!own.includes(part)) out.push(`the note ${show(own)} lacks ${show(part)}`);
  for (const part of expect.lacks ?? []) if (own.includes(part)) out.push(`the note ${show(own)} has ${show(part)}`);
  for (const [title, body] of Object.entries(expect.notes ?? {})) {
    if (outcome.notes[title] !== body) out.push(`"${title}" is ${show(outcome.notes[title] ?? '(missing)')}, not ${show(body)}`);
  }
  for (const [title, parts] of Object.entries(expect.notesContain ?? {})) {
    for (const part of parts) if (!(outcome.notes[title] ?? '').includes(part)) out.push(`"${title}" ${show(outcome.notes[title] ?? '')} lacks ${show(part)}`);
  }
  for (const [title, parts] of Object.entries(expect.notesMatch ?? {})) {
    for (const part of parts) if (!new RegExp(part).test(outcome.notes[title] ?? '')) out.push(`"${title}" ${show(outcome.notes[title] ?? '')} doesn't match /${part}/`);
  }
  for (const [title, parts] of Object.entries(expect.notesLack ?? {})) {
    for (const part of parts) if ((outcome.notes[title] ?? '').includes(part)) out.push(`"${title}" still has ${show(part)}`);
  }
  for (const offer of expect.offers ?? []) if (!outcome.offers.includes(offer)) out.push(`no ${offer} offer (offers: ${outcome.offers.join(', ') || 'none'})`);
  if (expect.newNote === false && outcome.note !== null) out.push(`a new note was made: ${show(own)}`);
  if (expect.stopsWithinMs !== undefined) {
    if (outcome.stoppedAtMs === null) out.push('the recording never stopped by itself');
    else if (outcome.stoppedAtMs - outcome.lastWordsMs > expect.stopsWithinMs) out.push(`it stopped ${outcome.stoppedAtMs - outcome.lastWordsMs} ms after the words`);
  }
  return out;
}
