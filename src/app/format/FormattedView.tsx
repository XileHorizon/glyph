import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { ContextMenu } from '../editor/ContextMenu.tsx';
import { Editor } from '../editor/Editor.tsx';
import { gb, modelName, MODELS, useModels } from '../core/ai.ts';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import { usePreferences } from '../core/preferences.ts';
import { isTauri } from '../core/tauri.ts';
import type { Formatter } from './formatter.ts';
import { AiCard } from './AiCard.tsx';
import { modeWords } from './modes.ts';
import { APPLIED, EDITED } from './pipeline.ts';
import styles from './Formatted.module.css';

/** A pause in typing after which an edit is kept, as the note's own editor does. */
const KEEP_DEBOUNCE_MS = 400;

/** Where the text goes: in place of the note, above it, or below it. */
export type ApplyHow = 'replace' | 'prepend' | 'append';

/**
 * The robot's view of a note: the model's text in the chosen mode - the note
 * formatted, summarized or enhanced - drawn with the same markdown renderer
 * as the note itself, filling in as it is written.
 *
 * One line above the text says what is happening - loading the model,
 * reading the note, writing at so many tokens a second, a draft done and a
 * revision under way, done with which model, or that the note has changed
 * since - and carries the words that act on it: Stop, Apply, Update, Redo,
 * Try again, Close. Opened on a note that still owes passes (nothing kept,
 * or only a draft by a smaller model), it starts them itself; that is what
 * the view is for. The passes are the pipeline's (format/pipeline.ts): a
 * quick draft, then the slower models in turn.
 *
 * The text streams into the editor as appends rather than replacements: the
 * editor's `value` is the text at mount, and every report after that is
 * dispatched as the change from what is shown to what has arrived, with the
 * end kept in view. A full replace per report would work and would jump.
 *
 * Once written, it is a note: it scrolls, it has the press-and-hold menu, and
 * it can be edited - the model's words are a draft of the person's, not a
 * verdict on them. An edit is kept as the mode's text after a pause in
 * typing (and on leaving), marked as theirs so no pass revises it; the note
 * changing, or Redo, is what asks the model again. While a pass is writing
 * the text is read-only, so the two are never typing over each other.
 */
