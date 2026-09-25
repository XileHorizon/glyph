import { useEffect, useState, useSyncExternalStore } from 'react';
import { Copy, Link2, Share2, X } from '@glacier/icons';
import { useAccount } from '../core/account/account.ts';
import { listNotes } from '../core/store.ts';
import { linkFor, onShares, shareNote, stopSharing } from './share.ts';
import styles from '../editor/NoteSettings.module.css';

/**
 * A note's sharing, in its cog (editor/NoteSettings.tsx): share it by a read-only link, copy or send the link, stop
 * sharing (share/share.ts). Signed out, the one line says where to sign in, since a share is kept with an account.
 */
export function ShareRows({ noteId }: { noteId: string }) {
  const { session } = useAccount();
  const link = useSyncExternalStore(onShares, () => linkFor(noteId), () => null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => setSaid(null), [noteId]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setSaid(null);
    try {
      await work();
    } catch (failure) {
      setSaid(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid('The link is copied.');
    } catch {
      setSaid(text);
    }
  };

  const share = () =>
    run(async () => {
      const notes = await listNotes();
      const note = notes.find((n) => n.id === noteId);
      if (!note) throw new Error('Save the note first: there is nothing to share yet.');
      await copy(await shareNote(note, notes));
    });

  const canSend = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <>
      <p className={styles.heading}>Sharing</p>
      <div className={styles.group}>
        {!session ? (
          <div className={styles.row} aria-disabled>
            <span className={styles.icon} aria-hidden="true">
              <Link2 size={18} strokeWidth={2.2} />
            </span>
            <span className={styles.label}>
              Share a read-only link
              <span className={styles.hint}>Sign in under Settings › Account first: a share is kept with your account.</span>
            </span>
          </div>
        ) : !link ? (
          <button type="button" className={styles.row} disabled={busy} onClick={() => void share()}>
            <span className={styles.icon} aria-hidden="true">
              <Link2 size={18} strokeWidth={2.2} />
            </span>
            <span className={styles.label}>
              {busy ? 'Sharing…' : 'Share a read-only link'}
              <span className={styles.hint}>Anyone with the link can read it, and your edits follow. The server can’t read it.</span>
            </span>
          </button>
        ) : (
          <>
            <button type="button" className={styles.row} onClick={() => void copy(link)}>
              <span className={styles.icon} aria-hidden="true">
                <Copy size={18} strokeWidth={2.2} />
              </span>
              <span className={styles.label}>
                Copy the link
                <span className={styles.hint}>Shared, read-only. Your edits reach readers a few seconds after you save.</span>
              </span>
            </button>
            {canSend ? (
              <button type="button" className={styles.row} onClick={() => void navigator.share({ url: link }).catch(() => undefined)}>
                <span className={styles.icon} aria-hidden="true">
                  <Share2 size={18} strokeWidth={2.2} />
                </span>
                <span className={styles.label}>Send the link</span>
              </button>
            ) : null}
            <button type="button" className={styles.row} disabled={busy} onClick={() => void run(() => stopSharing(noteId))}>
              <span className={styles.icon} aria-hidden="true">
                <X size={18} strokeWidth={2.2} />
              </span>
              <span className={styles.label}>
                {busy ? 'Stopping…' : 'Stop sharing'}
                <span className={styles.hint}>The link reads nothing from then on.</span>
              </span>
            </button>
          </>
        )}
        {said ? (
          <p className={styles.hint} role="status" style={{ padding: 'var(--glacier-space-2) var(--glacier-space-4)', margin: 0 }}>
            {said}
          </p>
        ) : null}
      </div>
    </>
  );
}
