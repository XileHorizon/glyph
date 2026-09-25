/**
 * Where the fast speech model and the careful one heard different words.
 *
 * The live transcript comes from a small model that keeps up with speech; the
 * review listens again with a larger one (capture/refine.ts). The places they
 * disagree are where the fast one most likely slipped, and they are what the
 * reviewing model is shown first. A word-level diff (longest common
 * subsequence over normalised words) grouped into runs, each with a little
 * context either side so a run can be found again in the note.
 */

export interface WordChange {
  /** What the fast model wrote, as written. Empty when the careful one heard words the fast one missed. */
  heard: string;
  /** What the careful model wrote. Empty when the fast one wrote words that were not said. */
  careful: string;
  /** A few words before the change, from the fast transcript, to place it. */
  before: string;
  after: string;
}

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

/** Words and the spaces between them, so a run can be joined back as it was written. */
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** The runs where `fast` and `careful` differ, ignoring case and punctuation. */
export function wordChanges(fast: string, careful: string, context = 3): WordChange[] {
  const a = wordsOf(fast);
  const b = wordsOf(careful);
  const na = a.map(norm);
  const nb = b.map(norm);
  // LCS table, small: a take is hundreds of words, not thousands.
  const rows = na.length + 1;
  const cols = nb.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = na.length - 1; i >= 0; i -= 1) {
    for (let j = nb.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = na[i] === nb[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const changes: WordChange[] = [];
  let i = 0;
  let j = 0;
  while (i < na.length || j < nb.length) {
    if (i < na.length && j < nb.length && na[i] === nb[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const startA = i;
    const startB = j;
    while ((i < na.length || j < nb.length) && !(i < na.length && j < nb.length && na[i] === nb[j])) {
      if (j >= nb.length || (i < na.length && table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!)) i += 1;
      else j += 1;
    }
    const heard = a.slice(startA, i).join(' ');
    const careful = b.slice(startB, j).join(' ');
    // The same words once case and punctuation go; "hello trade" and "HelloTrade" still differ.
    if (na.slice(startA, i).join(' ') === nb.slice(startB, j).join(' ')) continue;
    changes.push({
      heard,
      careful,
      before: a.slice(Math.max(0, startA - context), startA).join(' '),
      after: a.slice(i, i + context).join(' '),
    });
  }
  return changes;
}
