import { Ghost } from '../art/Ghost.tsx';
import { useEffect, useRef, useState } from 'react';
import { useBack } from '../core/back.ts';
import { fireNativeHaptic } from '../core/haptics.ts';
import type { Finding } from './findings.ts';
import { useWispEdge } from '../art/wispEdge.ts';
import styles from './ReviewScreen.module.css';
import { useReview, type ReviewHandoff, type StepState } from './useReview.ts';

/**
 * After Stop: the note looked at again, out loud.
 *
 * Three steps down the top, each with what it is doing (listening again,
 * comparing, thinking), then the model's own thinking as it streams, raw, in a
 * quiet scrolling pane that follows the newest line. When it has answered, the
 * findings: each a small card saying which check found it, what and why, and
 * the change as before and after, with two answers side by side, Use this
 * (the default) and Skip, and the new words editable. "Commit" writes the
 * used ones; "Keep as is" leaves the note exactly as the recording saved it.
 * Back is "Keep as is". Nothing is lost either way: the note was saved before
 * this began.
 */

const CHECK_WORDS: Record<Finding['check'], string> = {
  words: 'Words',
  structure: 'Structure',
  commands: 'Commands',
  names: 'Names',
};

function StepMark({ state }: { state: StepState }) {
  return <span className={styles.mark} data-state={state} aria-hidden="true" />;
}

