/**
 * The plan behind words that arrive from smoke (art/WispText.tsx): what a
 * text is made of, which words a new text keeps and which it swaps, and when
 * each letter moves. Pure, so every shape of change is a test; the drawing
 * (the SVG turbulence on each settling letter) lives with the component.
 *
 * Matt: "get the animation added to our text component through a helper and
 * make it consider character by character animations and have it swap around
 * entire words". So a text is words and the gaps between them; a change from
 * one text to another is worked out word by word (the longest common run of
 * words stays put, the rest leave and arrive), and within a word the letters
 * go one at a time, at a hand's pace.
 */

export interface Token {
  kind: 'word' | 'gap';
  text: string;
}

/** Words and the whitespace between them, in order; the text is their join. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const piece of text.split(/(\s+)/)) {
    if (!piece) continue;
    tokens.push({ kind: /^\s+$/.test(piece) ? 'gap' : 'word', text: piece });
  }
  return tokens;
}

/** Word-level diff: for each old word whether it stays, for each new word whether it was there. */
export interface WordDiff {
  /** Old token index → new token index, for the words that stay. */
  kept: Map<number, number>;
  /** Old token indices of words that leave, in reading order. */
  gone: number[];
  /** New token indices of words that arrive, in reading order. */
  arriving: number[];
}

/**
 * Which words of `from` are still in `to`, as the longest run of words common
 * to both in the same order, so "Hold. Talk. Done." to "Hold. Talk. Write."
 * keeps the first two and swaps the last, and a word moved elsewhere in the
 * sentence leaves and arrives again rather than sliding.
 */
export function diffWords(from: Token[], to: Token[]): WordDiff {
  const a = from.map((t, i) => (t.kind === 'word' ? i : -1)).filter((i) => i >= 0);
  const b = to.map((t, i) => (t.kind === 'word' ? i : -1)).filter((i) => i >= 0);
  const same = (i: number, j: number) => from[a[i]!]!.text === to[b[j]!]!.text;
  // Longest common subsequence over the words, bottom-up.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = same(i, j) ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const kept = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(i, j)) {
      kept.set(a[i]!, b[j]!);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const keptNew = new Set(kept.values());
  return {
    kept,
    gone: a.filter((index) => !kept.has(index)),
    arriving: b.filter((index) => !keptNew.has(index)),
  };
}

/** One letter's moment: which word, which letter, and when, in milliseconds from the start of its phase. */
export interface Step {
  token: number;
  char: number;
  at: number;
}

/**
 * The pace of a hand: letters a little uneven, a breath after a comma, longer
 * after a full stop, longer still at a line break, and a beat before a
 * capital. `random` is injectable so the plan is testable.
 */
export function cadence(lettersPerSecond: number, random: () => number = Math.random): (ch: string, next: string) => number {
  const base = 1000 / lettersPerSecond;
  return (ch, next) => {
    let wait = base * (0.7 + random() * 0.6);
    if (ch === ',' || ch === ';') wait += base * 2.5;
    if (ch === '.' || ch === '!' || ch === '?') wait += base * 5;
    if (ch === '\n') wait += base * 6;
    if (/\s/.test(ch) && next && /[A-Z]/.test(next)) wait += base * 0.8;
    return wait;
  };
}

/**
 * When each letter of the arriving words appears, in reading order, at the
 * cadence; a gap between words is a pause, not a letter. Words that stay are
 * already there and take no time.
 */
export function arrivals(tokens: Token[], arriving: readonly number[], wait: (ch: string, next: string) => number): Step[] {
  const coming = new Set(arriving);
  const steps: Step[] = [];
  let at = 0;
  const nextChar = (token: number, char: number): string => {
    const here = tokens[token];
    if (here && char + 1 < here.text.length) return here.text[char + 1] ?? '';
    return tokens[token + 1]?.text[0] ?? '';
  };
  let lastWasNew = false;
  tokens.forEach((token, index) => {
    if (token.kind === 'gap') {
      // A pause at a gap only when letters were just placed before it, or come right after.
      const beforeNew = lastWasNew;
      const afterNew = coming.has(index + 1);
      if (beforeNew || afterNew) at += wait(token.text, nextChar(index, token.text.length - 1));
      lastWasNew = false;
      return;
    }
    if (!coming.has(index)) {
      lastWasNew = false;
      return;
    }
    [...token.text].forEach((ch, char) => {
      steps.push({ token: index, char, at });
      at += wait(ch, nextChar(index, char));
    });
    lastWasNew = true;
  });
  return steps;
}

/**
 * When each letter of the leaving words goes: the last letter first, the way
 * a word is untyped, a fixed beat apart and quicker than arriving, so a swap
 * reads as one motion: out, then in.
 */
export function departures(tokens: Token[], gone: readonly number[], gapMs = 34): Step[] {
  const steps: Step[] = [];
  let at = 0;
  for (const index of [...gone].reverse()) {
    const token = tokens[index];
    if (!token) continue;
    for (let char = token.text.length - 1; char >= 0; char -= 1) {
      steps.push({ token: index, char, at });
      at += gapMs;
    }
  }
  return steps;
}

/** The whole change from one text to another: what leaves, then what arrives, each with its timing. */
export function planSwap(fromText: string, toText: string, wait: (ch: string, next: string) => number, outGapMs = 34): { from: Token[]; to: Token[]; diff: WordDiff; out: Step[]; in: Step[] } {
  const from = tokenize(fromText);
  const to = tokenize(toText);
  const diff = diffWords(from, to);
  return { from, to, diff, out: departures(from, diff.gone, outGapMs), in: arrivals(to, diff.arriving, wait) };
}

/** How long a run of steps takes, once the last letter's own settling (`settleMs`) is over. */
export function runLength(steps: readonly Step[], settleMs: number): number {
  return steps.length ? (steps[steps.length - 1]?.at ?? 0) + settleMs : 0;
}
