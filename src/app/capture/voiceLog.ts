import { useSyncExternalStore } from 'react';

/**
 * What happened to each finished recording, step by step, kept on the phone:
 * the transcript Whisper wrote, which step decided (the rules, the model's
 * sort, its plan), the model's raw answers, what the checks dropped, and what
 * the person chose on the card. Settings › Recording › Voice log shows it and
 * copies it, so a recording that went wrong can be read back exactly instead
 * of remembered.
 *
 * Local only (localStorage), the last `KEEP` recordings. Nothing is sent anywhere.
 */

export interface VoiceLogEntry {
  /** When Done was pressed; also the entry's id. */
  at: number;
  transcript: string;
  steps: string[];
  /** The decision, then what the person did with it. */
  outcome: string;
}

const KEY = 'glyph-voice-log';
const KEEP = 40;
const listeners = new Set<() => void>();
let cache: VoiceLogEntry[] | null = null;

function read(): VoiceLogEntry[] {
  if (cache) return cache;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    cache = Array.isArray(value) ? (value as VoiceLogEntry[]).filter((entry) => entry && typeof entry.at === 'number') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(entries: VoiceLogEntry[]): void {
  cache = entries.slice(0, KEEP);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // No storage: the log lasts as long as the app does.
  }
  for (const listener of listeners) listener();
}

export interface VoiceTrace {
  readonly at: number;
  /** One line of what happened. */
  step: (line: string) => void;
  /** The decision; written to the log. */
  decide: (outcome: string) => void;
}

/** A new entry for the recording just finished. */
export function traceRecording(transcript: string, now = Date.now()): VoiceTrace {
  const entry: VoiceLogEntry = { at: now, transcript: transcript.slice(0, 4_000), steps: [], outcome: 'deciding' };
  const save = () => write([entry, ...read().filter((other) => other.at !== entry.at)]);
  return {
    at: now,
    step: (line) => {
      entry.steps.push(line.slice(0, 1_500));
    },
    decide: (outcome) => {
      entry.outcome = outcome;
      save();
    },
  };
}

/** What the person did with the card: confirmed, cancelled, kept as a note. */
export function settleRecording(at: number, what: string): void {
  const entries = read();
  const entry = entries.find((other) => other.at === at);
  if (!entry) return;
  write(entries.map((other) => (other.at === at ? { ...other, outcome: `${other.outcome} → ${what}` } : other)));
}

export function voiceLog(): VoiceLogEntry[] {
  return read();
}

export function clearVoiceLog(): void {
  write([]);
}

/** The log as text to paste into a bug report or a chat. */
export function voiceLogText(entries: readonly VoiceLogEntry[] = read()): string {
  return entries
    .map((entry) =>
      [`## ${new Date(entry.at).toLocaleString()}`, `Said: ${entry.transcript}`, ...entry.steps.map((line) => `- ${line}`), `Result: ${entry.outcome}`].join('\n'),
    )
    .join('\n\n');
}

export function useVoiceLog(): VoiceLogEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    read,
  );
}