function FindingCard({ finding, accepted, onDecide, onEdit }: { finding: Finding; accepted: boolean; onDecide: (use: boolean) => void; onEdit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const after = finding.change.kind === 'add' ? finding.change.line : finding.change.replace;
  return (
    <li className={styles.finding} data-accepted={accepted ? '' : undefined}>
      <div className={styles.findingHead}>
        <span className={styles.check}>{CHECK_WORDS[finding.check]}</span>
        {finding.noteTitle ? <span className={styles.where}>{finding.noteTitle}</span> : null}
      </div>
      <p className={styles.what}>{finding.what}</p>
      {finding.why ? <p className={styles.why}>{finding.why}</p> : null}
      <div className={styles.change}>
        {finding.change.kind === 'replace' ? <p className={styles.before}>{finding.change.find || '(nothing)'}</p> : <p className={styles.addLabel}>Add a line</p>}
        {editing ? (
          <textarea className={styles.editor} value={after} autoFocus rows={Math.min(6, Math.max(1, after.split('\n').length))} onChange={(e) => onEdit(e.target.value)} onBlur={() => setEditing(false)} />
        ) : (
          <p className={styles.after}>{after || '(remove it)'}</p>
        )}
      </div>
      <div className={styles.findingActions}>
        <button type="button" className={`app-word ${styles.edit}`} onClick={() => setEditing((on) => !on)}>
          {editing ? 'Done editing' : 'Edit'}
        </button>
        <div className={styles.answers} role="group" aria-label={`Use or skip: ${finding.what}`}>
          <button type="button" className={styles.answer} aria-pressed={!accepted} onClick={() => onDecide(false)}>
            Skip
          </button>
          <button type="button" className={styles.answer} aria-pressed={accepted} onClick={() => onDecide(true)}>
            Use this
          </button>
        </div>
      </div>
    </li>
  );
}

export function ReviewScreen({ handoff, onDone }: { handoff: ReviewHandoff; onDone: (noteId: string) => void }) {
  const { state, decide, edit, finish, stopThinking } = useReview(handoff);
  const [showThought, setShowThought] = useState(true);
  const pane = useRef<HTMLDivElement>(null);
  // The review goes to smoke under its title (art/wispEdge.ts).
  const body = useRef<HTMLDivElement>(null);
  useWispEdge(body);

  const leave = async (commit: boolean) => {
    await finish(commit);
    if (commit) fireNativeHaptic('success');
    onDone(handoff.noteId);
  };
  useBack(true, () => void leave(false));

  // The thinking pane follows the newest line while the model is writing.
  useEffect(() => {
    const el = pane.current;
    if (el && state.think.state === 'running') el.scrollTop = el.scrollHeight;
  }, [state.think.thought, state.think.state]);

  // The thought folds away once there is something to decide.
  const decided = state.findings !== null;
  useEffect(() => {
    if (decided && state.findings?.length) setShowThought(false);
  }, [decided, state.findings?.length]);

  const accepted = (state.findings ?? []).filter((f) => state.accepted.has(f.id)).length;
  const thinking = state.think.state === 'running';

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <span className={styles.title}>Reviewing “{state.title || 'your note'}”</span>
        <button type="button" className="app-word" onClick={() => void leave(false)} disabled={state.committing}>
          {decided ? 'Keep as is' : 'Skip review'}
        </button>
      </header>

      <div ref={body} className={styles.body}>
        {thinking ? <Ghost scene="working" className={styles.workingGhost} /> : null}
        <ol className={styles.steps}>
          <li className={styles.step}>
            <StepMark state={state.listen.state} />
            <span className={styles.stepText}>
              <span className={styles.stepName}>Listening again{state.listen.state === 'running' && state.listen.percent ? ` · ${state.listen.percent}%` : ''}</span>
              {state.listen.detail ? <span className={styles.stepDetail}>{state.listen.detail}</span> : null}
            </span>
          </li>
          <li className={styles.step}>
            <StepMark state={state.compare.state} />
            <span className={styles.stepText}>
              <span className={styles.stepName}>Comparing words</span>
              {state.compare.detail ? <span className={styles.stepDetail}>{state.compare.detail}</span> : null}
            </span>
          </li>
          <li className={styles.step}>
            <StepMark state={state.think.state} />
            <span className={styles.stepText}>
              <span className={styles.stepName}>
                Thinking it through{thinking && state.think.tokensPerSecond ? ` · ${Math.round(state.think.tokensPerSecond)} words a second` : ''}
              </span>
              {state.think.detail ? <span className={styles.stepDetail}>{state.think.detail}</span> : null}
            </span>
            {thinking ? (
              <button type="button" className={`app-word ${styles.stepAction}`} onClick={stopThinking}>
                Stop
              </button>
            ) : null}
          </li>
        </ol>

        {state.think.thought || thinking ? (
          <section className={styles.thought} aria-label="The model's thinking">
            <button type="button" className={styles.thoughtHead} onClick={() => setShowThought((on) => !on)} aria-expanded={showThought}>
              {thinking && !state.think.answering ? 'Thinking' : 'The thinking'}
              <span className={styles.chevron} data-open={showThought ? '' : undefined} aria-hidden="true" />
            </button>
            {showThought ? (
              <div ref={pane} className={styles.thoughtText} data-live={thinking ? '' : undefined}>
                {state.think.thought || (state.think.canShowThought ? '…' : 'This version of Ghost.md can’t show the model’s thinking. Install the newest from Settings > Updates.')}
              </div>
            ) : null}
          </section>
        ) : null}

        {state.findings ? (
          state.findings.length ? (
            <ul className={styles.findings}>
              {state.findings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} accepted={state.accepted.has(finding.id)} onDecide={(use) => decide(finding.id, use)} onEdit={(text) => edit(finding.id, text)} />
              ))}
            </ul>
          ) : (
            <p className={styles.clean}>Nothing to change. The first pass got it right.</p>
          )
        ) : null}
      </div>

      <footer className={styles.footer}>
        {decided ? (
          state.findings?.length ? (
            <>
              <span className={styles.count}>
                {accepted} of {state.findings.length} to use
              </span>
              {/* Everything skipped is a finished review, not a dead button: Done keeps the note as it is. */}
              <button type="button" className="app-pill" onClick={() => void leave(accepted > 0)} disabled={state.committing}>
                {state.committing ? 'Committing…' : accepted > 0 ? `Commit ${accepted}` : 'Done'}
              </button>
            </>
          ) : (
            <button type="button" className={`app-pill ${styles.solo}`} onClick={() => void leave(false)} disabled={state.committing}>
              Done
            </button>
          )
        ) : (
          <span className={styles.count}>The note is saved. This only checks it.</span>
        )}
      </footer>
    </div>
  );
}
