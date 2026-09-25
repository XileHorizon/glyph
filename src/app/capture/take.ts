import type { VoiceCommand } from '../plugins/types.ts';
import { actionable, findKeyword, findSoundAlike, isStandaloneCommandLike, planCommand, reply, type Placement, type Plan } from './command.ts';
import { placeWords } from './listAppend.ts';
import { renderNote, type Segment } from './markdown.ts';
import type { Candidate } from './route.ts';
import { appendBlock, cellsOf, fitRow, saysDone, tableMarkdown } from './table.ts';
import { endsMemo, MEMO_GAP_MS, startsMemo } from './voiceMemo.ts';

/**
 * One recording's words and commands, as a state machine with no screen and no clock of its own.
 *
 * The recorder (CaptureScreen) feeds it each committed phrase and a tick every quarter second, and does what it says:
 * shows a chip, asks "shall I?", adds items to another note. The voice test suite (voice-tests/, capture/voiceSuite)
 * feeds it the same phrases from recorded audio and checks the notes that result, so what is tested is what runs.
 *
 * Everything here was the recorder's own until the suite needed it; the rules it follows are the same:
 *
 * - Nothing is a command until "Glyph" (or, with the keyword off, a phrase that reads as one). The words before the
 *   keyword stay in the note; the words after it, across phrases, are the command and never land in the note unless
 *   no command comes of them.
 * - A command asks before it acts. "Yes" or "no" answer it, as a tap does; silence for a while is a no.
 * - A table is asked for a piece at a time; a voice memo keeps the sound instead of the words.
 *   words, which go straight in - the trigger and the question were the asking.
 */

/** When a command gives up, in ms: the recorder's timings, one place. */
export const TAKE_TIMING = {
  /** After "Glyph", this long without a word that makes a command, and it gives up. */
  commandQuietMs: 4500,
  /** A pause after a command the rules can't read: the on-device model is asked. */
  understandAfterMs: 1200,
  /** "New items for …": a pause this long after the last one, and they are asked about. */
  itemsQuietMs: 2500,
  /** A note named with nothing said for it: this long, and it gives up. */
  awaitMs: 9000,
  /** A table being said, and nothing for it: this long, and it is dropped. */
  tableQuietMs: 45_000,
  /** A command asked about and not answered: this long, and it is not done. */
  confirmMs: 20_000,
};

export interface TakeNote {
  id: string;
  body: string;
}

export type TakeCandidate<N extends TakeNote> = Candidate & { note: N };

export interface Span {
  startMs: number;
  endMs: number;
}

/** A table being asked for: its note (null for the one being recorded), its labels, its rows so far. */
export interface TableDraft<N extends TakeNote> {
  note: N | null;
  title: string;
  columns: string[];
  rows: string[][];
  lastAt: number;
}

/** A command understood and waiting for yes or no: what it will do, shown on the card. */
export type Offer<N extends TakeNote> =
  | { kind: 'place'; note: N; title: string; text: string; placement: Placement; added: string[]; into: 'list' | 'paragraph'; span: Span }
  | { kind: 'change'; note: N; title: string; heading: string; action: string; lines: string[]; change: (body: string) => string | null; span: Span }
  | { kind: 'move'; note: N; title: string; span: Span }
  | { kind: 'new'; title?: string; lines?: readonly string[]; span: Span }
  | { kind: 'board'; title: string; span: Span }
  | { kind: 'table'; note: N | null; title: string; columns: string[]; rows: string[][]; markdown: string; span: Span }
  | { kind: 'plugin'; voice: VoiceCommand; parsed: unknown; title: string; action: string; span: Span }
  /** A finished recording's changes, carried out by the recorder itself once confirmed (finalInstruction.ts). */
  | { kind: 'plan'; heading: string; action: string; lines: string[]; detail: string | null; span: Span };

/** What the chip at the foot of the recorder says. */
export type RouteView =
  | { phase: 'hearing'; name: string; guess: string | null; lead: 'Add to' | 'New item for' | 'Move to' | 'Start' | 'Table for' }
  | { phase: 'done'; text: string }
  | { phase: 'command'; words: string; thinking?: boolean }
  | { phase: 'said'; text: string }
  | { phase: 'waiting'; title: string; many: boolean; leave: boolean }
  | { phase: 'added'; title: string; body: string; added: string[] }
  | { phase: 'moved'; title: string }
  | { phase: 'missed'; title: string }
  | { phase: 'plugin'; state: 'working' | 'done' | 'failed'; lead: string | null; title: string }
  | null;

