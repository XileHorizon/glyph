import { finalCommandWords, stripStopCue } from './command.ts';

/**
 * Where in a finished recording a command is, if anywhere.
 *
 * Kevin: "I need it to be more conversational and scan the whole text for
 * potential command words, and then attempt to reason what the intended end
 * goal is". The gate used to read only the first word, so "Let's add…",
 * "So I was thinking, can you make me a list called…" and "Throw eggs on my
 * groceries" were all saved as notes of their own words.
 *
 * Now every place a request could start is looked at: a verb that changes
 * notes (add, put, make, create, start, throw, stick, jot down…), optionally
 * with the words people put in front of one ("can you", "let's", "go ahead
 * and", "I want you to"). A verb alone is not a command - "I need to make
 * dinner" and "I want to add more tomorrow" are dictation - so each one needs
 * evidence in what follows it: a list or note word, "called/named/labeled",
 * or the title of one of the person's notes. A request someone else was given
 * ("I told Sam to add…", or inside quotes) is reported speech, not a command.
 *
 * `anchored` says the recording starts with the command (the old gate). A
 * command found later in the recording is `conversational`: when it cannot be
 * carried out, or the person declines it, the recording is kept as a note
 * rather than thrown away, because it may well have been dictation.
 */

export interface CommandScan {
  /** The words from the request's verb on: what the rules read. */
  words: string;
  /** The whole recording, lead-in gone: what the model reasons over. */
  context: string;
  /** The recording starts with the command. */
  anchored: boolean;
}

/** "really", "just": words people put inside a request. */
const FILLER = String.raw`(?:(?:really|just|also|actually|quickly|please)\s+)?`;
const REQUEST = String.raw`(?:(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:go\s+ahead\s+and\s+)?|please\s+(?:go\s+ahead\s+and\s+)?|let'?s\s+(?:go\s+ahead\s+and\s+)?|go\s+ahead\s+and\s+|i\s+${FILLER}(?:want|need|would\s+like|'d\s+like)\s+(?:you\s+)?to\s+|i'?d\s+like\s+(?:you\s+)?to\s+))?${FILLER}`;
const VERB = String.raw`(?:add|put|append|make|create|start|throw|stick|toss|include|insert|jot(?:\s+down)?|write\s+down|save)`;
/** "Can you add", "let's make", "throw": where a command could begin. The verb is group 1. */
const CUE = new RegExp(String.raw`(?:^|[\s,.;:!?"“”])${REQUEST}(${VERB})\b`, 'gi');
/** "I need a list of…", "I want a new note called…": a request with no verb of its own. */
const NEED = /(?:^|[\s,.;:!?])(?:i\s+(?:(?:really|just|also|actually)\s+)?(?:need|want|would\s+like|'d\s+like)|give\s+me|can\s+i\s+(?:get|have))\s+(?:a\s+)?(?:new\s+)?(list|note|checklist|to-?\s?do\s+list)\b/gi;

/** Something to do with notes follows the verb. */
const NOTE_WORDS = /\b(?:list|lists|note|notes|page|checklist|to-?\s?do(?:s|\s+list)?|called|named|titled|label(?:ed|led))\b/i;
/** How far after the verb its evidence may be, in words. */
const EVIDENCE_WORDS = 14;
/** Someone else was asked, or it is quoted: "I told Sam to add…". */
const REPORTED = /\b(?:told|tell|tells|said|say|says|asked|ask|asks|he|she|they|him|her|them)\b|["“]/i;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` names one of `titles` as whole words. */
function namesATitle(text: string, titles: readonly string[]): boolean {
  return titles.some((title) => {
    const words = title.trim().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (words.length < 2) return false;
    return new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${words.split(' ').map(escape).join(String.raw`[\s\p{P}]+`)}(?=$|[^\p{L}\p{N}])`, 'iu').test(text);
  });
}

/** The sentence `text` is in, up to `at`: what was said just before a cue. */
function sentenceBefore(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('!', at - 1), text.lastIndexOf('?', at - 1)) + 1;
  return text.slice(start, at);
}

/** The command in a finished recording, or null when it is dictation. */
export function scanForCommand(transcript: string, titles: readonly string[]): CommandScan | null {
  const text = stripStopCue(transcript.trim());
  const anchored = finalCommandWords(text);
  if (anchored !== null) return { words: anchored, context: anchored, anchored: true };

  const found: { at: number; words: string }[] = [];
  for (const cue of text.matchAll(CUE)) {
    const verbAt = (cue.index ?? 0) + cue[0].length - (cue[1]?.length ?? 0);
    found.push({ at: cue.index ?? 0, words: text.slice(verbAt) });
  }
  for (const need of text.matchAll(NEED)) {
    // "I need a list of movies…" reads as "make a list of movies…".
    const nounAt = (need.index ?? 0) + need[0].length - (need[1]?.length ?? 0);
    found.push({ at: need.index ?? 0, words: `make a ${text.slice(nounAt)}` });
  }
  found.sort((a, b) => a.at - b.at);

  for (const { at, words } of found) {
    if (REPORTED.test(sentenceBefore(text, at + 1))) continue;
    const head = words.split(/\s+/).slice(0, EVIDENCE_WORDS).join(' ');
    if (!NOTE_WORDS.test(head) && !namesATitle(head, titles)) continue;
    const command = words.trim();
    return { words: command, context: text, anchored: false };
  }
  return null;
}
