import type { WordChange } from './diff.ts';

/**
 * What the reviewing model is told, and what it is shown.
 *
 * The review runs after a recording with reasoning ON (core/ai.ts `think`),
 * and its thinking is streamed to the screen as it happens: Matt asked to see
 * "the AI reasoning dissecting and parsing the note". So the prompt asks for
 * the checking to be done in the thinking, and for the answer to be nothing
 * but the findings, in a small JSON shape a 4B model writes reliably. Every
 * finding must quote text that is really in a note, or it is thrown away
 * (review/findings.ts), so a model that invents a problem cannot invent a fix.
 *
 * `src-tauri/src/llm/tests.rs` reads REVIEW_PROMPT out of this file, so what
 * the Mac measures is what the phone sends. Keep it a `String.raw` literal.
 */

export const REVIEW_PROMPT = String.raw`You check a voice note that a fast pipeline just wrote, inside Ghost.md, a notes app. A small speech model transcribed what the person said as they said it, simple rules turned spoken cues into markdown (lists, headings, to-dos, tables), and voice commands that start with "Ghost.md" moved words into other notes. You are the careful second look. You are given the note as saved, what the fast speech model heard, what a slower and more accurate speech model heard, where those two disagree, the commands that ran, and the titles of the person's notes.

Think it through first, before you answer, but briefly: a few short lines for each check, no drafts, no second-guessing. Check four things:
1. Words: where the two transcripts disagree, which is right? The slower model is usually right about sounds; the fast one is sometimes right about names the person has used before. Only a real mistake counts, not punctuation or casing.
2. Structure: is each list, heading, to-do and table what the person meant? A to-do that should be a plain sentence, items that should be one list, a heading that is really a sentence.
3. Commands: set the words of each "hey Ghost" command in what was heard beside what the command did. If the person named one note and the words went to another, that is a mistake: say so, and add the line to the note they named. Also: nothing lost, nothing added twice, no command words left in a note.
4. Names and terms: people, projects and features spelled the way the person's note titles and project notes spell them.

Then answer with ONLY a JSON array of findings, and nothing else. Each finding is an object:
{"check": "words" | "structure" | "commands" | "names", "what": "a short title", "why": "one plain sentence", "note": "the title of the note to change, or omit for this note", "find": "text copied exactly from that note", "replace": "what that text should be"}
To add a line to a note instead of changing text, give "add" (the line) and no "find" or "replace".

Rules: "find" must be copied character for character from the note it names. Keep each change as small as the mistake. Nothing the person did not say. No finding for style. If everything is right, answer [].`;

export interface ReviewInput {
  title: string;
  /** The note as the recording left it. */
  body: string;
  /** What the fast model heard, phrase by phrase, commands included. */
  heard: string;
  /** What the careful model heard, or null when it could not listen again. */
  careful: string | null;
  changes: readonly WordChange[];
  /** The commands the recording ran, in words: "Added “Fix the seek bar” to HelloTrade's list". */
  commands: readonly string[];
  /** The person's note titles, for names and for where commands went. */
  titles: readonly string[];
  /** Other notes a command changed: their titles and bodies, so a finding can quote them. */
  touched: readonly { title: string; body: string }[];
}

/** The user message: every piece labelled, the note last so it is freshest. */
export function reviewMessage(input: ReviewInput): string {
  const sections: string[] = [];
  sections.push(`WHAT THE FAST SPEECH MODEL HEARD:\n${input.heard.trim() || '(nothing)'}`);
  if (input.careful !== null) sections.push(`WHAT THE SLOWER, MORE ACCURATE SPEECH MODEL HEARD:\n${input.careful.trim() || '(nothing)'}`);
  if (input.changes.length) {
    sections.push(
      `WHERE THEY DISAGREE (fast → slower):\n${input.changes
        .slice(0, 40)
        .map((c) => `- …${c.before} [${c.heard || '∅'} → ${c.careful || '∅'}] ${c.after}…`)
        .join('\n')}`,
    );
  } else if (input.careful !== null) {
    sections.push('WHERE THEY DISAGREE: nowhere.');
  }
  sections.push(`COMMANDS THAT RAN:\n${input.commands.length ? input.commands.map((c) => `- ${c}`).join('\n') : '(none)'}`);
  sections.push(`THE PERSON'S NOTE TITLES:\n${input.titles.slice(0, 60).join(' · ') || '(none)'}`);
  for (const other of input.touched) sections.push(`OTHER NOTE A COMMAND CHANGED, "${other.title}":\n${other.body.trim()}`);
  sections.push(`THIS NOTE, "${input.title}", AS SAVED:\n${input.body.trim()}`);
  return sections.join('\n\n');
}

/**
 * How long the model may think, and how much it may write in all. A 4B model
 * left to itself reasons for thousands of tokens on a small note (measured on
 * the Mac: past 2,400 without answering), which is minutes on a phone, so the
 * thought is closed for it at a budget (native `think_budget`) and the answer
 * gets its own room after. Bigger models think more per token, so they get less.
 */
export function reviewBudget(model: string, chars: number): { think: number; total: number } {
  const think = /9b/.test(model) ? 500 : /2b/.test(model) ? 600 : 700;
  const answer = Math.min(1200, 500 + Math.ceil(chars / 12));
  return { think, total: Math.min(4096, think + answer) };
}