export type Haptic = 'light' | 'selection' | 'success' | 'warning';

/** What the take asks of whoever runs it. */
export interface TakeHost<N extends TakeNote> {
  /** The notes a command can name, most recent first. */
  notes(): readonly TakeCandidate<N>[];
  /** The note this take is written onto, or null for a new one. */
  target(): N | null;
  commandWord(): boolean;
  /** Clear command-shaped full utterances may act without a wake word. */
  instructionCommands(): boolean;
  voiceCommands(): readonly VoiceCommand[];
  /** The words switched-on plugins let an item command end a note's name with ("…in Notion"). */
  itemTargets(): readonly string[];
  /** A plan the rules couldn't read, read by the phone's command model; absent where there is none. */
  understand?(words: string): { done: Promise<Plan<TakeCandidate<N>> | null>; cancel: () => void };

  route(view: RouteView): void;
  offer(offer: Offer<N> | null): void;
  table(draft: TableDraft<N> | null): void;
  /** What of a command is being heard, for the chip; empty when none. */
  itemWords(text: string): void;
  haptic(kind: Haptic): void;
  /** The take's words changed: segments, tables or the board flag. */
  changed(): void;

  /** Yes to a place offer: the words into that note. */
  addItems(note: N, spoken: string, placement: Placement): void;
  /** Yes to a change offer: that note's body rewritten. */
  changeNote(note: N, change: (body: string) => string | null, title: string): void;
  addTable(note: N, title: string, markdown: string): void;
  /** Yes to a move offer: this take's words so far go to `note` and carry on there. */
  moveTo(note: N): void;
  /**
   * The memo flow chose `note`: the words so far stay where they were said (the take is forked, `fork`), and the take
   * carries on afresh on it.
   */
  carryOn(note: N): void;
  /** A new note from here; with a `title`, one already named, carried on like `carryOn`. */
  newNote(title?: string): void;
  /** "Undo": the last thing a command put in a note comes out. What it was, for the chip, or null when there is nothing. */
  undo(): string | null;
  /** Yes to a plugin's command: what it keeps in the note, if anything. */
  runPlugin(voice: VoiceCommand, parsed: unknown): string | null;
  describePlugin(voice: VoiceCommand, parsed: unknown): { title: string; action: string };
  /** A voice memo closed: the clip's markdown, for the stretch of this take's tape. */
  clip(span: Span): string;
  /** A line for the review's check of commands. */
  log(line: string): void;
  /** What was last said, for plugin commands ("send that to Notion"). */
  said(text: string): void;
}

export class Take<N extends TakeNote> {
  /** The words of the note, as committed phrases (commands taken out). */
  segments: Segment[] = [];
  /** Tables made for this note: they follow its words. */
  tables: string[] = [];
  /** The clips this take wrote. */
  clips: Segment[] = [];
  /** "Glyph, make this a board": the note is written as a board at the end. */
  asBoard = false;
  /** Recording spans that were commands, for the better-words pass to leave out. */
  commandSpans: Span[] = [];
  /** Phrases that were words and then "Glyph": the better words keep only what came before it. */
  keywordSpans: Span[] = [];
  /** Notes other than this one that commands changed. */
  touched = new Set<string>();

  private listening: { words: string; said: Segment[]; lastAt: number; asked?: string } | null = null;
  private awaiting: { plan: Extract<Plan<TakeCandidate<N>>, { kind: 'await' }>; words: string[]; lastAt: number } | null = null;
  private pending: { offer: Offer<N>; at: number } | null = null;
  private tabling: TableDraft<N> | null = null;
  private memo: { startMs: number; endMs: number } | null = null;
  private understanding: { words: string; cancel: () => void } | null = null;
  private lastHeard = 0;
  constructor(private readonly host: TakeHost<N>) {}

  /** A command being said, or waiting for its yes: this holds the recording open. */
  get commanding(): boolean {
    return this.listening !== null || this.awaiting !== null || this.pending !== null || this.tabling !== null;
  }

  get offering(): Offer<N> | null {
    return this.pending?.offer ?? null;
  }

  get drafting(): TableDraft<N> | null {
    return this.tabling;
  }

  /** Whether a partial guess is part of a command, so it shows in the chip rather than the note. */
  partOfCommand(text: string): boolean {
    if (this.listening !== null || this.awaiting !== null || this.tabling !== null) return true;
    return this.host.commandWord() && findKeyword(text) !== null;
  }