export function FormattedView({
  formatter,
  currentBody,
  dark,
  onApply,
  onClose,
}: {
  formatter: Formatter;
  currentBody: () => string;
  dark: boolean;
  /** Puts the text into the note - in place of it, above it or below it; the screen owns the note's editor, so it does the editing. */
  onApply?: (text: string, how: ApplyHow) => void;
  /** Back to the note: the Close word, and the phone's back gesture. */
  onClose: () => void;
}) {
  const { state, ready } = formatter;
  const words = modeWords(formatter.mode);
  const text = state.kind === 'none' ? '' : state.text;
  const models = useModels();
  const prefs = usePreferences();
  const chosen = MODELS.find((m) => m.id === formatter.model);
  const present = models.models.filter((m) => m.present).map((m) => m.id);
  const anyPresent = present.length > 0;
  const [initial] = useState(() => text);
  const view = useRef<EditorView | null>(null);
  // The view again, as state, for the menu: a ref alone would hand it null once and never again.
  const [editor, setEditor] = useState<EditorView | null>(null);
  const shown = useRef(initial);
  // Whether the change going into the editor is the pipeline's, not the person's.
  const applying = useRef(false);
  // A pass writing: the text is the model's for now.
  const busy = state.kind === 'running' || (state.kind === 'done' && state.revising !== null);

  // The phone's back gesture: the note.
  useBack(true, onClose);

  // Passes still owed, a model here: start them. Once per mount, so a Stop
  // stays stopped - and never before the kept text has been read, or a note
  // with a kept text would be written again for having been opened.
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current || !anyPresent || models.models.length === 0) return;
    if (state.kind !== 'none' && state.kind !== 'done') return;
    if (state.kind === 'done' && state.revising) return;
    // An empty note has nothing to work from, and a model asked anyway makes
    // a note up (measured: the 2B wrote a meeting agenda from nothing).
    if (!currentBody().trim()) return;
    started.current = true;
    if (formatter.owed(currentBody(), present).length) formatter.start(currentBody(), present);
    // `present` is derived from models.models, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, anyPresent, models.models, state.kind, formatter, currentBody]);

  // A tick under the thumb as the words arrive: the phone's lightest haptic,
  // at most one per report and never for a report that brought nothing.
  const lastTick = useRef(0);
  useEffect(() => {
    if (state.kind !== 'running' || text === '' || text === shown.current) return;
    const now = performance.now();
    if (now - lastTick.current < 100) return;
    lastTick.current = now;
    fireNativeHaptic('selection');
  }, [text, state.kind]);

  // Every report: the change from what is shown to what has arrived.
  useEffect(() => {
    const editor = view.current;
    if (!editor || text === shown.current) return;
    const common = commonPrefix(shown.current, text);
    applying.current = true;
    try {
      editor.dispatch({
        changes: { from: common, to: shown.current.length, insert: text.slice(common) },
        selection: { anchor: text.length },
        scrollIntoView: state.kind === 'running',
      });
    } finally {
      applying.current = false;
    }
    shown.current = text;
  }, [text, state.kind]);

  // The person's edits, kept after a pause in typing and on leaving. The
  // pipeline's own appends come through the effect above with `applying`
  // set and are not theirs. Read through refs: the formatter object is new
  // on every render, and a flush must not run on every render.
  const keepRef = useRef(formatter.keep);
  keepRef.current = formatter.keep;
  const bodyRef = useRef(currentBody);
  bodyRef.current = currentBody;
  const keepTimer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  const flushKeep = useCallback(() => {
    if (keepTimer.current !== null) {
      window.clearTimeout(keepTimer.current);
      keepTimer.current = null;
    }
    if (pending.current === null) return;
    const edited = pending.current;
    pending.current = null;
    keepRef.current(edited, bodyRef.current());
  }, []);
  const onEdit = useCallback(
    (next: string) => {
      if (applying.current) return;
      shown.current = next;
      pending.current = next;
      if (keepTimer.current !== null) window.clearTimeout(keepTimer.current);
      keepTimer.current = window.setTimeout(flushKeep, KEEP_DEBOUNCE_MS);
    },
    [flushKeep],
  );
  useEffect(() => flushKeep, [flushKeep]);

  const stale = state.kind === 'done' && formatter.stale(currentBody());
  const restart = () => formatter.start(currentBody(), present, true);

  // Apply: what is on screen goes into the note, an edit still being typed
  // included - in place of the note, above it (a summary on top) or below it.
  // Matt: "there is no way to accept, append or prepend a summary or
  // enhancement". The word opens the three; Back closes them. Not while a
  // pass writes, not for a text the note has outgrown (Update first), and
  // not again for one already applied.
  const canApply = Boolean(onApply) && state.kind === 'done' && state.revising === null && !stale && state.model !== APPLIED && text !== '';
  const [choosing, setChoosing] = useState(false);
  const apply = (how: ApplyHow) => {
    setChoosing(false);
    flushKeep();
    onApply?.(view.current?.state.doc.toString() ?? text, how);
  };

  const pace = (perSecond: number) => `${perSecond.toFixed(perSecond < 10 ? 1 : 0)} tokens a second`;

  let line: React.ReactNode;
  if (!isTauri()) {
    line = <span>The robot runs on the phone. Install Ghost.md on Android to use it.</span>;
  } else if (state.kind === 'running') {
    const { phase } = state;
    const who = state.passes > 1 ? `a draft with ${modelName(state.model)}` : `with ${modelName(state.model)}`;
    if (phase === 'loading') line = <span>Loading {modelName(state.model)}.</span>;
    else if (phase === 'prefill') line = <span>Reading the note, {state.promptTokensDone} of {state.promptTokens}.</span>;
    else
      line = (
        <span>
          {words.doing} {who}, {pace(state.tokensPerSecond)}, {clock(state.elapsedMs)}.
        </span>
      );
  } else if (state.kind === 'done' && state.revising) {
    const { revising: r } = state;
    const doing = r.phase === 'generating' && r.tokensPerSecond > 0 ? `, ${pace(r.tokensPerSecond)}` : r.phase === 'prefill' ? ', reading the note' : '';
    line = (
      <span>
        Draft by {modelName(state.model)}. Revising with {modelName(r.model)}
        {doing}
        {r.elapsedMs ? `, ${clock(r.elapsedMs)}` : ''}.
      </span>
    );
  } else if (state.kind === 'done') {
    line = stale ? (
      <span>The note has changed since this was written.</span>
    ) : state.model === EDITED ? (
      <span>Edited by you.</span>
    ) : state.model === APPLIED ? (
      <span>Applied to the note.</span>
    ) : (
      <span>
        {state.model ? `${words.done} by ${modelName(state.model)}` : words.done}
        {state.ms !== null ? `, ${clock(state.ms)}` : ''}
        {state.truncated ? '. It ran out of room; try a shorter note.' : '.'}
      </span>
    );
  } else if (state.kind === 'stopped') {
    line = <span>Stopped.</span>;
  } else if (state.kind === 'failed') {
    line = <span>{state.message}</span>;
  } else if (models.models.length && !anyPresent) {
    // No model at all yet; the passes make do with any that is here, so only
    // an empty phone is asked to get one.
    line = models.download ? <span>Getting {modelName(models.download.id)}, {gb(models.download.received)} of {gb(models.download.total)}. Keep Ghost.md open.</span> : null;
  } else if (!models.models.length) {
    line = <span>Looking for the model.</span>;
  } else if (ready && !currentBody().trim()) {
    line = <span>Nothing in the note yet.</span>;
  }

  let action: React.ReactNode = null;
  if (isTauri()) {
    if (state.kind === 'running') action = <Word onPress={formatter.stop}>Stop</Word>;
    else if (state.kind === 'done' && state.revising) action = <Word onPress={formatter.stop}>Stop</Word>;
    else if (state.kind === 'done') action = <Word onPress={restart}>{stale ? 'Update' : 'Redo'}</Word>;
    else if (state.kind === 'stopped') action = <Word onPress={restart}>{words.label}</Word>;
    else if (state.kind === 'failed') action = <Word onPress={restart}>Try again</Word>;
  }

  // Only a phone with no model at all is asked to get one: with a smaller
  // model here and the chosen one absent, the passes draft with what is here.
  const wantsModel = ready && isTauri() && state.kind === 'none' && models.models.length > 0 && !anyPresent && models.download === null;
  const waiting = !ready || (isTauri() && state.kind === 'none' && models.models.length === 0);

  return (
    <div className={styles.pane}>
      {waiting ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading">
          <span style={{ inlineSize: '38%' }} />
          <span style={{ inlineSize: '92%' }} />
          <span style={{ inlineSize: '80%' }} />
          <span style={{ inlineSize: '64%' }} />
        </div>
      ) : null}
      {/* A pass writing and nothing on screen yet: the card, with the reader and the phone's readings. */}
      {!waiting && state.kind === 'running' && text === '' ? (
        <AiCard
          model={state.model}
          phase={state.phase}
          doing={words.doing}
          pass={{ at: state.pass, of: state.passes }}
          promptTokens={state.promptTokens}
          promptTokensDone={state.promptTokensDone}
          outputTokens={state.outputTokens}
          tokensPerSecond={state.tokensPerSecond}
          elapsedMs={state.elapsedMs}
          hardware={state.hardware}
        >
          {isTauri() ? <Word onPress={formatter.stop}>Stop</Word> : null}
        </AiCard>
      ) : null}
      {!waiting && !(state.kind === 'running' && text === '') ? (
        <p className={styles.line} role="status" data-busy={busy || undefined}>
          {line}
          {canApply && !choosing ? <Word onPress={() => setChoosing(true)}>Apply</Word> : null}
          {canApply && choosing ? (
            <>
              <Word onPress={() => apply('replace')}>Replace note</Word>
              <Word onPress={() => apply('prepend')}>Add above</Word>
              <Word onPress={() => apply('append')}>Add below</Word>
              <Word onPress={() => setChoosing(false)}>Back</Word>
            </>
          ) : null}
          {!choosing ? action : null}
          {!choosing ? <Word onPress={onClose}>Close</Word> : null}
        </p>
      ) : null}
      {models.problem ? <p className={styles.line}>{models.problem}</p> : null}
      {wantsModel ? (
        <div className={styles.empty}>
          <p>The robot needs a model on the phone. It runs here; nothing leaves the phone.</p>
          <Word onPress={() => void models.fetch(formatter.model)}>
            Get {chosen?.name} ({gb(chosen?.bytes ?? 0)})
          </Word>
        </div>
      ) : (
        <div className={styles.text} data-empty={(text === '' && (state.kind === 'none' || state.kind === 'running')) || undefined}>
          <Editor
            value={initial}
            onChange={onEdit}
            onView={(v) => {
              view.current = v;
              setEditor(v);
            }}
            dark={dark}
            assist={prefs.assist}
            readOnly={busy}
          />
        </div>
      )}
      {/* Press and hold: Cut, Copy, Paste, Select all; no picture, this is the model's text. */}
      <ContextMenu view={editor} />
    </div>
  );
}

function Word({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <button type="button" className={`app-word ${styles.word}`} onClick={onPress}>
      {children}
    </button>
  );
}

/** Milliseconds as m:ss. */
function clock(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}
