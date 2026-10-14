import { generate, listModels, type ModelInfo } from '../core/ai.ts';
import { matchNote, type Candidate } from './route.ts';
import type { Plan } from './command.ts';
import { interpretWakeCommand } from './instructionIntent.ts';
import { literalMarkdown } from './instructionMutation.ts';

/**
 * The second pass on a spoken command: a small language model on the phone reads what was said after "Glyph" when
 * the rules in capture/command.ts could not.
 *
 * Matt: "it feels like the model for doing the agentic tasks should be different than the language parsing model, we
 * might need two different AI passes, I can't even pass the tutorial". Speech is still read two ways, and they stay
 * separate: Whisper writes the words and the rules find the marks in them (fast, the same every time, nothing
 * guessed), and only a command, which is an action on another note, gets a model. It runs when the rules have no plan
 * for the words ("add oat milk to the shopping thing", a misheard name, a phrasing the rules never learned), never
 * on plain speech, and what it answers is checked like anything else: the note must be one of the person's notes,
 * matched by title the way the rules match a spoken name, and the recorder still asks "shall I?" before anything
 * changes. An answer that is not a command, or that names no note there is, is no answer.
 *
 * The prompt is a `String.raw` literal so `src-tauri/src/llm/tests.rs` can read it and measure the phone's models on
 * the Mac against the same words. Qwen3.5 4B runs it when it is on the phone, else 2B (`commandModelOf`). It runs
 * only in a pause and is cancelled when speech resumes (capture/CaptureScreen.tsx): it shares the phone's cores with
 * Whisper, and is not loaded ahead of time for the same reason, so the first command of a launch waits on the load.
 */

export const COMMAND_PROMPT = String.raw`You read one spoken command for Ghost.md, a notes app, and answer with JSON. The person said "hey Ghost" (or "Glyph") and then the command. It was written down by speech recognition, so words can be misheard and a note's name can come out spelled or split differently.

Answer with exactly one JSON object on one line, and nothing else. It is one of:
{"action":"add","note":"<a title from the list>","text":"<what to add>","item":false,"task":false}
{"action":"switch","note":"<a title from the list>"}
{"action":"new"}
{"action":"table","note":"<a title from the list, or empty for the note being recorded>","columns":["<label>"]}
{"action":"none"}

- add: put words into a note. "text" is only the thing to add, in their words, without the command or the note's name. "item" is true when they ask for a list item, bullet, point or entry; "task" is true when they ask for a task, to-do or check box.
- switch: carry on recording in that note ("switch to", "go to", "move this to").
- new: start a new note.
- table: add a table. "columns" are the column labels if they said them, otherwise [].
- none: it is not one of these, or you are not sure which note they mean.

"note" is copied exactly from the list of notes. Choose the note whose title is what they said, allowing for misheard words. If no title fits, answer {"action":"none"}. Never invent a note, and never add words they did not say.

Examples, with the notes Groceries, Work and Weekend trip:
Command: Put call Sam on the work list.
{"action":"add","note":"Work","text":"call Sam","item":true,"task":false}
Command: For the weekend trip, book the ferry.
{"action":"add","note":"Weekend trip","text":"book the ferry","item":false,"task":false}
Command: New to-do for work, send the invoice.
{"action":"add","note":"Work","text":"send the invoice","item":true,"task":true}
Command: Switch to groceries.
{"action":"switch","note":"Groceries"}
Command: New note.
{"action":"new"}
Command: Add a table with columns name and date.
{"action":"table","note":"","columns":["name","date"]}
Command: Add eggs to the camping list.
{"action":"none"}`;

/** The question for one command: the person's note titles, then what was said. */
export function commandMessage(words: string, titles: readonly string[]): string {
  const list = titles.length ? titles.map((title) => `- ${title}`).join('\n') : '(none)';
  return `Notes:\n${list}\n\nCommand: ${words.trim()}`;
}

interface Answer {
  action?: unknown;
  note?: unknown;
  text?: unknown;
  item?: unknown;
  task?: unknown;
  columns?: unknown;
}