  /** A guess is being heard: the command model stops, so it never takes the phone from the words. */
  heardPartial(now: number): void {
    this.lastHeard = now;
    if (this.understanding) {
      this.stopUnderstanding();
      if (this.listening) this.listening.asked = undefined;
    }
  }

  private plan(words: string) {
    // The note being recorded onto, as the command list knows it (its body kept fresh by commands): its lanes can be named.
    const target = this.host.target();
    const board = target ? (this.host.notes().find((c) => c.id === target.id) ?? { id: target.id, title: '', note: target }) : null;
    return planCommand(words, { notes: this.host.notes(), targets: this.host.itemTargets(), board });
  }

  private pluginFor(words: string) {
    return this.host.voiceCommands().find((voice) => voice.parse(words) !== null) ?? null;
  }

  /** The chip while a command is heard: the note it names, as soon as it can tell. */
  guess(text: string, current: RouteView): RouteView {
    const wait = this.awaiting;
    if (wait) return { phase: 'waiting', title: wait.plan.note.title, many: wait.plan.many, leave: wait.plan.how === 'leave' };
    const heard = this.listening;
    const keyword = this.host.commandWord();
    const found = heard ? null : keyword ? findKeyword(text) : null;
    const words = heard ? `${heard.words} ${text}`.trim() : found ? found.after : keyword ? null : text;
    const guessing = current === null || current.phase === 'hearing' || current.phase === 'command';
    if (!guessing) return current;
    if (words === null || (!heard && !found && !words)) return current?.phase === 'hearing' || current?.phase === 'command' ? null : current;
    const plugin = this.pluginFor(words);
    const plan = plugin ? null : this.plan(words);
    if (!plan || plan.kind === 'no-note') {
      if (!heard && !found && !plugin) return current?.phase === 'hearing' || current?.phase === 'command' ? null : current;
      return { phase: 'command', words: heard ? heard.words : '' };
    }
    if (plan.kind === 'new') return { phase: 'hearing', name: 'new note', guess: 'New note', lead: 'Start' };
    if (plan.kind === 'create-list') return { phase: 'hearing', name: plan.title, guess: plan.title, lead: 'Start' };
    if (plan.kind === 'board') return { phase: 'hearing', name: 'board', guess: 'this note', lead: 'Start' };
    if (plan.kind === 'table') return { phase: 'hearing', name: 'table', guess: plan.note?.title ?? 'this note', lead: 'Table for' };
    const lead = plan.kind === 'move' ? 'Move to' : plan.kind === 'lane' || plan.kind === 'card' || plan.how === 'item' ? 'New item for' : 'Add to';
    if (current?.phase === 'hearing' && current.guess === plan.note.title && current.lead === lead) return current;
    return { phase: 'hearing', name: plan.note.title, guess: plan.note.title, lead };
  }

  // ---- offers ---------------------------------------------------------------------------------

  private setPending(offer: Offer<N> | null, now: number): void {
    this.pending = offer ? { offer, at: now } : null;
    this.host.offer(offer);
  }

  private offer(plan: Plan<TakeCandidate<N>>, span: Span, now: number): void {
    this.listening = null;
    this.awaiting = null;
    this.host.itemWords('');
    if (plan.kind === 'no-note' || plan.kind === 'await' || plan.kind === 'table') return;
    if (plan.kind === 'place') {
      const note = plan.note.note;
      const preview = placeWords(note.body, plan.text, plan);
      if (!preview.added.length) return;
      this.setPending({ kind: 'place', note, title: plan.note.title, text: plan.text, placement: plan, added: preview.added, into: preview.into, span }, now);
    } else if (plan.kind === 'lane' || plan.kind === 'card') {
      const note = plan.note.note;
      const change = plan.change;
      const after = change(note.body);
      if (after === null) {
        this.host.route({ phase: 'said', text: plan.kind === 'card' ? `No item like “${plan.words}” in ${plan.note.title}.` : `Nothing to add to ${plan.lane}.` });
        return;
      }
      this.setPending(
        {
          kind: 'change',
          note,
          title: plan.note.title,
          heading: plan.kind === 'card' ? `Move to ${plan.lane}` : `Add to ${plan.lane}`,
          action: plan.kind === 'card' ? 'Move' : 'Add',
          lines: [plan.words],
          change,
          span,
        },
        now,
      );
    } else if (plan.kind === 'move') {
      this.setPending({ kind: 'move', note: plan.note.note, title: plan.note.title, span }, now);
    } else if (plan.kind === 'board') {
      this.setPending({ kind: 'board', title: 'this note', span }, now);
    } else if (plan.kind === 'create-list') {
      this.setPending({ kind: 'new', title: plan.title, ...(plan.items?.length ? { lines: plan.items } : {}), span }, now);
    } else {
      this.setPending({ kind: 'new', span }, now);
    }
    this.host.route(null);
    this.host.haptic('selection');
  }

