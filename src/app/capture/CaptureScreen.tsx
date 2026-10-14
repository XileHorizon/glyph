import { Ghost } from '../art/Ghost.tsx';
import { Square } from '@glacier/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { answerHost, endCapture, isLocked, setCapturing } from '../core/host.ts';
import {
  applyCommandMutation,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  newNoteId,
  noteTitle,
  setNoteRecording,
  undoCommandMutation,
  updateNote as updateStoredNote,
  type Note,
} from '../core/store.ts';
import { preferences } from '../core/preferences.ts';
import { isTauri } from '../core/tauri.ts';
import { openMicrophone, type Microphone, type MicrophoneHandlers } from './audio.ts';
import { enqueueRefine, setRecorderLive } from './refine.ts';
import { enqueueFormat, setFormattingPaused } from '../format/queue.ts';
import { reviewAvailable, type ReviewHandoff } from '../review/useReview.ts';
import { discardRecording, reassignRecording, startCapture, type CaptureSession, type EngineKind, type Stopped } from './engine.ts';
import { renderNote, setLinkTitles, setSpokenFormats, type Segment } from './markdown.ts';
import { Opening } from './Opening.tsx';
import { QuietWatch } from './quiet.ts';
import { type Candidate } from './route.ts';
import { findKeyword, type Placement } from './command.ts';
import { appendToList, placeWords } from './listAppend.ts';
import { listTitle } from './instructionMutation.ts';
import { clipMarkdown, freshTapeId, setTapeId, tapeId } from '../core/clips.ts';
import { commandModel, understandInstructionCommand } from './understand.ts';
import { classifyFinalTranscript, type VoiceAction } from './finalInstruction.ts';
import { settleRecording } from './voiceLog.ts';
import { segmentsWithoutTrailingEcho, withoutTrailingEcho } from './trailingEcho.ts';
import { appendBlock } from './table.ts';
import { appendBody } from './appendBody.ts';
import { Take, type Offer, type RouteView, type TableDraft, type TakeHost } from './take.ts';
import { boardFrom, lanesOf } from '../core/boards.ts';
import { applyLinks, type SentLink } from '../core/itemLinks.ts';
import { plugins } from '../plugins/registry.ts';
import type { CaptureContext } from '../plugins/types.ts';
import { tips, TIP_AFTER_MS, type Tip } from './tips.ts';
import { SideKeyWaves } from './SideKeyWaves.tsx';
import { publishVoiceLevel } from './voiceLevel.ts';
import { useSideKeySpot } from './sideKey.ts';
import { LivePage } from './LivePage.tsx';
import { Tail } from './Tail.tsx';
import { counter } from './tape.ts';
import styles from './CaptureScreen.module.css';

/**
 * A note being spoken.
 *
 * One screen for both ways in - the Speak button and the held side key - and
 * it shows one thing: the note taking shape as you say it, set large, the
 * spoken cues turning into dimmed markdown marks as they land. A small line at
 * the top says where the words are going; a counter says how long; Discard and
 * Done are the only buttons. Until the first words arrive, a drawing of sound
 * beginning is the whole screen, so the microphone being live is visible before
 * a word has been understood.
 *
 * Opened by a held side key, so everything here is ordered around one promise:
 * the microphone is listening before anything else is ready. The microphone is
 * opened first, the model loads while it listens, and samples captured in the
 * meantime are held and replayed rather than dropped. The first words of a
 * voice note are usually its subject, and a capture screen that needs a second
 * to warm up loses exactly them.
 *
 * The note is saved WHILE it is spoken, not when it ends. The phone can kill
 * the app mid-sentence, and a note that only reached the store at Done would be
 * a note that never existed. So each committed phrase is written under an id
 * chosen at mount; a cancel deletes it; Done writes the final version.
 *
 * A recording from the Speak button or the side key is a new note; a note's own Speak adds to that note.
 *
 * Done goes back to the list, whatever started the capture: the new note is at
 * the top, a tap away, and a locked phone has already stepped back behind its
 * lock screen without showing the note to whoever is holding it.
 */

interface CaptureScreenProps {
  /** Opened by the side key, where the OS has already buzzed. */
  fromAssistant: boolean;
  /** Counts side-key presses during this capture: each one after the first means "stop and save". */
  stopRequests?: number;
  /** Talking into this note (its Speak): the words go on its end, whatever memo mode says. */
  noteId?: string;
  /** The saved note, or null when the capture was cancelled or nothing was said. */
  /** The take is over. `review` is set when the review after a recording should look at it (review/); `sort` when it was a memo, to be sorted (sort/). */
  onFinish: (note: Note | null, locked: boolean, review?: ReviewHandoff) => void;
}

type Phase = 'starting' | 'listening' | 'finishing' | 'failed';

/** How long a quiet after words has to last before "Stop when I go quiet" saves the take. */
const QUIET_STOP_MS = 4000;

const ENGINE_LABEL: Record<EngineKind, string> = {
  whisper: 'On-device Whisper',
  browser: 'Browser speech recognition',
  simulated: 'Simulated voice',
};

/** Words used only to tell whether native's final decode extends phrase events. */
const transcriptWords = (text: string): string[] =>
  Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu), (match) => match[0]!.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase());

/** The original text after `wordCount` words, retaining Whisper's punctuation/casing. */
function afterWords(text: string, wordCount: number): string {
  if (!wordCount) return text.trim();
  const words = Array.from(text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu));
  const end = words[wordCount - 1]?.index;
  const last = words[wordCount - 1]?.[0];
  if (end === undefined || !last) return '';
  return text.slice(end + last.length).replace(/^[\s,;:!?….-]+/, '').trim();
}

/**
 * `capture_stop` drains Whisper after the last event listener can be removed.
 * When that final decode extends the committed phrases, retain their timing and
 * append only the missing terminal words for ordinary-note rendering/tapes.
 * Classification always uses the complete native text.
 */
function appendFinalTranscriptSuffix(segments: readonly Segment[], transcript: string | null, endMs: number): Segment[] {
  const finalText = transcript?.trim();
  if (!finalText) return [...segments];
  const committed = transcriptWords(segments.map((segment) => segment.text).join(' '));
  const finalWords = transcriptWords(finalText);
  if (!finalWords.length || committed.length >= finalWords.length || !committed.every((word, index) => word === finalWords[index])) return [...segments];
  const suffix = afterWords(finalText, committed.length);
  if (!suffix) return [...segments];
  const startMs = segments.at(-1)?.endMs ?? 0;
  return [...segments, { text: suffix, startMs, endMs: Math.max(endMs, startMs + 1) }];
}

