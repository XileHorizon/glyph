import { Ghost } from '../art/Ghost.tsx';
import { GraduationCap, X } from '@glacier/icons';
import { WorkingGears } from '../art/WorkingGears.tsx';
import { useRefining } from '../capture/refine.ts';
import type { VoiceModelState } from '../capture/useVoiceModel.ts';
import type { Updates } from '../core/ota.ts';
import styles from './Notices.module.css';

/*
 * What is waiting on the person, shown where they land (home/HomeScreen.tsx) and in the sidebar (notes/NoteTree.tsx):
 * an update, the Academy's invitation, and the voice model while it is not ready yet.
 */

/**
 * A blue card when there is something newer to run: the one piece of colour on
 * the home page, because on a black page a grey line under the title was easy to
 * miss (Matt: "it blends in too much with the dark background"). Only there and
 * in the sidebar: a reload costs nothing on either, where in the editor or
 * mid-capture it would be an interruption - and a cold start applies the update
 * anyway.
 */
export function UpdateNotice({ updates }: { updates: Updates }) {
  const { ready, apk } = updates;
  const mb = (bytes: number) => Math.round(bytes / 1e6);
  if (apk.kind === 'available' || apk.kind === 'failed' || apk.kind === 'needs-permission') {
    return (
      <UpdateCard
        text={
          apk.kind === 'failed'
            ? `Ghost.md ${apk.info.version} didn’t install. ${apk.message}`
            : apk.kind === 'needs-permission'
              ? 'Let Ghost.md install apps, then come back.'
              : `Ghost.md ${apk.info.version} is out.`
        }
        action={apk.kind === 'failed' ? 'Try again' : 'Install'}
        onAction={updates.installApk}
        ghost={apk.kind === 'available'}
      />
    );
  }
  if (apk.kind === 'downloading') {
    return (
      <UpdateCard
        text={`Downloading Ghost.md ${apk.info.version}, ${mb(apk.received)} of ${mb(apk.total)} MB.`}
        progress={apk.total ? apk.received / apk.total : 0}
        working
      />
    );
  }
  if (apk.kind === 'installing') {
    // Android's own dialog is on top now; this is what is left if it is dismissed.
    return <UpdateCard text={`Ghost.md ${apk.info.version} is waiting on Android.`} action="Open" onAction={updates.installApk} />;
  }
  if (ready) {
    return <UpdateCard text="A new version of Ghost.md is ready." action="Reload" onAction={updates.reload} ghost />;
  }
  return null;
}

export function UpdateCard({
  text,
  action,
  onAction,
  progress,
  working,
  ghost,
}: {
  text: string;
  action?: string;
  onAction?: () => void;
  progress?: number;
  /** The update is coming down now: cogs turn beside the words while it does (Matt: "show some cogs working together"). */
  working?: boolean;
  /** An update is waiting to be taken: the ghost with its parcel beside the words (art/Ghost.tsx). */
  ghost?: boolean;
}) {
  return (
    <div className={styles.update} role="status">
      {ghost && !working ? <Ghost scene="update" size="tiny" /> : null}
      <p className={styles.updateText}>
        {working ? <WorkingGears label="Downloading" /> : null}
        {text}
      </p>
      {action && onAction ? (
        <button type="button" className={styles.updateAction} onClick={onAction}>
          {action}
        </button>
      ) : null}
      {progress !== undefined ? (
        <span className={styles.updateBar} aria-hidden="true">
          <span style={{ inlineSize: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The Academy, offered on the home screen (Matt: "I'd like the academy page to
 * show up on the home screen kinda like the update banner for new users as a
 * call to action banner").
 *
 * Like the update card in shape and place, unlike it in voice: the update is
 * news and wears foil, this is an invitation and is the paper it sits on. It
 * is for someone who has not typed a mark in the Academy yet; passing one
 * lesson, or the cross, takes it away for good (academy/banner.ts). The
 * Academy itself stays in Settings either way, so nothing is lost by
 * dismissing it.
 */
export function AcademyCard({ onOpen, onHide }: { onOpen: () => void; onHide?: () => void }) {
  return (
    <div className={styles.learn}>
      <div className={styles.learnWords}>
        <p className={styles.learnLead}>
          <GraduationCap size={17} strokeWidth={1.9} className={styles.learnMark} aria-hidden="true" />
          Ghost.md Academy
        </p>
        <p className={styles.learnLine}>Learn the marks, one at a time.</p>
      </div>
      <div className={styles.learnDo}>
        <button type="button" className={styles.learnAction} onClick={onOpen}>
          Start
        </button>
        {onHide ? (
          <button type="button" className={styles.learnHide} onClick={onHide} aria-label="Not now">
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One line on the home page while voice notes cannot work yet, and nothing at
 * all once they can. Visible because the alternative - a side key that opens a
 * capture screen which then sits downloading - is the first impression of the
 * feature the app exists for.
 */
export function VoiceModelStatus({ state, onRetry }: { state: VoiceModelState; onRetry: () => void }) {
  if (state.kind === 'ready' || state.kind === 'unsupported' || state.kind === 'checking') return null;
  if (state.kind === 'downloading') {
    const mb = (bytes: number) => Math.round(bytes / 1e6);
    return (
      <p className={styles.notice} role="status">
        Downloading the voice model, {mb(state.received)} of {mb(state.total)} MB. Keep Ghost.md open.
      </p>
    );
  }
  return (
    <p className={styles.notice} role="alert">
      The voice model didn’t download.{' '}
      <button type="button" className={`app-word ${styles.noticeAction}`} onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}


/** The better voice model coming down in the background (capture/refine.ts), while it does. */
export function RefiningNotice() {
  const refining = useRefining();
  if (!refining.download) return null;
  return (
    <p className={styles.notice} role="status">
      Getting the better voice model, {Math.round(refining.download.received / 1e6)} of {Math.round(refining.download.total / 1e6)} MB.
    </p>
  );
}