  private offerPlugin(voice: VoiceCommand, parsed: unknown, span: Span, now: number): void {
    this.listening = null;
    this.awaiting = null;
    this.host.itemWords('');
    const { title, action } = this.host.describePlugin(voice, parsed);
    this.setPending({ kind: 'plugin', voice, parsed, title, action, span }, now);
    this.host.route(null);
    this.host.haptic('selection');
  }

  /** Yes: the command does what it showed. */
  confirm(now: number): void {
    const held = this.pending?.offer;
    if (!held) return;
    this.setPending(null, now);
    this.host.log(describeOffer(held, 'done'));
    if (held.kind === 'place') {
      this.touched.add(held.note.id);
      this.host.addItems(held.note, held.text, held.placement);
    } else if (held.kind === 'change') {
      this.touched.add(held.note.id);
      this.host.changeNote(held.note, held.change, held.title);
    } else if (held.kind === 'table') {
      if (held.note) {
        this.touched.add(held.note.id);
        this.host.addTable(held.note, held.title, held.markdown);
      } else {
        this.tables = [...this.tables, held.markdown];
        this.host.changed();
        this.host.route({ phase: 'done', text: 'Table added' });
        this.host.haptic('success');
      }
    } else if (held.kind === 'move') {
      this.host.moveTo(held.note);
    } else if (held.kind === 'new') {
      this.host.route({ phase: 'moved', title: held.title ?? 'New note' });
      this.host.newNote(held.title);
    } else if (held.kind === 'plan') {
      this.host.route({ phase: 'done', text: held.heading });
      this.host.haptic('success');
    } else if (held.kind === 'board') {
      this.asBoard = true;
      this.host.changed();
      this.host.route({ phase: 'done', text: 'This note is a board' });
      this.host.haptic('success');
    } else {
      const keep = this.host.runPlugin(held.voice, held.parsed);
      if (keep) {
        // Words the command keeps in the note ("book the cabin, send that to Notion").
        this.segments = [...this.segments, { text: keep, startMs: held.span.startMs, endMs: held.span.endMs }];
        this.host.changed();
      }
    }
  }

  /** No, or no answer: nothing happens, and the chip says so. */
  cancel(why: string | null, now: number): void {
    if (!this.pending) return;
    this.host.log(describeOffer(this.pending.offer, why ? 'declined' : 'dropped'));
    this.setPending(null, now);
    if (why) this.host.route({ phase: 'said', text: why });
  }

  /** No command came after the keyword: what was said goes back into the note, as words. */
  private giveBack(why: string): void {
    this.stopUnderstanding();
    const heard = this.listening;
    this.listening = null;
    this.host.itemWords('');
    if (!heard) return;
    this.host.log(`Heard “hey Ghost ${heard.words}” but no command in it, so those words stayed in the note`);
    if (heard.said.length) {
      const back = new Set(heard.said.map((s) => `${s.startMs}:${s.endMs}`));
      this.commandSpans = this.commandSpans.filter((span) => !back.has(`${span.startMs}:${span.endMs}`));
      this.keywordSpans = this.keywordSpans.filter((span) => !back.has(`${span.startMs}:${span.endMs}`));
      this.segments = [...this.segments, ...heard.said].sort((x, y) => x.startMs - y.startMs);
      this.host.changed();
      this.host.said(heard.said.map((s) => s.text).join(' '));
    }
    this.host.route({ phase: 'said', text: why });
  }

  private stopUnderstanding(): void {
    this.understanding?.cancel();
    this.understanding = null;
  }