export function CaptureScreen({ fromAssistant, stopRequests = 0, noteId: aimedAt, onFinish }: CaptureScreenProps) {
  /** The note being written: a new id, or the note this capture continues. */
  const noteId = useRef(newNoteId());
  /** The note this capture is being added to, if it continues one. */
  const [target, setTarget] = useState<Note | null>(null);
  const targetRef = useRef<Note | null>(null);
  /** The persisted row for a new capture draft, once explicitly created. */
  const draftNote = useRef<Note | null>(null);
  /**
   * The continued note's text before this capture, read from the store once,
   * when first needed - after the editor that may have been open has flushed
   * its last keystrokes. A promise, so two drafts racing both get the text from
   * BEFORE either of them wrote.
   */
  const baseBody = useRef<Promise<string> | null>(null);

  const [phase, setPhase] = useState<Phase>('starting');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partial, setPartial] = useState('');
  const [engine, setEngine] = useState<EngineKind | null>(null);
  const [download, setDownload] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Milliseconds on the recording, copied from the session a few times a second. */
  const [recorded, setRecorded] = useState(0);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(EMPTY_DIAGNOSTICS);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Mirrors the render state reads at Done, which runs after the last events
  // have landed but before React has necessarily re-rendered with them.
  const segmentsRef = useRef<Segment[]>([]);
  const sessionRef = useRef<CaptureSession | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  /** The line at the top: a pane the note's page runs under (app.css .app-headerPane), so the wisp sits below it. */
  const topRef = useRef<HTMLDivElement>(null);
  // Its height, for the body to keep clear of it in the states that aren't the page (`--recorder-top`).
  useEffect(() => {
    const top = topRef.current;
    const screen = screenRef.current;
    if (!top || !screen) return undefined;
    const fit = () => screen.style.setProperty('--recorder-top', `${top.offsetHeight}px`);
    fit();
    const watched = new ResizeObserver(fit);
    watched.observe(top);
    return () => watched.disconnect();
  }, []);
  /** Set when "Stop when I go quiet" is on: watches for the end of talking. */
  const quiet = useRef(preferences().quietStop ? new QuietWatch(QUIET_STOP_MS) : null);
  /** Whether this phone stops a recording when the side key is pressed (generation 12). */
  const [pressStops, setPressStops] = useState(false);
  const spot = useSideKeySpot();

  /** The notes a spoken "add to …" can name, most recent first; loaded as the capture opens. */
  const candidates = useRef<(Candidate & { note: Note })[]>([]);
  /**
   * The routing chip: a note being named while it is still being said, then
   * the note the words moved to (or a name that matched nothing).
   */
  const [route, setRoute] = useState<RouteView>(null);
  /** Bumped when words move to another note, to replay the lines writing out. */
  const [moves, setMoves] = useState(0);
  /** The words as they looked just before a move, sliding away. */
  const [ghost, setGhost] = useState<{ markdown: string; key: number } | null>(null);
  /** The phone's command model, once looked up; null without one, and the rules alone read commands. */
  const commandModelId = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    void commandModel().then((id) => {
      if (live) commandModelId.current = id;
    });
    return () => {
      live = false;
    };
  }, []);
  /** "Glyph, add a table to …": the table being asked for, column labels first, then row by row. */
  const [tableView, setTableView] = useState<TableDraft<Note> | null>(null);
  /** What a command will do once it is confirmed, by "yes" or a tap. */
  const [pending, setPendingView] = useState<Offer<Note> | null>(null);
  /**
   * Every write to a note, in turn: a command's change, the draft, the take carrying on elsewhere. Two close together
   * used to read the same body and the second lost the first; and a draft composed from a base that a command was
   * replacing wrote the old base back.
   */
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  /** What the last command changed in a note, for "undo": the note and its body before. */
  const lastChange = useRef<{ id: string; before: string; what: string; mutationId?: string } | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [asBoard, setAsBoard] = useState(false);
  /** The tape this take writes to: the continued note's, or a new one (core/clips.ts). Read once, when it is first needed. */
  const takeTape = useRef<string | null>(null);
  /** Every phrase the fast model heard, commands and all, for the review to check against a second listen. */
  const heardRef = useRef<string[]>([]);
  /** What each command did, or didn't, in words: the review checks them. */
  const commandLog = useRef<string[]>([]);
  /** The last thing said, for plugin commands like "send that to Notion": a phrase of this take, or items added to another note. */
  const lastSaid = useRef<{ kind: 'take'; text: string } | { kind: 'items'; noteId: string; lines: string[] } | null>(null);
  /** When words were last heard, for the tips in a pause. */
  const lastHeard = useRef(performance.now());
  const [tip, setTip] = useState<Tip | null>(null);
  const tipTurn = useRef(0);
  const savedDraft = useRef(false);
  const finished = useRef(false);
  /** A stopped command is awaiting its explicit confirmation; its words never become a note. */
  const finalCommand = useRef<{
    /** The changes the recording asked for, checked (finalInstruction.ts), carried out on confirmation. */
    actions: VoiceAction<Candidate & { note: Note }>[];
    /** The rest of what was said, kept as its own note on confirmation; null for none. */
    rest: string | null;
    /** Its entry in the voice log, for what the person chose. */
    trace?: number;
    /** A command found inside dictation: declined, the recording is saved as a note instead of discarded. */
    keep?: () => Promise<void>;
    locked: boolean;
    temporaryId: string;
    recordedMs: number | null;
  } | null>(null);
  /*
   * What the pipeline has actually done, counted where it happens and copied to
   * the screen a few times a second. The line itself is essential: the first
   * real capture on the Fold transcribed nothing and said "Listening" the whole
   * time, because an error during listening was stored and never shown.
   * "Heard 8.2 s · 0 phrases" and "heard 0.0 s" point at different halves of
   * the chain, which is the whole diagnosis without a debugger attached.
   */
  const counts = useRef<Diagnostics>({ ...EMPTY_DIAGNOSTICS });

  const titled = target === null;
  /** While an item for another note is being said, its words show in the chip, not in this note. */
  const [itemWords, setItemWords] = useState('');
  /** Words of this take a plugin linked to something (a Notion task): links wherever the cues put them. */
  const [sentLinks, setSentLinks] = useState<SentLink[]>([]);
  const sentLinksRef = useRef<SentLink[]>([]);
  const note = useMemo(() => {
    const rendered = renderNote(segments, itemWords ? '' : partial, { titled });
    const linked = sentLinks.length ? { ...rendered, markdown: applyLinks(rendered.markdown, sentLinks), pendingFrom: null } : rendered;
    const tabled = tables.length ? { ...linked, markdown: tables.reduce((body, table) => appendBlock(body, table), linked.markdown).replace(/\n$/, '') } : linked;
    return asBoard ? { ...tabled, markdown: asBoardMarkdown(tabled.markdown), pendingFrom: null } : tabled;
  }, [segments, partial, titled, itemWords, sentLinks, tables, asBoard]);

  // The switched-on plugins' formattings can be said like bold ("spoiler … end spoiler"); read as the recorder opens.
  useState(() => setSpokenFormats(plugins.formats().flatMap((format) => (format.cue ? [{ word: format.cue, delimiter: format.delimiter }] : []))));

  // No background pass over an earlier recording while this one is live: same cores.
  useEffect(() => {
    setRecorderLive(true);
    // Nor a formatting pass: the recorder has the cores while it is on screen.
    setFormattingPaused(true);
    return () => {
      setRecorderLive(false);
      setFormattingPaused(false);
    };
  }, []);

  // The screen stays on while this runs, and pressing the side key (which
  // turns it off) stops it: the only sign of the key Android gives an app.
  useEffect(() => {
    setPressStops(setCapturing(true));
    return () => void setCapturing(false);
  }, []);

  // ---- which note --------------------------------------------------------------------
  // A note's own Speak aims the recording at that note; otherwise it is a new one.
  useEffect(() => {
    let current = true;
    const chosen = aimedAt ? getNote(aimedAt).catch(() => null) : Promise.resolve<Note | null>(null);
    void chosen.then((found) => {
      // Found after a draft was already written to a new note: stay with that one.
      if (!current || !found || savedDraft.current || finished.current) return;
      targetRef.current = found;
      draftNote.current = null;
      noteId.current = found.id;
      setTarget(found);
    });
    return () => {
      current = false;
    };
    // Decided once, as the capture opens: a new capture is a new mount.
  }, [aimedAt]);

  // The notes "add to …" can name. Read once: a capture lasts minutes, and a
  // note made meanwhile is not one someone will name mid-sentence.
  useEffect(() => {
    let current = true;
    void listNotes()
      .then((all) => {
        if (!current) return;
        candidates.current = all
          .filter((n) => !n.archivedAt)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((note) => ({ id: note.id, title: noteTitle(note.body), note }))
          .filter((c) => c.title);
        // "Note link weekend trip end link" takes the note's own spelling.
        setLinkTitles(candidates.current.map((c) => c.title));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  /** The body to store: this capture's markdown, below the continued note's text if there is one. */
  const compose = useCallback(async (markdown: string): Promise<string> => {
    const continued = targetRef.current;
    if (!continued) return markdown;
    baseBody.current ??= getNote(continued.id)
      .catch(() => null)
      .then((stored) => stored?.body ?? continued.body);
    return appendBody(await baseBody.current, markdown);
  }, []);

  /** Persist a birth or a revision-checked edit; never upsert a missing id. */
  const persistBody = async (id: string, body: string, source: Note['source'] = 'capture'): Promise<Note> => {
    const known = targetRef.current?.id === id ? targetRef.current : draftNote.current?.id === id ? draftNote.current : null;
    const saved = known ? await updateStoredNote(id, body, known.revision ?? 1) : await createNote(id, body, source);
    if (targetRef.current?.id === id) {
      targetRef.current = saved;
      setTarget(saved);
    } else if (noteId.current === id) {
      draftNote.current = saved;
    }
    const candidate = candidates.current.find((item) => item.id === id);
    if (candidate) candidate.note = saved;
    return saved;
  };

  /** Undoes whatever drafts wrote: the continued note gets its text back, a new note goes. */
  const undoDraft = useCallback(async () => {
    if (!savedDraft.current) return;
    savedDraft.current = false;
    await writes.current.catch(() => undefined);
    const continued = targetRef.current;
    if (continued) await persistBody(continued.id, (await baseBody.current) ?? continued.body, continued.source);
    else await deleteNote(noteId.current);
  }, []);

  /** A write to a note, after every write before it (`writes`). */
  const queueWrite = <T,>(run: () => Promise<T>): Promise<T> => {
    const done = writes.current.then(run, run);
    writes.current = done.catch(() => undefined);
    return done;
  };

  /** The words so far, written to the note they were said for now rather than at the draft timer's next tick. */
  const flushDraft = useCallback(async () => {
    if (!take.segments.length && !take.tables.length && !take.clips.length) return;
    await queueWrite(async () => {
      savedDraft.current = true;
      const body = await compose(take.markdown({ titled: !targetRef.current, link: (text) => applyLinks(text, sentLinksRef.current), board: asBoardMarkdown }));
      await persistBody(noteId.current, body, 'capture');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose]);

  /**
   * The take carries on in `chosen`, or in a new note: what was said so far stays on the note it was said for,
   * written now, and the take starts afresh (take.fork). "New note", on a capture aimed at a note.
   */
  const carryOn = useCallback(
    async (chosen: Note | null) => {
      await flushDraft();
      take.fork();
      savedDraft.current = false;
      baseBody.current = null;
      // The take's tape is the note it ends on: a note with a recording takes it on the end of its own.
      takeTape.current = null;
      if (chosen) {
        const full = (await getNote(chosen.id).catch(() => null)) ?? chosen;
        targetRef.current = full;
        draftNote.current = null;
        noteId.current = full.id;
        setTarget(full);
        setRoute({ phase: 'moved', title: noteTitle(full.body) || 'that note' });
      } else {
        targetRef.current = null;
        draftNote.current = null;
        noteId.current = newNoteId();
        setTarget(null);
      }
      setMoves((n) => n + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flushDraft],
  );

  /** "New note": a fresh one from here; with a `title`, one already named. */
  const startNewNote = useCallback(
    async (title?: string) => {
      if (!title) {
        await carryOn(null);
        fireNativeHaptic('selection');
        return;
      }
      const named = listTitle(title);
      const id = newNoteId();
      const mutationId = newNoteId();
      const result = await applyCommandMutation({
        mutationId,
        noteId: id,
        kind: 'create',
        beforeRevision: null,
        beforeBody: null,
        afterBody: named,
        source: 'capture',
      });
      if (result.status === 'conflict') {
        setRoute({ phase: 'said', text: 'That note could not be created safely.' });
        return;
      }
      const made = result.note;
      lastChange.current = { id: made.id, before: '', what: `the new ${named} note`, mutationId };
      candidates.current = [{ id: made.id, title: named, note: made }, ...candidates.current];
      await carryOn(made);
    },
    [carryOn],
  );

  /**
   * "Add to <note>": this capture's words move to `note` and carry on there.
   * Everything said in this take goes, so "oat milk, add to shopping" and
   * "add to shopping, oat milk" land the same. The words slide away, the
   * note's last lines show, and the take is written out below them.
   */
  const routeTo = useCallback(
    async (chosen: Note) => {
      setRoute({ phase: 'moved', title: noteTitle(chosen.body) || 'that note' });
      fireNativeHaptic('success');
      if (chosen.id === noteId.current) return;
      setGhost({ markdown: renderNote(segmentsRef.current, '', { titled: !targetRef.current }).markdown, key: Date.now() });
      await undoDraft();
      // The full note, for its recording and phrases: this take's tape goes on the end of them.
      const full = (await getNote(chosen.id).catch(() => null)) ?? chosen;
      targetRef.current = full;
      draftNote.current = null;
      baseBody.current = null;
      noteId.current = full.id;
      setTarget(full);
      setMoves((n) => n + 1);
      // The next draft save writes the words so far to the note.
      setSegments([...segmentsRef.current]);
    },
    [undoDraft],
  );

  // The moved chip and the sliding words have their moment, then go.
  useEffect(() => {
    const settled = route?.phase === 'moved' || route?.phase === 'missed' || route?.phase === 'added' || route?.phase === 'said' || route?.phase === 'done' || (route?.phase === 'plugin' && route.state !== 'working');
    if (!settled || !route) return undefined;
    const timer = window.setTimeout(() => setRoute(null), route.phase === 'added' || route.phase === 'said' ? 3200 : 2200);
    return () => window.clearTimeout(timer);
  }, [route]);
  useEffect(() => {
    if (!ghost) return undefined;
    const timer = window.setTimeout(() => setGhost(null), 520);
    return () => window.clearTimeout(timer);
  }, [ghost]);

  /** Words arrived: a tip showing goes, and the next pause gets the next one. */
  const heard = () => {
    lastHeard.current = performance.now();
    setTip((showing) => {
      if (showing) tipTurn.current += 1;
      return null;
    });
  };

  // ---- commands: "Glyph", then what to do, then yes or no (capture/take.ts) ----------

  const commandWordOn = () => preferences().commandWord;

  /**
   * A note's body rewritten. `what` it was, in words, makes it the thing "undo" takes back.
   *
   * The note being recorded onto is a special case: the change goes into the note as it was before this take's
   * words, and the words are composed onto the end of that again. Applied to the stored note, which already holds
   * the words a draft saved, they were composed on a second time at the next save.
   */
  const updateNote = (id: string, change: (body: string) => string | null, what?: string): Promise<string | null> =>
    queueWrite(async () => {
      const fresh = await getNote(id);
      if (!fresh) return null;
      const continued = targetRef.current;
      if (continued?.id === id) {
        // No draft composed yet means the store holds the note as it was; otherwise the base is what drafts build on.
        const base = await (baseBody.current ??= Promise.resolve(fresh.body));
        const next = change(base);
        if (next === null || next === base) return null;
        if (what) lastChange.current = { id, before: base, what };
        baseBody.current = Promise.resolve(next);
        const updated = { ...fresh, body: next };
        targetRef.current = updated;
        // The page shows the change land, in its place above the words being said.
        setTarget(updated);
        const known = candidates.current.find((c) => c.id === id);
        if (known) known.note = updated;
        const saved = await updateStoredNote(id, appendBody(next, take.markdown({ titled: false, link: (text) => applyLinks(text, sentLinksRef.current), board: asBoardMarkdown })), fresh.revision ?? 1);
        targetRef.current = saved;
        if (known) known.note = saved;
        return next;
      }
      const body = change(fresh.body);
      if (body === null || body === fresh.body) return null;
      if (what) lastChange.current = { id, before: fresh.body, what };
      const saved = await updateStoredNote(id, body, fresh.revision ?? 1);
      const known = candidates.current.find((c) => c.id === id);
      if (known) known.note = saved;
      return body;
    });

  /** "Undo": the last change a command made comes out. What it was, or null when there is nothing to take back. */
  const undoLast = (): string | null => {
    const last = lastChange.current;
    if (!last) return null;
    lastChange.current = null;
    if (last.mutationId) {
      void undoCommandMutation(last.mutationId)
        .then((result) => {
          if (result.status !== 'undone') return;
          if (result.note) {
            const known = candidates.current.find((candidate) => candidate.id === result.note?.id);
            if (known) known.note = result.note;
            if (targetRef.current?.id === result.note.id) {
              targetRef.current = result.note;
              baseBody.current = Promise.resolve(result.note.body);
              setTarget(result.note);
            }
          } else {
            candidates.current = candidates.current.filter((candidate) => candidate.id !== last.id);
            if (targetRef.current?.id === last.id) {
              targetRef.current = null;
              draftNote.current = null;
              baseBody.current = null;
              noteId.current = newNoteId();
              setTarget(null);
            }
          }
        })
        .catch((failure: unknown) => console.warn('[glyph] command not undone:', failure));
    } else {
      void updateNote(last.id, () => last.before).catch((failure: unknown) => console.warn('[glyph] not undone:', failure));
    }
    return last.what;
  };

  /**
   * Items spoken for another note's list go straight into that note: its last
   * list grows by them, in its own style, while this take carries on where it
   * was. The chip and the landing preview show the lines arriving.
   */
  const addItems = async (note: Note, spoken: string, { how, task, many, target = null, near, items }: Placement) => {
    try {
      // The offer was made from this exact note snapshot. Confirmation is a
      // compare-and-swap, so a later edit or delete wins instead of being
      // overwritten by the voice command.
      const placed = placeWords(note.body, spoken, { how, task, many, near, items });
      if (!placed.added.length) return;
      const mutationId = newNoteId();
      const result = await applyCommandMutation({
        mutationId,
        noteId: note.id,
        kind: 'append',
        beforeRevision: note.revision ?? 1,
        beforeBody: note.body,
        afterBody: placed.body,
        source: note.source,
      });
      if (result.status === 'conflict') {
        setRoute({ phase: 'said', text: `${noteTitle(note.body) || 'That note'} changed after the preview, so nothing was added.` });
        fireNativeHaptic('warning');
        return;
      }
      const saved = result.note;
      const known = candidates.current.find((candidate) => candidate.id === saved.id);
      if (known) known.note = saved;
      if (targetRef.current?.id === saved.id) {
        targetRef.current = saved;
        baseBody.current = Promise.resolve(saved.body);
        setTarget(saved);
      }
      lastChange.current = { id: saved.id, before: note.body, what: `“${spoken}”`, mutationId };
      const show = (line: string) => line.replace(/^\s*(?:- \[[ xX]\] |[-*+] |\d+[.)] )/, '');
      if (targetRef.current?.id === saved.id) setRoute({ phase: 'done', text: `Added “${show(placed.added[0] ?? '')}”${placed.added.length > 1 ? ` and ${placed.added.length - 1} more` : ''}` });
      else setRoute({ phase: 'added', title: noteTitle(saved.body) || 'that note', body: saved.body, added: placed.added });
      fireNativeHaptic('success');
      lastSaid.current = { kind: 'items', noteId: saved.id, lines: placed.added };
      if (target) plugins.itemTargets().find((itemTarget) => itemTarget.word === target)?.afterAdd(saved.id, placed.added, captureContext);
    } catch (failure) {
      console.warn('[glyph] item not added:', failure);
      setRoute({ phase: 'missed', title: noteTitle(note.body) || 'that note' });
    }
  };

  // ---- plugins, by voice --------------------------------------------------------------

  /** What a plugin's voice command may do to this take (plugins/types.ts). Refs and setters only, so any render's copy works. */
  const captureContext: CaptureContext = {
    noteId: () => noteId.current,
    lastSaid: () => lastSaid.current,
    said: (text) => {
      lastSaid.current = { kind: 'take', text };
    },
    status: ({ state, lead, title }) => setRoute({ phase: 'plugin', state, lead: lead ?? null, title }),
    link: (text, url) => {
      sentLinksRef.current = [...sentLinksRef.current, { text, url }];
      setSentLinks(sentLinksRef.current);
    },
    append: (markdown) => {
      const at = take.segments[take.segments.length - 1]?.endMs ?? 0;
      take.segments = [...take.segments, { text: markdown, startMs: at, endMs: at }];
      syncTake();
    },
    updateNote: async (id, change) => {
      await updateNote(id, change);
    },
  };

  /** The words switched-on plugins let an item command end a note's name with ("…in Notion"). */
  const itemWordsOfPlugins = () => plugins.itemTargets().map((t) => t.word);

  /** A confirmed table for another note: its own block at the end of that note. */
  const addTable = async (note: Note, title: string, markdown: string) => {
    try {
      const body = await updateNote(note.id, (current) => appendBlock(current, markdown), 'the table');
      if (body === null) return;
      setRoute({ phase: 'done', text: `Table added to ${title}` });
      fireNativeHaptic('success');
    } catch (failure) {
      console.warn('[glyph] table not added:', failure);
      setRoute({ phase: 'said', text: `The table didn’t go into ${title}.` });
    }
  };

  /** Which tape this take is part of: the one a continued note holds, or a fresh one for a new file. */
  const tapeOfTake = (): string => {
    if (!takeTape.current) {
      const continued = targetRef.current;
      const appending = continued !== null && (continued.recordingMs ?? 0) > 0;
      takeTape.current = (appending ? tapeId(continued.id) : null) ?? freshTapeId();
    }
    return takeTape.current;
  };

  /** The take's segments and tables, copied to what the screen draws. */
  const syncTake = () => {
    segmentsRef.current = take.segments;
    setSegments(take.segments);
    setTables(take.tables);
    setAsBoard(take.asBoard);
  };

  // What the take asks of the recorder. Through a ref, so the take (made once) always reaches the newest render's code.
  const hostImpl = useRef<TakeHost<Note>>(null!);
  hostImpl.current = {
    notes: () => candidates.current,
    target: () => targetRef.current,
    commandWord: commandWordOn,
    instructionCommands: () => true,
    voiceCommands: () => plugins.voiceCommands(),
    itemTargets: itemWordsOfPlugins,
    understand: commandModelId.current ? (words) => understandInstructionCommand(words, candidates.current) : undefined,
    route: setRoute,
    offer: setPendingView,
    table: setTableView,
    itemWords: setItemWords,
    haptic: (kind) => fireNativeHaptic(kind),
    changed: syncTake,
    addItems: (target, spoken, placement) => void addItems(target, spoken, placement),
    changeNote: (target, change, title) =>
      void updateNote(target.id, change, `the change in ${title}`).then((body) => {
        if (body === null) setRoute({ phase: 'said', text: `${title} didn’t change.` });
        else {
          setRoute({ phase: 'done', text: `Done in ${title}` });
          fireNativeHaptic('success');
        }
      }),
    addTable: (target, title, markdown) => void addTable(target, title, markdown),
    moveTo: (target) => void routeTo(target),
    carryOn: (target) => void carryOn(target),
    // A finished recording's "new list" is created by `confirmPending`, not by carrying the capture on into it.
    newNote: (title) => void (finished.current ? undefined : startNewNote(title)),
    undo: undoLast,
    runPlugin: (voice, parsed) => voice.run(parsed, captureContext),
    describePlugin: (voice, parsed) => voice.describe(parsed, captureContext),
    clip: (span) => {
      // The tape a continued note already has comes first, so the clip points at the right sound in the whole recording.
      const offset = targetRef.current?.recordingMs ?? 0;
      return clipMarkdown({ startMs: span.startMs + offset, endMs: span.endMs + offset, tape: tapeOfTake() });
    },
    log: (line) => commandLog.current.push(line),
    said: (text) => {
      lastSaid.current = { kind: 'take', text };
    },
  };
  const [take] = useState(
    () =>
      new Take<Note>({
        notes: () => hostImpl.current.notes(),
        target: () => hostImpl.current.target(),
        commandWord: () => hostImpl.current.commandWord(),
        instructionCommands: () => hostImpl.current.instructionCommands(),
        voiceCommands: () => hostImpl.current.voiceCommands(),
        itemTargets: () => hostImpl.current.itemTargets(),
        get understand() {
          return hostImpl.current.understand;
        },
        route: (view) => hostImpl.current.route(view),
        offer: (offer) => hostImpl.current.offer(offer),
        table: (draft) => hostImpl.current.table(draft),
        itemWords: (text) => hostImpl.current.itemWords(text),
        haptic: (kind) => hostImpl.current.haptic(kind),
        changed: () => hostImpl.current.changed(),
        addItems: (target, spoken, placement) => hostImpl.current.addItems(target, spoken, placement),
        changeNote: (target, change, title) => hostImpl.current.changeNote(target, change, title),
        addTable: (target, title, markdown) => hostImpl.current.addTable(target, title, markdown),
        moveTo: (target) => hostImpl.current.moveTo(target),
        carryOn: (target) => hostImpl.current.carryOn(target),
        newNote: (title) => hostImpl.current.newNote(title),
        undo: () => hostImpl.current.undo(),
        runPlugin: (voice, parsed) => hostImpl.current.runPlugin(voice, parsed),
        describePlugin: (voice, parsed) => hostImpl.current.describePlugin(voice, parsed),
        clip: (span) => hostImpl.current.clip(span),
        log: (line) => hostImpl.current.log(line),
        said: (text) => hostImpl.current.said(text),
      }),
  );

  const confirmPending = () => {
    take.confirm(performance.now());
    const final = finalCommand.current;
    if (!final) return;
    finalCommand.current = null;
    if (final.trace !== undefined) settleRecording(final.trace, 'confirmed');
    void writes.current.then(async () => {
      let saved = await runFinalActions(final.actions, final.rest);
      if (saved && final.recordedMs !== null) {
        const recordingMs = await reassignRecording(final.temporaryId, saved.id, (saved.recordingMs ?? 0) > 0).catch(() => null);
        if (recordingMs !== null) saved = (await setNoteRecording(saved.id, recordingMs, saved.segments ?? []).catch(() => saved)) ?? saved;
      } else if (final.recordedMs !== null) {
        void discardRecording(final.temporaryId).catch(() => undefined);
      }
      endCapture(final.locked);
      onFinish(saved, final.locked);
    });
  };
  /**
   * A confirmed recording's changes, one after another, each a guarded write
   * against the note as it is now. Answers the note that keeps the recording:
   * the rest-of-what-was-said note when there is one, else the first note changed.
   */
  const runFinalActions = async (actions: readonly VoiceAction<Candidate & { note: Note }>[], rest: string | null): Promise<Note | null> => {
    let keeper: Note | null = null;
    for (const action of actions) {
      if (action.do === 'create') {
        keeper ??= await createFinalList(action.title, action.items, action.tasks);
        continue;
      }
      const fresh = (await getNote(action.note.id).catch(() => null)) ?? action.note.note;
      const placed = placeWords(fresh.body, action.text, action.placement);
      if (!placed.added.length) continue;
      const result = await applyCommandMutation({
        mutationId: newNoteId(),
        noteId: fresh.id,
        kind: 'append',
        beforeRevision: fresh.revision ?? 1,
        beforeBody: fresh.body,
        afterBody: placed.body,
        source: fresh.source,
      }).catch(() => null);
      if (result?.status === 'applied') keeper ??= result.note;
      else setRoute({ phase: 'said', text: `${action.note.title} changed after the preview, so nothing was added to it.` });
    }
    if (rest) keeper = (await createFinalNote(rest)) ?? keeper;
    return keeper;
  };
  /** The confirmed new list of a finished recording: its title, then its items as a list. */
  const createFinalList = async (title: string, items: readonly string[], tasks = false): Promise<Note | null> => {
    const named = listTitle(title);
    return createFinalNote(items.length ? appendToList(named, items, { asTasks: tasks }).body : named);
  };
  const createFinalNote = async (body: string): Promise<Note | null> => {
    const result = await applyCommandMutation({
      mutationId: newNoteId(),
      noteId: newNoteId(),
      kind: 'create',
      beforeRevision: null,
      beforeBody: null,
      afterBody: body,
      source: 'capture',
    }).catch(() => null);
    if (result?.status !== 'applied') {
      setRoute({ phase: 'said', text: 'That note could not be created safely.' });
      return null;
    }
    return result.note;
  };
  const cancelPending = (why: string | null) => {
    take.cancel(why, performance.now());
    const final = finalCommand.current;
    if (!final) return;
    finalCommand.current = null;
    if (final.trace !== undefined) settleRecording(final.trace, final.keep ? 'cancelled, kept as a note' : 'cancelled');
    if (final.keep) {
      void final.keep();
      return;
    }
    void discardRecording(final.temporaryId).catch(() => undefined);
    endCapture(final.locked);
    onFinish(null, final.locked);
  };
  const finishTable = () => take.finishTable(performance.now());
  const cancelTable = (why: string | null) => take.cancelTable(why);
  // ---- start ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const held: Float32Array[] = [];

    async function start() {
      const simulate = new URLSearchParams(window.location.search).has('simulate');
      try {
        if (isTauri() && !simulate) {
          const handlers: MicrophoneHandlers = {
            onChunk: (samples) => {
              // A start that was called off keeps nothing it hears (see the microphone opening below).
              if (cancelled) return;
              counts.current.heardSamples += samples.length;
              if (sessionRef.current) sessionRef.current.push(samples);
              else held.push(samples);
            },
            onLevel: (rms) => {
              // Straight to a custom property: five updates a second is too many
              // React renders for a meter nobody reads precisely. The screen
              // carries it too, for the side key's rings to swell with.
              const level = String(Math.min(1, rms * 8));
              meterRef.current?.style.setProperty('--level', level);
              screenRef.current?.style.setProperty('--level', level);
              publishVoiceLevel(Math.min(1, rms * 8));
              quiet.current?.level(rms, performance.now());
            },
          };
          const opened = await openMicrophone(handlers);
          // Called off while the microphone was opening (React's development double start, or the screen closed at
          // once): this start's microphone goes, rather than living on unowned and feeding the next start's session
          // a second copy of every chunk, interleaved - a take that plays back choppy at half speed, and that the
          // voice model hears as nonsense.
          if (cancelled) {
            opened.stop();
            return;
          }
          micRef.current = opened;
          const mic = micRef.current;
          if (mic) {
            counts.current.deviceRate = mic.deviceRate;
            console.info(`[glyph] microphone open at ${mic.deviceRate} Hz, context ${mic.state()}`);
          }
        }
        const session = await startCapture({
          onPartial: (text) => {
            if (text) {
              counts.current.partials += 1;
              quiet.current?.words(performance.now());
              heard();
            }
            setPartial(text);
            // A partial is display only.  It cannot influence routing or a
            // model prompt before Whisper has committed the final transcript.
          },
          onSegment: (raw) => {
            counts.current.segments += 1;
            quiet.current?.words(performance.now());
            heard();
            counts.current.lastError = null;
            heardRef.current.push(raw.text);
            take.listen(raw);
            setPartial('');
          },
          onError: (message) => {
            counts.current.errors += 1;
            counts.current.lastError = message;
            console.warn('[glyph] capture error:', message);
            setError(message);
          },
          onModelProgress: (received, total) => setDownload({ received, total }),
        });
        if (cancelled) {
          session.cancel();
          micRef.current?.stop();
          return;
        }
        sessionRef.current = session;
        if (session.wantsSamples) held.splice(0).forEach((samples) => session.push(samples));
        else micRef.current?.stop();
        setEngine(session.kind);
        setDownload(null);
        setPhase('listening');
        console.info(`[glyph] capture started with ${session.kind}`);
        if (!fromAssistant) fireNativeHaptic('medium');
      } catch (failure) {
        if (cancelled) return;
        micRef.current?.stop();
        setError(failure instanceof Error ? failure.message : String(failure));
        setPhase('failed');
        fireNativeHaptic('error');
      }
    }
    void start();

    return () => {
      cancelled = true;
      if (!finished.current) {
        sessionRef.current?.cancel();
        micRef.current?.stop();
      }
    };
    // Started once per mount; a new capture is a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- the counter ---------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'listening') return undefined;
    const timer = window.setInterval(() => {
      setRecorded(sessionRef.current?.positionMs() ?? 0);
      setDiagnostics({ ...counts.current });
      const now = performance.now();
      // A command being said, or waiting for its yes, holds the recording open.
      const commanding = take.commanding;
      take.tick(now);
      if (!commanding && quiet.current?.due(now)) void finishRef.current();
      // A pause: one tip, until words come again.
      if (now - lastHeard.current > TIP_AFTER_MS) {
        setTip((showing) => {
          if (showing) return showing;
          const recent = candidates.current.find((c) => c.id !== noteId.current)?.title ?? null;
          const keyword = commandWordOn();
          const pluginTips = plugins.tips(recent ?? null).map((t) => (keyword ? { ...t, say: `Hey Ghost, ${t.say.charAt(0).toLowerCase()}${t.say.slice(1)}` } : t));
          const lane = targetRef.current ? (lanesOf(targetRef.current.body)[1] ?? lanesOf(targetRef.current.body)[0])?.name ?? null : null;
          const list = [...tips({ noteTitle: recent, continuing: targetRef.current !== null, keyword, lane }), ...pluginTips];
          return list[tipTurn.current % list.length] ?? null;
        });
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, take]);

  // No draft timer: phrase commits are display-only.  The complete transcript
  // is saved exactly once after final instruction classification.

  // ---- ending ----------------------------------------------------------------------
  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    setCapturing(false);
    setPhase('finishing');
    micRef.current?.stop();
    // A voice memo still running is closed by Done: what was said up to here is its sound.
    // The tape is kept under the note's id, added to the end of the continued
    // note's tape when there is one, so its words and its sound stay one timeline.
    const continued = targetRef.current;
    let stopped: Stopped = { recordedMs: null, transcript: null };
    try {
      // Appended only onto a tape the note still has: a recording removed from the note leaves its file behind, and a
      // take added after it starts the file afresh rather than playing after the removed sound.
      stopped = (await sessionRef.current?.stop({ recordAs: noteId.current, append: continued !== null && (continued.recordingMs ?? 0) > 0 })) ?? stopped;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }

    const committed = take.segments;
    // Native's stop-time result includes words whose phrase event was still in
    // flight when `stop()` detached event listeners. It is the one transcript
    // command classification may inspect; browser/simulated engines fall back
    // to their committed phrases because they explicitly return null.
    // Whisper's echo of the last words on the quiet after them ("…to Go. Go. Go.") is not speech (trailingEcho.ts).
    const transcript = withoutTrailingEcho(stopped.transcript ?? committed.map((segment) => segment.text).join(' ').trim());
    const spoken = segmentsWithoutTrailingEcho(appendFinalTranscriptSuffix(committed, stopped.transcript, sessionRef.current?.positionMs() ?? committed.at(-1)?.endMs ?? 0));
    const appended = spoken.slice(committed.length);
    for (const segment of appended) {
      // `listen` remains display-only, so completing the ordinary-note stream
      // here cannot revive phrase-level routing or execution.
      take.listen(segment);
      heardRef.current.push(segment.text);
    }
    const { plain } = renderNote(spoken);
    const locked = isLocked();

    /** This recording saved as a note of its words: dictation, or a command found in it that was not carried out. */
    const keepAsNote = async (): Promise<void> => {
      // A command's change still landing, or the take carrying on elsewhere: written before the note is.
      await writes.current;

      if (!plain.trim() && !take.tables.length && !take.clips.length) {
        await undoDraft();
        endCapture(locked);
        onFinish(null, locked);
        return;
      }

      const markdown = take.markdown({ titled: !targetRef.current, link: (text) => applyLinks(text, sentLinksRef.current), board: asBoardMarkdown });
      const saved = await queueWrite(async () => persistBody(noteId.current, await compose(markdown), 'capture'));
      let refineJob: ReviewHandoff['job'] = null;
      if (stopped.recordedMs !== null && sessionRef.current?.keepsAudio) {
        // New phrases sit after the continued tape's, shifted by its length.
        const offset = continued?.recordingMs ?? 0;
        const prior = continued?.segments ?? [];
        const all = [...prior, ...spoken.map((s) => ({ ...s, startMs: s.startMs + offset, endMs: s.endMs + offset }))];
        await setNoteRecording(saved.id, stopped.recordedMs, all).catch((failure: unknown) => console.warn('[glyph] recording not kept:', failure));
        // The tape this take wrote to, so its voice memos know it again when the note is opened (core/clips.ts).
        setTapeId(saved.id, tapeOfTake());
        // The better words: the larger model over this take's recording, later,
        // or now in the review after a recording when that runs.
        const base = continued ? ((await baseBody.current) ?? continued.body) : '';
        refineJob = {
          id: saved.id,
          fromMs: offset,
          recordingMs: stopped.recordedMs,
          baseBody: base,
          savedBody: saved.body,
          titled: !continued,
          priorSegments: prior,
          promptTail: renderNote(prior).plain.slice(-200),
          skip: take.commandSpans.map((span) => ({ startMs: span.startMs + offset, endMs: span.endMs + offset })),
          // The voice memos this take left: the better words never heard them, and they go back where they were.
          clips: take.clips.map((clip) => ({ ...clip, startMs: clip.startMs + offset, endMs: clip.endMs + offset })),
          keywordAt: take.keywordSpans.map((span) => ({ startMs: span.startMs + offset, endMs: span.endMs + offset })),
        };
      }
      fireNativeHaptic('success');
      endCapture(locked);
      // The review after a recording: it runs the better words and the formatting when it is done.
      // Not over a locked phone, whose note is not shown to whoever is holding it.
      if (!locked && (await reviewAvailable())) {
        onFinish(saved, locked, { noteId: saved.id, job: refineJob, heard: heardRef.current.join(' '), commands: [...commandLog.current], touched: [...take.touched] });
        return;
      }
      if (refineJob) enqueueRefine(refineJob);
      // The staged rewrite (format/queue.ts): a quick draft, then slower models
      // revising it. After the refine job, which it waits for.
      enqueueFormat(saved.id);
      onFinish(saved, locked);
    };

    const decision = await classifyFinalTranscript(transcript, candidates.current);
    if (decision.kind === 'offer') {
      // The stopped audio is already retained under this capture id.  The
      // changes remain pending until this card is explicitly confirmed.
      const said = take.segments;
      take.offerChanges(changesCard(decision.actions, decision.note), performance.now());
      // Found inside dictation: declined, the recording is kept as the note it may have been.
      const keep = decision.conversational
        ? async () => {
            for (const segment of said) take.listen(segment);
            await keepAsNote();
          }
        : undefined;
      finalCommand.current = {
        actions: decision.actions,
        rest: decision.note,
        ...(decision.trace !== undefined ? { trace: decision.trace } : {}),
        ...(keep ? { keep } : {}),
        locked,
        temporaryId: noteId.current,
        recordedMs: stopped.recordedMs,
      };
      setPhase('listening');
      return;
    }
    if (decision.kind === 'rejected') {
      // Unsupported, destructive, ambiguous, and missing-target command
      // shapes fail closed: do not create a note containing command prose.
      setRoute({ phase: 'said', text: decision.reason });
      await discardRecording(noteId.current).catch(() => undefined);
      await undoDraft();
      endCapture(locked);
      onFinish(null, locked);
      return;
    }
    if (decision.notice) setRoute({ phase: 'said', text: decision.notice });

    await keepAsNote();
  }, [onFinish, compose, undoDraft, take]);

  // The side key held again: Done.
  useEffect(() => {
    if (stopRequests) void finish();
    // Only a new press should act, not a re-created callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRequests]);

  // The side key pressed: the screen went off, so the take is saved as Done
  // would save it. Always the newest `finish`, through a ref, so the handler
  // is registered once.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => answerHost('screenOff', () => void finishRef.current()), []);

  const cancel = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    setCapturing(false);
    sessionRef.current?.cancel();
    micRef.current?.stop();
    await undoDraft();
    const locked = isLocked();
    endCapture(locked);
    onFinish(null, locked);
  }, [onFinish, undoDraft]);

  // The phone's back gesture ends the take the way Done does: what was said
  // is kept, and a take with nothing in it leaves nothing behind.
  useBack(true, () => void finish());

  // ---- the line at the top -----------------------------------------------------------
  const locked = isLocked();
  let status: string | null = null;
  if (phase === 'failed') status = error ?? 'Could not start';
  else if (download) status = `Downloading voice model ${Math.round(download.received / 1e6)} / ${Math.round(download.total / 1e6)} MB`;
  else if (phase === 'starting') status = 'Starting';
  else if (phase === 'finishing') status = 'Saving';
  else if (error && !segments.length) status = `Problem: ${error}`;
  const where = target ? (locked ? 'Adding to your last note' : `Adding to “${noteTitle(target.body)}”`) : 'New note';

  // A capture that has heard a while and produced nothing is the one worth
  // explaining without being asked: the line that diagnosed the Fold.
  const silent = engine === 'whisper' && diagnostics.heardSamples > 8 * 16_000 && !diagnostics.partials && !diagnostics.segments;
  const hasWords = note.markdown.length > 0;

  return (
    <div className={styles.screen} data-phase={phase} ref={screenRef}>
      {fromAssistant && (phase === 'starting' || phase === 'listening') ? <SideKeyWaves spot={spot} /> : null}
      <div ref={topRef} className={`app-headerPane ${styles.top}`} role="status" aria-live="polite">
        {status ? (
          <span className={styles.where}>{status}</span>
        ) : (
          <>
            {/* Tapping the line shows what the pipeline has done, for diagnosing a silent capture. */}
            <button type="button" className={`app-word ${styles.where}`} onClick={() => setShowDiagnostics((on) => !on)}>
              {where}
            </button>
            {target ? (
              <button type="button" className={`app-word ${styles.newNote}`} onClick={() => void startNewNote()}>
                New note
              </button>
            ) : null}
          </>
        )}
        <span className={styles.counter} aria-label={`Recorded ${counter(recorded)}`}>
          {counter(recorded)}
        </span>
      </div>

      <div className={styles.body}>
        {ghost ? (
          <div key={`ghost-${ghost.key}`} className={styles.ghost} aria-hidden="true">
            <Tail markdown={ghost.markdown} pendingFrom={null} />
          </div>
        ) : null}
        {route?.phase === 'added' ? (
          <ListLanding key={`landing-${route.added.join('|')}`} title={route.title} body={route.body} added={route.added} />
        ) : phase === 'failed' && !hasWords ? (
          <div className={styles.empty}>
            <Opening failed />
            <p className={styles.lead}>Nothing was recorded.</p>
          </div>
        ) : (
          // The note's own page, its older text above and the words written onto its end (LivePage.tsx). Over the lock
          // screen the note being continued shows none of its text.
          <LivePage
            // The editor reads its placeholder once, so the page is remade when the recorder is up: "Say which note." after "Starting…".
            key={`page-${target?.id ?? 'new'}-${moves}-${phase === 'starting' ? 'starting' : 'up'}`}
            base={target && !locked ? target.body : ''}
            markdown={note.markdown}
            under={topRef}
            placeholder={phase === 'starting' ? 'Starting…' : 'Start talking.'}
          />
        )}
        {!hasWords && phase === 'listening' && !route ? <Ghost scene="listening" align="center" className={styles.listenGhost} /> : null}
        {!hasWords && phase !== 'failed' && route?.phase !== 'added' ? <p className={styles.pageHint}>{stopHint(fromAssistant, pressStops, quiet.current !== null)}</p> : null}
      </div>

      {tableView ? (
        <TableCard draft={tableView} heard={itemWords} onDone={finishTable} onCancel={() => cancelTable(null)} />
      ) : pending ? (
        <ConfirmCard offer={pending} onConfirm={confirmPending} onCancel={() => cancelPending(null)} />
      ) : route ? (
        <p
          className={styles.route}
          data-phase={
            route.phase === 'plugin' ? (route.state === 'done' ? 'moved' : route.state === 'failed' ? 'missed' : 'hearing') : route.phase === 'command' ? 'hearing' : route.phase === 'said' ? 'missed' : route.phase === 'done' ? 'moved' : route.phase
          }
          role="status"
        >
          {route.phase === 'hearing' ? (
            <>
              <span className={styles.routeDots} aria-hidden="true" />
              {route.guess ? (
                <>
                  {route.lead} <strong>{route.guess}</strong>
                </>
              ) : (
                <>Looking for “{route.name}”</>
              )}
            </>
          ) : route.phase === 'waiting' ? (
            itemWords ? (
              <>
                <strong>{route.title}:</strong> {itemWords}
              </>
            ) : (
              <>
                <span className={styles.routeDots} aria-hidden="true" />
                {route.leave ? 'Say the note for' : route.many ? 'Say the items for' : 'Say the item for'} <strong>{route.title}</strong>
              </>
            )
          ) : route.phase === 'plugin' ? (
            route.state === 'failed' ? (
              <>{route.title}</>
            ) : (
              <>
                <span className={route.state === 'working' ? styles.routeDots : styles.routeTick} aria-hidden="true" />
                {route.lead ? `${route.lead} ` : null}
                <strong>{route.title}</strong>
              </>
            )
          ) : route.phase === 'command' ? (
            <>
              <span className={styles.routeDots} aria-hidden="true" />
              <span>
                <strong>Hey Ghost</strong>
                {route.words || partialCommand(itemWords) ? `: ${[route.words, partialCommand(itemWords)].filter(Boolean).join(' ')}` : ', listening for a command'}
                {route.thinking ? <span className={styles.routeThinking}> · working it out</span> : null}
              </span>
            </>
          ) : route.phase === 'said' ? (
            <>{route.text}</>
          ) : route.phase === 'done' ? (
            <>
              <span className={styles.routeTick} aria-hidden="true" />
              {route.text}
            </>
          ) : route.phase === 'added' ? (
            <>
              <span className={styles.routeTick} aria-hidden="true" />
              {route.added.length === 1 ? 'Added to' : `${route.added.length} added to`} <strong>{route.title}</strong>
            </>
          ) : route.phase === 'moved' ? (
            <>
              <span className={styles.routeTick} aria-hidden="true" />
              {route.title === 'New note' ? 'New note' : (
                <>
                  Now on <strong>{route.title}</strong>
                </>
              )}
            </>
          ) : (
            <>No note called “{route.title}”, so it stays here</>
          )}
        </p>
      ) : tip && phase === 'listening' ? (
        <p key={tip.say} className={styles.tip}>
          Say <strong>“{tip.say}”</strong> {tip.does}.
        </p>
      ) : null}

      {showDiagnostics || silent || diagnostics.errors ? (
        <p className={styles.diagnostics}>{[engine ? ENGINE_LABEL[engine] : null, describe(diagnostics)].filter(Boolean).join(' · ')}</p>
      ) : null}

      <footer className={styles.footer}>
        <button type="button" className="app-word" onClick={() => void cancel()} disabled={phase === 'finishing'}>
          Discard
        </button>
        <button
          type="button"
          className={`app-pill ${styles.done}`}
          onClick={() => void finish()}
          disabled={phase === 'failed' || phase === 'finishing'}
          aria-label="Stop and save"
        >
          <div className={styles.meter} ref={meterRef} aria-hidden="true" />
          <Square size={16} aria-hidden="true" />
          Done
        </button>
      </footer>
    </div>
  );
}

/** The take's words as a board, when "make this a board" was said and there is a list to make one of. */
function asBoardMarkdown(markdown: string): string {
  return boardFrom(markdown)?.doc ?? markdown;
}

/** The words of a command still being said, with the keyword taken off if it is in them. */
function partialCommand(text: string): string {
  return (findKeyword(text)?.after ?? text).trim();
}

/** What the card says a finished recording's changes are: the lines as they will land. */
function changesCard(actions: readonly VoiceAction<Candidate & { note: Note }>[], rest: string | null): { heading: string; action: string; lines: string[]; detail: string | null } {
  const show = (line: string) => line.replace(/^\s*(?:- \[[ xX]\] |[-*+] |\d+[.)] )/, '').replace(/\\(.)/g, '$1');
  const one = actions.length === 1 && !rest ? actions[0] : null;
  const lines: string[] = [];
  for (const action of actions) {
    const added =
      action.do === 'create'
        ? action.items
        : placeWords(action.note.note.body, action.text, action.placement).added;
    if (!one) lines.push(action.do === 'create' ? `New list: ${listTitle(action.title)}` : `Add to ${action.note.title}:`);
    for (const line of added) lines.push(`${one ? '' : '  '}${show(line)}`);
  }
  if (rest) lines.push(`Keep as a note: “${show(rest).slice(0, 120)}${rest.length > 120 ? '…' : ''}”`);
  if (one?.do === 'create') return { heading: `Create ${listTitle(one.title).replace(/\\(.)/g, '$1')}`, action: 'Create', lines, detail: one.items.length ? 'As a new list' : null };
  if (one?.do === 'append') {
    const into = one.placement.how === 'item' ? 'In its list' : 'Where it fits';
    return { heading: `Add to ${one.note.title}`, action: 'Add', lines, detail: into };
  }
  return { heading: actions.length > 1 ? `${actions.length} changes` : 'This change', action: 'Do it', lines, detail: null };
}

/**
 * "Shall I?": what a command understood will do, before it does anything.
 *
 * The note's name, the lines as they will land (in its list, or as a
 * paragraph), and the two answers. "Yes" or "no" said aloud answer it as well
 * as a tap does, and saying nothing for a while is a no.
 */
function ConfirmCard({ offer, onConfirm, onCancel }: { offer: Offer<Note>; onConfirm: () => void; onCancel: () => void }) {
  const show = (line: string) => line.replace(/^\s*(?:- \[[ xX]\] |[-*+] |\d+[.)] )/, '');
  let heading: string;
  let action: string;
  let lines: string[] = [];
  let detail: string | null = null;
  switch (offer.kind) {
    case 'place':
      heading = `Add to ${offer.title}`;
      action = 'Add';
      lines = offer.added.map(show);
      detail = offer.into === 'list' ? 'In its list' : 'As a new paragraph';
      if (offer.placement.target) detail += `, then to ${offer.placement.target.charAt(0).toUpperCase()}${offer.placement.target.slice(1)}`;
      break;
    case 'change':
      heading = `${offer.heading} in ${offer.title}`;
      action = offer.action;
      lines = offer.lines;
      break;
    case 'board':
      heading = 'Make this note a board';
      action = 'Make it';
      detail = 'Its list items become cards';
      break;
    case 'move':
      heading = `Move this recording to ${offer.title}`;
      action = 'Move';
      break;
    case 'new':
      heading = offer.title ? `Create ${listTitle(offer.title)}` : 'Start a new note from here';
      action = offer.title ? 'Create' : 'Start';
      lines = [...(offer.lines ?? [])];
      if (offer.lines?.length) detail = 'As a new list';
      break;
    case 'table':
      heading = `Add this table to ${offer.title}`;
      action = 'Add';
      detail = `${offer.rows.length} ${offer.rows.length === 1 ? 'row' : 'rows'}, at the end of the note`;
      break;
    case 'plan':
      heading = offer.heading;
      action = offer.action;
      lines = offer.lines;
      detail = offer.detail;
      break;
    default:
      heading = offer.title;
      action = offer.action;
  }
  return (
    <section className={styles.confirm} aria-live="assertive" aria-label={heading}>
      <p className={styles.confirmHeading}>{heading}</p>
      {lines.map((line, i) => (
        <p key={i} className={styles.confirmLine}>
          {line}
        </p>
      ))}
      {offer.kind === 'table' ? <TablePreview columns={offer.columns} rows={offer.rows} /> : null}
      {detail ? <p className={styles.confirmDetail}>{detail}</p> : null}
      <div className={styles.confirmActions}>
        <button type="button" className="app-word" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="app-pill" onClick={onConfirm}>
          {action}
        </button>
      </div>
      <p className={styles.confirmHint}>Or say “yes” or “no”.</p>
    </section>
  );
}

/** A table as it will look, small, scrolling sideways inside the card when it is wide. */
function TablePreview({ columns, rows }: { columns: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((label, i) => (
              <th key={i}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {columns.map((_, i) => (
                <td key={i}>{row[i] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "And what will the column labels be?": the table being said, one question
 * at a time. Matt wanted the recorder to guide a table rather than expect it in
 * one breath, so the card asks for the labels, then the first row, then the
 * next or "done", showing the table as it grows and the words being heard
 * for the piece it asked for.
 */
function TableCard({ draft, heard, onDone, onCancel }: { draft: TableDraft<Note>; heard: string; onDone: () => void; onCancel: () => void }) {
  const question = !draft.columns.length ? 'What will the column labels be?' : draft.rows.length ? 'Next row? Or say “done”.' : 'What goes in the first row?';
  const hint = !draft.columns.length ? 'Say them with commas, like “bug, owner, status”.' : `In order: ${draft.columns.join(', ')}.`;
  const words = heard ? (findKeyword(heard)?.after ?? heard) : '';
  return (
    <section className={styles.confirm} aria-live="polite" aria-label={`Table for ${draft.title}`}>
      <p className={styles.confirmHeading}>Table for {draft.title}</p>
      <p className={styles.tableQuestion}>{question}</p>
      {draft.columns.length ? <TablePreview columns={draft.columns} rows={draft.rows} /> : null}
      {words ? <p className={styles.confirmDetail}>“{words}”</p> : <p className={styles.confirmHint}>{hint}</p>}
      <div className={styles.confirmActions}>
        <button type="button" className="app-word" onClick={onCancel}>
          Cancel
        </button>
        {draft.columns.length ? (
          <button type="button" className="app-pill" onClick={onDone}>
            That’s all
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Items landing in another note's list: the note's name, the list's last lines
 * as they were, and the new lines arriving under them with a tick each.
 */
function ListLanding({ title, body, added }: { title: string; body: string; added: string[] }) {
  const lines = body.split('\n');
  const end = lines.lastIndexOf(added[added.length - 1] ?? '');
  const start = end - added.length + 1;
  const before = lines.slice(Math.max(0, start - 2), Math.max(0, start)).filter((line) => line.trim());
  const show = (line: string) => line.replace(/^\s*(?:- \[[ xX]\] |[-*+] |\d+[.)] )/, '');
  return (
    <div className={styles.landing} aria-label={`Added to ${title}`}>
      <p className={styles.contextTitle}>{title}</p>
      {before.map((line, i) => (
        <p key={`b${i}`} className={styles.contextLine}>
          {show(line)}
        </p>
      ))}
      {added.map((line, i) => (
        <p key={`a${i}`} className={styles.landed} style={{ animationDelay: `${120 + i * 140}ms` }}>
          <span className={styles.landedTick} aria-hidden="true" />
          {show(line)}
        </p>
      ))}
    </div>
  );
}

/** What ends this recording, in a line under "Start talking." */
function stopHint(fromSideKey: boolean, pressStops: boolean, quietStops: boolean): string {
  const key = pressStops ? 'press the side key' : fromSideKey ? 'hold the side key again' : null;
  if (quietStops) return key ? `Stop talking to finish, or ${key}.` : 'Stop talking to finish, or tap Done.';
  if (key) return `${key[0]!.toUpperCase()}${key.slice(1)} to stop.`;
  return 'Tap Done to stop.';
}

interface Diagnostics {
  heardSamples: number;
  deviceRate: number | null;
  partials: number;
  segments: number;
  errors: number;
  lastError: string | null;
}

const EMPTY_DIAGNOSTICS: Diagnostics = {
  heardSamples: 0,
  deviceRate: null,
  partials: 0,
  segments: 0,
  errors: 0,
  lastError: null,
};

/** "heard 8.2 s at 48 kHz · 3 guesses · 1 phrase", plus the last error if there is one. */
function describe(d: Diagnostics): string {
  const parts = [`heard ${(d.heardSamples / 16_000).toFixed(1)} s${d.deviceRate ? ` at ${Math.round(d.deviceRate / 1000)} kHz` : ''}`];
  parts.push(`${d.partials} ${d.partials === 1 ? 'guess' : 'guesses'}`);
  parts.push(`${d.segments} ${d.segments === 1 ? 'phrase' : 'phrases'}`);
  if (d.errors) parts.push(`${d.errors} ${d.errors === 1 ? 'error' : 'errors'}: ${d.lastError ?? ''}`);
  return parts.join(' · ');
}
