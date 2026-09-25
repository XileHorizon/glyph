import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { Editor } from '../editor/Editor.tsx';
import { commonEnds, wisp } from '../editor/wispArrivals.ts';
import { isDarkNow, usePreferences } from '../core/preferences.ts';
import { holdWispDrift, useWispEdge } from '../art/wispEdge.ts';
import { appendBody } from './appendBody.ts';
import { onVoiceLevel } from './voiceLevel.ts';
import styles from './CaptureScreen.module.css';

/**
 * The note being spoken, as its page: the same editor the note opens in, the
 * note's older text above, and what is being said written onto its end.
 *
 * Matt: "as the text is understood from the transcriptions it should render
 * into the active note showing the old notes above instead of always going to
 * this new UI. The memo mode will always just be voice writing with formatting
 * keywords on a normal page. As we understand and rewrite the text I speak I
 * want the text to appear and disappear with the wisp effect."
 *
 * Set as it will read, not as it is written: the page is in the formatted view (editor/viewMode.ts), so a heading is
 * a heading and a bullet a bullet as it is said, without the marks around them (Matt: "show actual stuff being
 * written out and formatted as i talk"). The marks are all there in the note it saves.
 *
 * The page is read-only while it is being written. Each change of what was
 * heard is written into the editor as the smallest edit that gets there (the
 * shared start and end kept), marked `wisp` (editor/wispArrivals.ts): new
 * letters come in out of smoke, and a guess being corrected loses its old
 * letters into it (Matt: "the memo page should real time fade words in with
 * the wisp effect"; it was off a while, when the arriving letters were boxes
 * that shifted the line, and came back once they weren't). The page follows the newest words down unless the person
 * has scrolled up to read.
 */

interface LivePageProps {
  /** The continued note's text before this capture, or '' for a new note. */
  base: string;
  /** This capture's markdown so far, the phrase still being guessed included. */
  markdown: string;
  /** Shown on an empty page. */
  placeholder: string;
  /** The recorder's top line, which the page runs under: the wisp sits below it, and the page pads by its height. */
  under?: RefObject<HTMLElement | null>;
}

/** Within this far of the bottom, the page keeps following the newest words. */
const FOLLOW_PX = 160;

export function LivePage({ base, markdown, placeholder, under }: LivePageProps) {
  const { theme, wisp: ghosting, ripples: rippling } = usePreferences();
  const page = useRef<HTMLDivElement>(null);
  // The older text goes to smoke under the recorder's top line, like any page (art/wispEdge.ts): the line is a pane
  // the page runs under, so nothing shows fading against the black above the words (Matt: "the header on the new
  // note section isn't dark enough and shows the slight white glow").
  useWispEdge(page, undefined, under);
  // While the phone listens, the smoke holds still: each drift step redraws the filtered page on the main thread, next
  // to the microphone and the voice model.
  useEffect(() => holdWispDrift(), []);
  const [view, setView] = useState<EditorView | null>(null);
  // The voice moves the newest lines: ripples through the words as the microphone hears (editor/wispRipples.ts; Matt:
  // "show the voice recording ripples giving the text weird wisp ripples").
  const ripples = useMemo(() => ({ subscribe: onVoiceLevel }), []);
  // The document the editor starts with; everything after is written in as edits.
  const [first] = useState(() => appendBody(base, markdown));

  useEffect(() => {
    if (!view) return;
    const next = appendBody(base, markdown);
    const now = view.state.doc.toString();
    if (now === next) return;
    const { prefix, suffix } = commonEnds(now, next);
    const scroller = page.current;
    const following = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_PX : false;
    const removed = now.length - prefix - suffix;
    view.dispatch({
      changes: { from: prefix, to: now.length - suffix, insert: next.slice(prefix, next.length - suffix) },
      annotations: wisp.of({ kind: removed > 0 ? 'rewrite' : 'heard' }),
    });
    if (following && scroller) {
      window.requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));
    }
  }, [view, base, markdown]);

  // Opened on a long note: start at its end, where the words will go.
  useEffect(() => {
    if (!view || !page.current) return;
    page.current.scrollTop = page.current.scrollHeight;
  }, [view]);

  return (
    <div ref={page} className={styles.livePage}>
      <Editor
        value={first}
        onChange={noop}
        dark={isDarkNow(theme)}
        assist={false}
        placeholder={placeholder}
        onView={setView}
        readOnly
        grow
        arrivals={ghosting}
        ripples={rippling ? ripples : undefined}
        display="formatted"
      />
    </div>
  );
}

function noop(): void {
  // Read-only: the recorder writes the page, nothing typed comes back.
}