  /** The rules had no plan: the phone's command model reads the words, if there is one. */
  private askModel(words: string, span: Span, orElse: string | null): boolean {
    const understand = this.host.understand;
    if (!understand) return false;
    this.stopUnderstanding();
    const heard = this.listening;
    if (heard) heard.asked = words;
    const asking = understand(words);
    this.understanding = { words, cancel: asking.cancel };
    this.host.route({ phase: 'command', words, thinking: true });
    void asking.done.then((plan) => {
      if (this.understanding?.words !== words) return;
      this.understanding = null;
      if (this.listening?.words !== words) return;
      if (plan && plan.kind !== 'no-note') {
        this.host.log(`The on-device model read “hey Ghost ${words}”`);
        this.carryOut(plan, span, this.lastHeard);
      } else if (orElse) {
        this.giveBack(orElse);
        this.host.haptic('warning');
      } else {
        this.host.route({ phase: 'command', words });
      }
    });
    return true;
  }

  /** The command so far, read again with every phrase: a plan to confirm, a note to wait on, or more to hear. */
  private decide(words: string, span: Span, now: number): void {
    if (this.understanding && this.understanding.words !== words) this.stopUnderstanding();
    const plugin = this.pluginFor(words);
    if (plugin) return this.offerPlugin(plugin, plugin.parse(words), span, now);
    const plan = this.plan(words);
    if (!plan) {
      this.host.route({ phase: 'command', words });
      return;
    }
    if (plan.kind === 'no-note') {
      const why = `No note called “${plan.name}”, so it stays here.`;
      if (this.askModel(words, span, why)) return;
      this.giveBack(why);
      this.host.haptic('warning');
      return;
    }
    this.carryOut(plan, span, now);
  }

  /** A plan, from the rules or the model: a table to build, a note to wait on, or something to confirm. */
  private carryOut(plan: Exclude<Plan<TakeCandidate<N>>, { kind: 'no-note' }>, span: Span, now: number): void {
    this.stopUnderstanding();
    if (plan.kind === 'table') {
      this.listening = null;
      this.host.itemWords('');
      this.setTable({ note: plan.note?.note ?? null, title: plan.note?.title ?? 'this note', columns: plan.columns, rows: [], lastAt: now });
      this.host.route(null);
      this.host.haptic('selection');
      return;
    }
    if (plan.kind === 'await') {
      this.listening = null;
      this.awaiting = { plan, words: [], lastAt: now };
      this.host.itemWords('');
      this.host.route({ phase: 'waiting', title: plan.note.title, many: plan.many, leave: plan.how === 'leave' });
      this.host.haptic('selection');
      return;
    }
    this.offer(plan, span, now);
  }

  // ---- carrying on in another note ---------------------------------------------------------------

  /**
   * The take carries on in another note: what it has is that note's, and stays there. The stretches of the tape it
   * came from are marked as commands, so the better words never write them into the next note.
   */
  fork(): void {
    for (const segment of this.segments) this.commandSpans.push({ startMs: segment.startMs, endMs: segment.endMs });
    this.segments = [];
    this.tables = [];
    this.clips = [];
    this.asBoard = false;
    this.host.changed();
  }

  // ---- tables -----------------------------------------------------------------------------------

  private setTable(draft: TableDraft<N> | null): void {
    this.tabling = draft;
    this.host.table(draft ? { ...draft, columns: [...draft.columns], rows: draft.rows.map((row) => [...row]) } : null);
  }

  /** The rows are done: the table as it will look, and a yes. */
  finishTable(now: number): void {
    const draft = this.tabling;
    if (!draft) return;
    this.setTable(null);
    this.host.itemWords('');
    if (!draft.columns.length) {
      this.host.route({ phase: 'said', text: 'No table: it had no columns.' });
      return;
    }
    this.setPending({ kind: 'table', note: draft.note, title: draft.title, columns: draft.columns, rows: draft.rows, markdown: tableMarkdown(draft.columns, draft.rows), span: { startMs: 0, endMs: 0 } }, now);
    this.host.haptic('selection');
  }

  cancelTable(why: string | null): void {
    if (!this.tabling) return;
    this.setTable(null);
    this.host.itemWords('');
    if (why) this.host.route({ phase: 'said', text: why });
  }

  // ---- voice memos -------------------------------------------------------------------------------

