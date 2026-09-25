import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from '@glacier/icons';
import { useBack } from '../../core/back.ts';
import { guides, type Way } from './steps.ts';
import styles from './claude.module.css';

/**
 * The instructions drawer (Matt: "add the instructions for the MCP to an instructions drawer we can open from the
 * mcp page in the app"): a card over the Claude plugin's page with the steps to connect, one way at a time - hosted, or a
 * file on your own computer - each command in a block with a Copy beside it, so a phone can hand them to a
 * computer without retyping. On a phone it rises from the bottom; on a wide window it floats in the middle.
 *
 * It closes on the X, a tap on the scrim, Escape, or the phone's back gesture, and every open lands on the way it
 * was opened for. Drawn into the body rather than the pane, because the settings panes move as they change and a
 * fixed card inside a moving thing moves with it.
 *
 * The two-way switch is the page's own rather than the kit's SegmentedControl: the plugin registry, which every
 * test loads, reaches this file, and the kit reads matchMedia as it loads (the GitHub pane keeps the same rule).
 */

interface ClaudeGuideProps {
  /** Which way's steps to open on, or null for closed. */
  way: Way | null;
  /** The handle this device is signed in with, for the sign-in command; null when it is not. */
  handle: string | null;
  onClose: () => void;
}

/** One thing to copy: the words, and a Copy that says Copied for a moment. */
function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className={styles.snippet}>
      <code className={styles.code}>{text}</code>
      <button
        type="button"
        className={styles.copy}
        aria-label={copied ? 'Copied' : 'Copy'}
        data-copied={copied || undefined}
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export function ClaudeGuide({ way, handle, onClose }: ClaudeGuideProps) {
  const open = way !== null;
  const [shown, setShown] = useState<Way>(way ?? 'hosted');
  const card = useRef<HTMLDivElement>(null);
  // Every open lands on the way it was asked for, however the last one was left.
  useEffect(() => {
    if (way) setShown(way);
  }, [way]);
  useBack(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    card.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, onClose]);

  if (!open) return null;
  const all = guides(handle);
  const guide = all.find((g) => g.way === shown) ?? all[0]!;
  return createPortal(
    <div className={styles.over}>
      <div className={styles.scrim} onPointerDown={onClose} />
      <div ref={card} className={styles.card} role="dialog" aria-modal="true" aria-label="Connecting Claude" tabIndex={-1}>
        <header className={styles.head}>
          <h2 className={styles.title}>Connecting Claude</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className={styles.ways} role="radiogroup" aria-label="Which way">
          {all.map((g) => (
            <button key={g.way} type="button" role="radio" aria-checked={g.way === shown} className={styles.way} onClick={() => setShown(g.way)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className={styles.scroll}>
          <p className={styles.lead}>{guide.lead}</p>
          <ol className={styles.steps}>
            {guide.steps.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.number} aria-hidden="true">
                  {i + 1}
                </span>
                <div className={styles.stepBody}>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.words}>{step.body}</p>
                  {step.snippets?.map((text) => <Snippet key={text} text={text} />)}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>,
    document.body,
  );
}
