import { appendToList, leaveNote } from '../capture/listAppend.ts';
import { matchNote } from '../capture/route.ts';

/**
 * The reviewing model's answer, made safe to act on.
 *
 * The model is asked for a JSON array (review/prompt.ts), and a small model
 * sometimes wraps it in a fence, adds a sentence, or leaves a trailing comma,
 * so the array is dug out leniently. Then every finding has to earn its place:
 * a known check, a note that exists, and a `find` that is really in that note
 * (exactly, or once whitespace and case are forgiven). A finding that fails is
 * dropped, so the person is never asked to accept a change to text that isn't
 * there. What is left is applied only when the person commits (`applyFindings`).
 */

export type Check = 'words' | 'structure' | 'commands' | 'names';

export interface NoteText {
  id: string;
  title: string;
  body: string;
}

export interface Finding {
  id: string;
  check: Check;
  what: string;
  why: string;
  noteId: string;
  noteTitle: string;
  /** Replace `find` (exactly as it is in the note) with `replace`, or add `add` as a line. */
  change: { kind: 'replace'; find: string; replace: string } | { kind: 'add'; line: string };
}

const CHECKS: readonly Check[] = ['words', 'structure', 'commands', 'names'];

/** The JSON array in a model's answer, or [] when there is none to read. */
export function readArray(answer: string): unknown[] {
  const text = answer.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  const raw = text.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Where `find` is in `body`: exactly, or with whitespace and case forgiven. Answers the text as it is in the body. */
export function locate(body: string, find: string): string | null {
  return locateLast(body, find)?.text ?? null;
}

/**
 * The LAST place `find` is in `body`, and its text there. A recording's words
 * are the newest in their note, at its end, so when the same words are in a
 * note twice the one just said is the later one.
 */
export function locateLast(body: string, find: string): { index: number; text: string } | null {
  if (!find.trim()) return null;
  const exact = body.lastIndexOf(find);
  if (exact >= 0) return { index: exact, text: find };
  const pattern = find
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  let last: { index: number; text: string } | null = null;
  for (const found of body.matchAll(new RegExp(pattern, 'gi'))) last = { index: found.index ?? 0, text: found[0] };
  return last;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * The findings worth showing: validated against the notes, one per change.
 * `self` is the note reviewed; `others` are notes a finding may name.
 */
export function readFindings(answer: string, self: NoteText, others: readonly NoteText[]): Finding[] {
  const notes = [self, ...others.filter((n) => n.id !== self.id)];
  const seen = new Set<string>();
  const out: Finding[] = [];
  readArray(answer).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const raw = item as Record<string, unknown>;
    const check = text(raw.check).toLowerCase() as Check;
    if (!CHECKS.includes(check)) return;
    const named = text(raw.note);
    const note = !named || matchNote(named, [self], { threshold: 0.6, margin: 0 }) ? self : (matchNote(named, notes, { threshold: 0.72, margin: 0.05 })?.note ?? null);
    if (!note) return;
    const what = text(raw.what) || 'A change';
    const why = text(raw.why);
    const add = text(raw.add);
    let change: Finding['change'];
    if (add && !text(raw.find)) {
      if (note.body.includes(add)) return;
      change = { kind: 'add', line: add };
    } else {
      const located = locate(note.body, typeof raw.find === 'string' ? raw.find : '');
      const replace = typeof raw.replace === 'string' ? raw.replace : null;
      if (!located || replace === null || replace.trim() === located.trim()) return;
      change = { kind: 'replace', find: located, replace };
    }
    const key = `${note.id}|${change.kind === 'add' ? change.line : `${change.find}→${change.replace}`}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: `f${index}`, check, what, why, noteId: note.id, noteTitle: note.title, change });
  });
  return out;
}

/** A line added to a note: a list item joins its list, anything else goes where it fits. */
function addLine(body: string, line: string): string {
  const item = /^\s*(- \[[ xX]\] |[-*+] |\d+[.)] )(.*)$/.exec(line);
  if (item) return appendToList(body, [item[2] ?? ''], { asTasks: /\[/.test(item[1] ?? '') }).body;
  return leaveNote(body, line).body;
}

/**
 * The notes with the accepted findings applied, in order. A replace whose
 * text is no longer there (an earlier finding changed it) is skipped, not
 * forced. Answers only the notes that changed.
 */
export function applyFindings(notes: readonly NoteText[], findings: readonly Finding[]): Map<string, string> {
  const bodies = new Map(notes.map((n) => [n.id, n.body]));
  const changed = new Map<string, string>();
  for (const finding of findings) {
    const body = bodies.get(finding.noteId);
    if (body === undefined) continue;
    let next: string;
    if (finding.change.kind === 'add') next = addLine(body, finding.change.line);
    else {
      const at = locateLast(body, finding.change.find);
      if (!at) continue;
      next = body.slice(0, at.index) + finding.change.replace + body.slice(at.index + at.text.length);
    }
    if (next !== body) {
      bodies.set(finding.noteId, next);
      changed.set(finding.noteId, next);
    }
  }
  return changed;
}