  /** A voice memo closes: the sound it took is written where it was said. */
  closeMemo(endMs: number): void {
    const held = this.memo;
    if (!held) return;
    this.memo = null;
    this.host.itemWords('');
    if (endMs - held.startMs < 500) {
      this.host.route({ phase: 'said', text: 'Nothing was said, so no voice memo was kept.' });
      return;
    }
    const written: Segment = { text: this.host.clip({ startMs: held.startMs, endMs }), startMs: held.startMs, endMs };
    this.clips = [...this.clips, written];
    this.segments = [...this.segments, written].sort((a, b) => a.startMs - b.startMs);
    this.host.changed();
    const seconds = Math.max(0, Math.round((endMs - held.startMs) / 1000));
    const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.host.log(`Kept a voice memo of ${length}`);
    this.host.route({ phase: 'done', text: `Voice memo, ${length}` });
    this.host.haptic('success');
  }

  // ---- a phrase --------------------------------------------------------------------------------------

  /**
   * Listen only.  CaptureScreen uses this for every live Whisper commit: it
   * renders the accumulating transcript but cannot route, infer, write, or
   * derive a note from an incomplete utterance.
   */
  listen(segment: Segment): void {
    const text = segment.text.replace(/^[\s.,;:!?…]+/, '');
    if (!text) return;
    this.lastHeard = performance.now();
    this.segments = [...this.segments, { ...segment, text }];
    this.host.said(text);
    this.host.changed();
  }

  /** Offer a finished recording's changes: shown, and on yes left to the recorder to carry out. */
  offerChanges(card: { heading: string; action: string; lines: string[]; detail: string | null }, now: number): void {
    this.segments = [];
    this.host.changed();
    this.listening = null;
    this.awaiting = null;
    this.setPending({ kind: 'plan', ...card, span: { startMs: 0, endMs: 0 } }, now);
    this.host.route(null);
    this.host.haptic('selection');
  }

  /** Offer a plan only after the complete capture has been classified. */
  offerFinal(plan: Plan<TakeCandidate<N>>, now: number): void {
    this.segments = [];
    this.host.changed();
    this.offer(plan, { startMs: 0, endMs: 0 }, now);
  }

  /** A committed phrase: read for commands, and whatever of it is the note's added to its words. */
  phrase(segment: Segment, now: number): void {
    this.lastHeard = now;
    const kept = this.read(segment, now);
    if (kept) {
      this.segments = [...this.segments, kept];
      this.host.changed();
    }
  }

