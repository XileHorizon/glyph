import { enumeration } from './markdown.ts';

/**
 * "New item for AttackFM": putting spoken items into a note's list, not at the
 * bottom of the note.
 *
 * A note's list is the last run of list lines in it (a to-do, a bullet or a
 * numbered line, with any indented lines that continue them). New items go on
 * the end of that run in the run's own style: a to-do list gets "- [ ] ", a
 * numbered list the next number, a bullet list its own bullet, at the run's
 * indent. A note with no list gets one at its end, as to-dos when the command
 * said "task" or "to-do". Pure, so every shape of note is a test.
 */

const ITEM = /^(\s*)(- \[[ xX]\] |[-*+] |(\d{1,3})([.)]) )/;

interface Run {
  /** Index of the run's first and last line. */
  first: number;
  last: number;
  indent: string;
  /** How the run's last top-level item is marked. */
  style: { kind: 'task' } | { kind: 'bullet'; mark: string } | { kind: 'number'; next: number; delimiter: string };
}

/** Every list in `lines`, in order. */
function runsOf(lines: readonly string[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  let fence: string | null = null;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (marker) {
      if (!fence) fence = marker.charAt(0);
      else if (marker.charAt(0) === fence) fence = null;
      i += 1;
      continue;
    }
    if (fence) {
      i += 1;
      continue;
    }
    const head = ITEM.exec(line);
    if (!head) {
      i += 1;
      continue;
    }
    const indent = head[1] ?? '';
    const first = i;
    let last = i;
    let style: Run['style'] = styleOf(head);
    i += 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      const item = ITEM.exec(line);
      if (item && (item[1] ?? '').length >= indent.length) {
        if ((item[1] ?? '').length === indent.length) style = styleOf(item);
        last = i;
        i += 1;
      } else if (line.trim() && /^\s+/.test(line) && (/^\s*/.exec(line)?.[0].length ?? 0) > indent.length) {
        // An indented line under an item continues it.
        last = i;
        i += 1;
      } else {
        break;
      }
    }
    runs.push({ first, last, indent, style });
  }
  return runs;
}

const SMALL_WORDS = new Set('the and for with that this from into onto about have has was were are its our your their them then than just also need needs should will would could can'.split(' '));

/** A text's meaningful words, lowercased, a plural's s dropped. */
function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\]\([^)]*\)/g, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !SMALL_WORDS.has(word))
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)),
  );
}

/**
 * The list that `text` belongs in, when a note has more than one: the one
 * whose heading (or "Label:" line) and items share the most words with it,
 * the heading counting double. No overlap at all, or a tie, means the last
 * list, where a single-list note's items always went.
 */