/** The first JSON object in the model's answer, if it wrote one. */
function objectIn(output: string): Answer | null {
  const cleaned = output.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (quoted) {
      if (ch === '\\') i += 1;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && (depth -= 1) === 0) {
      try {
        const value = JSON.parse(cleaned.slice(start, i + 1)) as unknown;
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Answer) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * The model's answer as a plan the recorder already knows how to confirm, or null: not JSON, not a command, or a note
 * that is not one of `notes`. The note is found again by title, so an answer that copied it slightly wrong still
 * lands on the right note and one that made a note up lands on none.
 */
export function readCommandAnswer<N extends Candidate>(output: string, notes: readonly N[]): Plan<N> | null {
  const answer = objectIn(output);
  if (!answer) return null;
  const action = text(answer.action).toLowerCase();
  const find = (value: unknown): N | null => {
    const name = text(value);
    if (!name) return null;
    return notes.find((note) => note.title.trim().toLowerCase() === name.toLowerCase()) ?? matchNote(name, notes)?.note ?? null;
  };
  if (action === 'new') return { kind: 'new' };
  if (action === 'switch') {
    const note = find(answer.note);
    return note ? { kind: 'move', note } : null;
  }
  if (action === 'add') {
    const note = find(answer.note);
    const words = text(answer.text).replace(/[\s.,;:!?]+$/, '');
    if (!note || !words) return null;
    const task = answer.task === true;
    return { kind: 'place', note, text: words, how: task || answer.item === true ? 'item' : 'leave', task, many: false, target: null };
  }
  if (action === 'table') {
    const named = text(answer.note);
    const note = named ? find(named) : null;
    if (named && !note) return null;
    const columns = Array.isArray(answer.columns) ? answer.columns.map(text).filter(Boolean).slice(0, 8) : [];
    return { kind: 'table', note, columns };
  }
  return null;
}

/**
 * Which model reads commands, best first. Measured on the Mac with `llm::tests::understands_spoken_commands`, 24
 * commands as speech recognition writes them: Qwen3.5 4B had 23 right at about 1.3 s each, 2B had 20 at 0.5 s, and
 * 0.8B had 6, so it is not offered. Every miss of the two was "none", which leaves the words in the note, never a
 * wrong note. The larger two are slow for a question a person is waiting on, so they come last.
 */
const COMMAND_MODELS = ['qwen3.5-4b', 'qwen3.5-2b', 'gemma-4-e4b', 'qwen3.5-9b'];

/** The best command model on the phone, or null with none downloaded. */
export function commandModelOf(models: readonly ModelInfo[]): string | null {
  const present = new Set(models.filter((model) => model.present).map((model) => model.id));
  return COMMAND_MODELS.find((id) => present.has(id)) ?? null;
}

/**
 * The model the command pass runs on; null in a browser or with none downloaded. Looked up as each recording opens,
 * so a model downloaded or removed since is seen.
 */
export function commandModel(): Promise<string | null> {
  return listModels()
    .then(commandModelOf)
    .catch(() => null);
}

/** How long a command waits on the model before the rules' answer stands. */
export const UNDERSTAND_MS = 12_000;

export interface Understanding<N extends Candidate> {
  /** The plan, or null when the model had none, or there was no model. */
  done: Promise<Plan<N> | null>;
  cancel: () => void;
}

/** Asks the phone's command model what `words` would have Glyph do, among `notes`. */
/**
 * Constrained instruction fallback for command-shaped capture utterances. The
 * deterministic parser still wins inside `interpretWakeCommand`; inferred
 * strings are escaped and mapped back into application-owned placement rules.
 */
export function understandInstructionCommand<N extends Candidate>(words: string, notes: readonly N[]): Understanding<N> {
  const run = interpretWakeCommand(words, { notes });
  return {
    cancel: run.cancel,
    done: run.done.then((read): Plan<N> | null => {
      if (read.source === 'deterministic') return read.plan;
      if (read.source !== 'inferred') return null;
      if (read.intent.action === 'create') {
        return read.intent.content === null ? { kind: 'create-list', title: read.intent.target } : null;
      }
      if (!('note' in read)) return null;
      const placement = read.intent.placement;
      return {
        kind: 'place',
        note: read.note,
        text: literalMarkdown(read.intent.content),
        how: placement === 'notes' ? 'paragraph' : placement === 'bugs' || placement === 'tasks' || placement === 'list' ? 'item' : 'leave',
        task: placement === 'tasks',
        many: false,
        target: null,
        ...(placement === 'bugs' ? { near: 'bugs' as const } : {}),
      };
    }),
  };
}

export function understandCommand<N extends Candidate>(words: string, notes: readonly N[]): Understanding<N> {
  let cancelled = false;
  let stop: (() => void) | null = null;
  const done = (async () => {
    const model = await commandModel();
    if (!model || cancelled) return null;
    const run = generate({
      model,
      system: COMMAND_PROMPT,
      prompt: commandMessage(
        words,
        notes.map((note) => note.title).filter((title) => title.trim()),
      ),
      maxTokens: 96,
      temperature: 0,
      onProgress: () => undefined,
    });
    stop = run.cancel;
    const timer = window.setTimeout(run.cancel, UNDERSTAND_MS);
    try {
      const output = await run.done;
      return cancelled ? null : readCommandAnswer(output.text, notes);
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      stop?.();
    },
  };
}