  private read(said: Segment, now: number): Segment | null {
    // Whisper opens a phrase with the last one's full stop (". Yes."), which no reply or cue expects.
    const segment = { ...said, text: said.text.replace(/^[\s.,;:!?…]+/, '') };
    const text = segment.text;
    const span = { startMs: segment.startMs, endMs: segment.endMs };
    const skip = () => this.commandSpans.push(span);
    const keywordOn = this.host.commandWord();
    // "Glyph", or a word base.en writes for it ("Life. Add eggs to work.") when a command follows and none is under way.
    const readsAsCommand = (words: string) => this.pluginFor(words) !== null || actionable(this.plan(words));
    const underWay = this.tabling !== null || this.awaiting !== null || this.listening !== null;
    const found = keywordOn ? (findKeyword(text) ?? (underWay ? null : findSoundAlike(text, readsAsCommand))) : null;

    // A voice memo: what is said is kept as sound, not words, until "end memo" or a breath.
    const leaving = this.memo;
    if (leaving) {
      const breath = segment.startMs - leaving.endMs > MEMO_GAP_MS;
      if (!breath && !endsMemo(text)) {
        skip();
        leaving.endMs = segment.endMs;
        this.host.itemWords('');
        return null;
      }
      this.closeMemo(leaving.endMs);
      if (!breath) {
        // "End memo" is the cue, not the note's words.
        skip();
        return null;
      }
      // A breath ended it: this phrase is the note's again, and goes on below.
    } else if (startsMemo(text)) {
      skip();
      this.memo = { startMs: segment.endMs, endMs: segment.endMs };
      this.host.itemWords('');
      this.host.route({ phase: 'said', text: 'Voice memo: talk, then say “end memo”.' });
      this.host.haptic('light');
      return null;
    }

    // A table being asked for: every phrase is its next piece, until "done".
    const draft = this.tabling;
    if (draft) {
      skip();
      const said = (findKeyword(text)?.after ?? text).trim();
      draft.lastAt = now;
      this.host.itemWords('');
      if (reply(said) === 'no' || /^(?:cancel|never ?mind|forget (?:it|the table)|no table)\b/i.test(said)) {
        this.cancelTable('No table.');
        return null;
      }
      if (!draft.columns.length) {
        const labels = cellsOf(said);
        if (labels.length) this.setTable({ ...draft, columns: labels });
        return null;
      }
      if (saysDone(said)) {
        this.finishTable(now);
        return null;
      }
      const cells = cellsOf(said);
      if (cells.length) this.setTable({ ...draft, rows: [...draft.rows, fitRow(cells, draft.columns.length)] });
      return null;
    }

    // A command asked "shall I?": this phrase may be the answer.
    if (this.pending) {
      const answer = reply(text);
      if (answer) {
        skip();
        if (answer === 'yes') this.confirm(now);
        else this.cancel('Not done.', now);
        return null;
      }
      // Talking on: the words go in the note and the question stays, unless a new command starts.
      if (!found) {
        this.host.said(text);
        return segment;
      }
      this.cancel(null, now);
    }

    // A note was named: this phrase is what goes in it.
    const wait = this.awaiting;
    if (wait && !found) {
      skip();
      // "Call the bank. Email the landlord." in one breath is two items when several were asked for.
      const said = wait.plan.many ? text.split(/(?<=[.!?])\s+/) : [text];
      for (const item of said) if (item.trim()) wait.words.push(item.replace(/[\s.,;:!?]+$/, ''));
      wait.lastAt = now;
      if (!wait.plan.many) this.offer({ ...wait.plan, kind: 'place', text: wait.words.join(', ') }, span, now);
      return null;
    }
    this.awaiting = null;

    // After the keyword: more of the command.
    const heard = this.listening;
    if (heard && !found) {
      skip();
      heard.words = `${heard.words} ${text}`.trim();
      heard.said.push(segment);
      heard.lastAt = now;
      this.host.itemWords('');
      this.decide(heard.words, span, now);
      return null;
    }

    if (keywordOn && !found) {
      // Full-utterance instruction mode is deliberately narrow: only speech
      // whose beginning is unmistakably command-shaped is eligible. Ordinary
      // prose that later mentions “add”, “create”, or another command remains
      // note content. Re-read all committed phrases so segmentation cannot
      // decide whether a clear command is seen.
      const utteranceSegments = [...this.segments, segment];
      const utterance = utteranceSegments.map((part) => part.text).join(' ').trim();
      if (this.host.instructionCommands() && isStandaloneCommandLike(utterance)) {
        const plugin = this.pluginFor(utterance);
        const plan = plugin ? null : this.plan(utterance);
        if (plugin || (plan && plan.kind !== 'no-note')) {
          for (const part of utteranceSegments) this.commandSpans.push({ startMs: part.startMs, endMs: part.endMs });
          this.segments = [];
          this.host.changed();
          this.listening = { words: utterance, said: utteranceSegments, lastAt: now };
          if (plugin) this.offerPlugin(plugin, plugin.parse(utterance), span, now);
          else this.decide(utterance, span, now);
          return null;
        }
        // The deterministic parser missed, but a constrained local model may
        // still interpret this explicitly command-shaped utterance at pause.
        if (!plan && this.host.understand) {
          for (const part of utteranceSegments) this.commandSpans.push({ startMs: part.startMs, endMs: part.endMs });
          this.segments = [];
          this.host.changed();
          this.listening = { words: utterance, said: utteranceSegments, lastAt: now };
          this.host.itemWords('');
          this.host.route({ phase: 'command', words: utterance });
          return null;
        }
      }
      this.host.said(text);
      return segment;
    }

    if (!keywordOn) {
      // No keyword needed: a phrase is a command only if it reads as one, and it still asks.
      const plugin = this.pluginFor(text);
      const plan = plugin ? null : this.plan(text);
      if (!plugin && (!plan || plan.kind === 'no-note')) {
        this.host.said(text);
        return segment;
      }
      skip();
      this.listening = { words: text, said: [], lastAt: now };
      this.decide(text, span, now);
      return null;
    }

    // "Glyph": the words before it stay; the rest is the command.
    const before = found!.before;
    if (before) this.keywordSpans.push(span);
    else skip();
    // What is given back, if no command comes of it, is the words after the keyword: "Glyph" was said to the app.
    this.listening = { words: found!.after, said: found!.after ? [{ ...segment, text: found!.after }] : [], lastAt: now };
    this.host.itemWords('');
    this.host.haptic('light');
    if (found!.after) this.decide(found!.after, span, now);
    else this.host.route({ phase: 'command', words: '' });
    if (!before) return null;
    this.host.said(before);
    // The words before the keyword are a phrase of their own: they end as one, where Whisper ran them into "Glyph".
    return { ...segment, text: /[.!?…]$/.test(before) ? before : `${before}.` };
  }