function runFor(lines: readonly string[], runs: readonly Run[], text: string | undefined): Run | null {
  if (!runs.length) return null;
  const fallback = runs[runs.length - 1]!;
  if (!text || runs.length === 1) return fallback;
  const wanted = keywords(text);
  let best = fallback;
  let bestScore = 0;
  runs.forEach((run, index) => {
    const floor = index > 0 ? runs[index - 1]!.last + 1 : 0;
    let label = '';
    for (let i = run.first - 1; i >= floor; i -= 1) {
      const line = (lines[i] ?? '').trim();
      if (!line) continue;
      if (/^#{1,6}\s/.test(line) || /:\s*$/.test(line)) label = line;
      break;
    }
    const heading = keywords(label);
    const items = keywords(lines.slice(run.first, run.last + 1).join(' '));
    let score = 0;
    for (const word of wanted) score += (heading.has(word) ? 2 : 0) + (items.has(word) ? 1 : 0);
    if (score > bestScore) {
      best = run;
      bestScore = score;
    }
  });
  return best;
}

function styleOf(match: RegExpExecArray): Run['style'] {
  const mark = match[2] ?? '- ';
  if (mark.startsWith('- [')) return { kind: 'task' };
  if (match[3]) return { kind: 'number', next: Number(match[3]) + 1, delimiter: match[4] ?? '.' };
  return { kind: 'bullet', mark: mark.trim() };
}

/** One item's text as a list line: first letter up, no closing full stop. */
export function itemText(text: string): string {
  const trimmed = text.trim().replace(/[\s.,;:]+$/, '');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * `body` with `items` on the end of its last list, or of the list `near`
 * belongs in when it has several. `asTasks` shapes a list that has to be
 * started (a note with no list yet). Answers the new body and
 * the lines added, for showing them land.
 */
export function appendToList(
  body: string,
  items: readonly string[],
  { asTasks = false, near }: { asTasks?: boolean; near?: string } = {},
): { body: string; added: string[] } {
  const texts = items.map(itemText).filter(Boolean);
  if (!texts.length) return { body, added: [] };
  const lines = body.split('\n');
  const run = runFor(lines, runsOf(lines), near);

  if (!run) {
    const added = texts.map((text) => `${asTasks ? '- [ ] ' : '- '}${text}`);
    const base = body.replace(/\s+$/, '');
    return { body: `${base}${base ? '\n\n' : ''}${added.join('\n')}\n`, added };
  }

  let number = run.style.kind === 'number' ? run.style.next : 0;
  const added = texts.map((text) => {
    switch (run.style.kind) {
      case 'task':
        return `${run.indent}- [ ] ${text}`;
      case 'number':
        return `${run.indent}${number++}${run.style.delimiter} ${text}`;
      default:
        return `${run.indent}${run.style.mark} ${text}`;
    }
  });
  const next = [...lines.slice(0, run.last + 1), ...added, ...lines.slice(run.last + 1)];
  return { body: next.join('\n'), added };
}

/** What a spoken note starts with that is not the note: "that", "to", "saying". */
const LEAD_IN = /^\s*(?:(?:that\s+says|which\s+says|that\s+reads|to\s+say|saying)\s+)?(?:(?:that|to)\s+(?=\p{L}))?/iu;

/** A thing to do or a short point, rather than a paragraph: short, and one or two sentences. */
function itemShaped(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/[.!?]+\s+/).filter((part) => part.trim()).length;
  return words <= 30 && sentences <= 2;
}

/** Title-owned defaults when a list has no items yet. */
function semanticListKind(body: string): 'task' | 'bullet' | null {
  const title = (body.split('\n').find((line) => line.trim()) ?? '')
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLowerCase();
  if (/^(?:to\s*-?\s*do|todo|tasks?)$/.test(title)) return 'task';
  if (/^(?:groceries|grocery|shopping|list)$/.test(title)) return 'bullet';
  return null;
}

/**
 * "Leave a note on the page for AttackFM that says the login is broken on
 * Android": `text` put where it belongs in `body`. A note with a list takes it
 * as a new item of that list (the list it fits, when there are several), since
 * a note of lists is a note of items; a long thought, or a note with no list,
 * takes it as its own paragraph at the end. Answers the new body, the lines
 * added and which it was.
 */
export function leaveNote(body: string, text: string, { asParagraph = false } = {}): { body: string; added: string[]; into: 'list' | 'paragraph' } {
  const words = text.replace(LEAD_IN, '').replace(/^["“]+|["”]+$/g, '').trim();
  if (!words) return { body, added: [], into: 'paragraph' };
  const lines = body.split('\n');
  // Asked for as a line (the memo flow's "add a line"), it is one, list or no list.
  if (!asParagraph && runsOf(lines).length && itemShaped(words)) {
    return { ...appendToList(body, [words], { near: words }), into: 'list' };
  }
  const sentence = words.charAt(0).toUpperCase() + words.slice(1);
  const line = /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
  const base = body.replace(/\s+$/, '');
  return { body: `${base}${base ? '\n\n' : ''}${line}\n`, added: [line], into: 'paragraph' };
}

export interface Placing {
  /** "leave": where it fits; "item": a list item; "paragraph": its own paragraph, whatever the note holds. */
  how: 'leave' | 'item' | 'paragraph';
  task: boolean;
  many: boolean;
  near?: string;
  /** Items already told apart by the command: each is one item, commas and all. */
  items?: readonly string[];
}

/**
 * Spoken words put into a note the way a command asked: "leave" where they fit
 * (`leaveNote`), "item" as list items, split on commas or "and" when there are
 * several. What the recorder shows before asking, and what it does after a yes,
 * are both this, so the preview is the result.
 */
export function placeWords(body: string, spoken: string, { how, task, many, near, items: told }: Placing): { body: string; added: string[]; into: 'list' | 'paragraph' } {
  const semantic = semanticListKind(body);
  if (how === 'item' && told?.length) return { ...appendToList(body, told, { asTasks: task || semantic === 'task', near }), into: 'list' };
  if (how === 'paragraph') return leaveNote(body, spoken, { asParagraph: true });
  if (how === 'leave' && !semantic) return leaveNote(body, spoken);
  // Several said one after another arrive joined with commas: each is an item, two as much as five.
  const explicit = many && /,/.test(spoken) ? spoken.split(/\s*,\s*/).filter(Boolean) : null;
  const listed = explicit ?? (many || /,/.test(spoken) ? enumeration(`Items: ${spoken}`)?.items : null);
  const items = listed?.length ? listed : [spoken];
  return { ...appendToList(body, items, { asTasks: task || semantic === 'task', near }), into: 'list' };
}

export type InstructionArea = 'bugs' | 'tasks' | 'list' | 'notes' | null;

/**
 * Places an inferred append inside an explicitly named Markdown section. Only
 * the section slice is rewritten; front matter, other headings, tables, HTML,
 * and fenced code stay byte-for-byte unchanged.
 */
export function placeInstruction(
  body: string,
  content: string,
  area: InstructionArea,
): { body: string; added: string[]; into: 'list' | 'paragraph' } {
  if (!area) {
    const semantic = semanticListKind(body);
    if (semantic) return { ...appendToList(body, [content], { asTasks: semantic === 'task', near: content }), into: 'list' };
    return leaveNote(body, content);
  }
  if (area === 'notes') return leaveNote(body, content);
  const lines = body.split('\n');
  const wanted = area === 'list' ? /\b(?:list|items?)\b/i : area === 'bugs' ? /\b(?:bugs?|issues?|defects?)\b/i : /\b(?:tasks?|to-?dos?|actions?)\b/i;
  let fence: string | null = null;
  let heading = -1;
  let level = 7;
  let end = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (marker) {
      if (!fence) fence = marker.charAt(0);
      else if (marker.charAt(0) === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const currentLevel = match[1]?.length ?? 7;
    if (heading < 0 && wanted.test(match[2] ?? '')) {
      heading = i;
      level = currentLevel;
    } else if (heading >= 0 && currentLevel <= level) {
      end = i;
      break;
    }
  }
  if (heading < 0) return { ...appendToList(body, [content], { asTasks: area === 'tasks', near: area }), into: 'list' };
  const section = lines.slice(heading + 1, end).join('\n');
  const placed = appendToList(section, [content], { asTasks: area === 'tasks', near: area });
  const replacement = placed.body.split('\n');
  const next = [...lines.slice(0, heading + 1), ...replacement, ...lines.slice(end)];
  return { body: next.join('\n'), added: placed.added, into: 'list' };
}