  // ---- the clock ---------------------------------------------------------------------------------

  /** Called a few times a second: commands that have waited too long give up, or are asked about. */
  tick(now: number): void {
    if (this.tabling && now - this.tabling.lastAt > TAKE_TIMING.tableQuietMs) this.cancelTable('No table: nothing was said for it for a while.');
    // The keyword said, words the rules can't read, and a pause: the command model reads them.
    const saying = this.listening;
    if (
      saying?.words &&
      this.host.understand &&
      saying.asked !== saying.words &&
      !this.understanding &&
      now - saying.lastAt > TAKE_TIMING.understandAfterMs &&
      now - this.lastHeard > TAKE_TIMING.understandAfterMs
    ) {
      const last = saying.said[saying.said.length - 1];
      this.askModel(saying.words, last ? { startMs: last.startMs, endMs: last.endMs } : { startMs: 0, endMs: 0 }, null);
    }
    // The keyword said, and then nothing that makes a command: the words go back in the note.
    if (this.listening && !this.understanding && now - this.listening.lastAt > TAKE_TIMING.commandQuietMs) {
      this.giveBack(this.listening.words ? 'No command there, so the words stay in the note.' : 'Say a command after “hey Ghost”.');
    }
    const wait = this.awaiting;
    if (wait && wait.words.length && now - wait.lastAt > TAKE_TIMING.itemsQuietMs) {
      // "New items for work": every phrase until a pause, then asked all at once.
      this.offer({ ...wait.plan, kind: 'place', text: wait.words.join(', ') }, { startMs: 0, endMs: 0 }, now);
    } else if (wait && !wait.words.length && now - wait.lastAt > TAKE_TIMING.awaitMs) {
      this.awaiting = null;
      this.host.itemWords('');
      this.host.route({ phase: 'said', text: `Nothing said for ${wait.plan.note.title}, so nothing was added.` });
    }
    const held = this.pending;
    if (held && now - held.at > TAKE_TIMING.confirmMs) this.cancel('Not done. Say “yes” or tap to confirm a command.', now);
  }

  /** The take is ending: a memo still open is closed, and a command that never came gives its words back. */
  end(atMs: number): void {
    if (this.memo) this.closeMemo(atMs);
    if (this.listening) this.giveBack('No command there, so the words stay in the note.');
  }

  /** The take's markdown: its words as the cues lay them out, with tables after them and links applied by `link`. */
  markdown({ titled, link = (text) => text, board }: { titled: boolean; link?: (markdown: string) => string; board?: (markdown: string) => string }): string {
    let markdown = link(renderNote(this.segments, '', { titled }).markdown);
    markdown = this.tables.reduce((body, table) => appendBlock(body, table), markdown).replace(/\n$/, '');
    return this.asBoard && board ? board(markdown) : markdown;
  }
}

/** What a command offered, in words, and what came of it: for the review's check of commands. */
export function describeOffer<N extends TakeNote>(offer: Offer<N>, outcome: 'done' | 'declined' | 'dropped'): string {
  const show = (line: string) => line.replace(/^\s*(?:- \[[ xX]\] |[-*+] |\d+[.)] )/, '');
  const what =
    offer.kind === 'place'
      ? `add “${offer.added.map(show).join('”, “')}” to ${offer.title}${offer.into === 'list' ? '’s list' : ' as a paragraph'}`
      : offer.kind === 'change'
        ? `${offer.heading.charAt(0).toLowerCase()}${offer.heading.slice(1)}: “${offer.lines.join('”, “')}” in ${offer.title}`
        : offer.kind === 'move'
          ? `move this recording to ${offer.title}`
          : offer.kind === 'new'
            ? offer.title ? `create ${offer.title}` : 'start a new note'
            : offer.kind === 'board'
              ? 'make this note a board'
              : offer.kind === 'plan'
                ? offer.heading.charAt(0).toLowerCase() + offer.heading.slice(1)
                : offer.kind === 'table'
                ? `add a table (${offer.columns.join(', ')}; ${offer.rows.length} rows) to ${offer.title}`
                : offer.title.charAt(0).toLowerCase() + offer.title.slice(1);
  if (outcome === 'done') return `Did: ${what}`;
  return outcome === 'declined' ? `Offered to ${what}; the person said no` : `Offered to ${what}; nobody answered, so it was not done`;
}
