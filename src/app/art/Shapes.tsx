import type { ReactNode } from 'react';
import styles from './Shapes.module.css';

/**
 * The app's pictures: abstract shapes in the page's own ink.
 *
 * Nothing figurative - Matt's direction was "no ink inspiration, they're both
 * black and white markdown notes, maybe abstract shapes". So the motifs are a
 * note's: bars for lines of text, dots for bullets, a square for a checkbox, a
 * wave for a voice. Flat, no gradients, drawn on currentColor only, so a page
 * sets their weight with `color` (ink for a picture that leads, ink-3 for one
 * that sits under the words) and they invert with the theme. Square, sized by
 * the page, and decoration only: every one is aria-hidden.
 *
 * They move (Shapes.module.css): each one does the thing it stands for, slowly
 * and on a loop with long rests, so a page feels alive without asking to be
 * watched. Only transforms, opacity and dash offsets, so nothing lays out
 * again. With reduced motion they stand still in their finished pose, which
 * is the pose the markup draws. Blank, the empty list, is still: its picture
 * is coming from Matt.
 *
 * Holes (a reel's hub, the paper dot in the ink half) are cut with an even-odd
 * path rather than painted in the page colour, so they stay holes on any
 * background.
 *
 * The recorder's own two - sound beginning, a sentence stopping - live with it
 * in capture/Opening.tsx.
 */

interface ShapeProps {
  className?: string;
}

const svg = (className: string | undefined, children: ReactNode, motion?: string) => (
  <svg viewBox="0 0 120 120" className={[styles.shape, motion, className].filter(Boolean).join(' ')} aria-hidden="true">
    {children}
  </svg>
);

/** A circle as path data, to combine with others under an even-odd fill. */
const ring = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

/** A dot on a faint grid, as if a pen is about to start: the empty list. */
export function Blank({ className }: ShapeProps) {
  return svg(
    className,
    <>
      <circle cx="20" cy="20" r="1" fill="currentColor" />
      <circle cx="20" cy="30" r="1" fill="currentColor" />
      <circle cx="20" cy="40" r="1" fill="currentColor" />
      <circle cx="20" cy="50" r="1" fill="currentColor" />
      <circle cx="20" cy="60" r="1" fill="currentColor" />
      <circle cx="20" cy="70" r="1" fill="currentColor" />
      <circle cx="20" cy="80" r="1" fill="currentColor" />
      <circle cx="20" cy="90" r="1" fill="currentColor" />
      <circle cx="20" cy="100" r="1" fill="currentColor" />
      <circle cx="30" cy="20" r="1" fill="currentColor" />
      <circle cx="30" cy="30" r="1" fill="currentColor" />
      <circle cx="30" cy="40" r="1" fill="currentColor" />
      <circle cx="30" cy="50" r="1" fill="currentColor" />
      <circle cx="30" cy="60" r="1" fill="currentColor" />
      <circle cx="30" cy="70" r="1" fill="currentColor" />
      <circle cx="30" cy="80" r="1" fill="currentColor" />
      <circle cx="30" cy="90" r="1" fill="currentColor" />
      <circle cx="30" cy="100" r="1" fill="currentColor" />
      <circle cx="40" cy="20" r="1" fill="currentColor" />
      <circle cx="40" cy="30" r="1" fill="currentColor" />
      <circle cx="40" cy="40" r="1" fill="currentColor" />
      <circle cx="40" cy="50" r="1" fill="currentColor" />
      <circle cx="40" cy="60" r="1" fill="currentColor" />
      <circle cx="40" cy="70" r="1" fill="currentColor" />
      <circle cx="40" cy="80" r="1" fill="currentColor" />
      <circle cx="40" cy="90" r="1" fill="currentColor" />
      <circle cx="40" cy="100" r="1" fill="currentColor" />
      <circle cx="50" cy="20" r="1" fill="currentColor" />
      <circle cx="50" cy="30" r="1" fill="currentColor" />
      <circle cx="50" cy="40" r="1" fill="currentColor" />
      <circle cx="50" cy="50" r="1" fill="currentColor" />
      <circle cx="50" cy="60" r="1" fill="currentColor" />
      <circle cx="50" cy="70" r="1" fill="currentColor" />
      <circle cx="50" cy="80" r="1" fill="currentColor" />
      <circle cx="50" cy="90" r="1" fill="currentColor" />
      <circle cx="50" cy="100" r="1" fill="currentColor" />
      <circle cx="60" cy="20" r="1" fill="currentColor" />
      <circle cx="60" cy="30" r="1" fill="currentColor" />
      <circle cx="60" cy="40" r="1" fill="currentColor" />
      <circle cx="60" cy="50" r="1" fill="currentColor" />
      <circle cx="60" cy="60" r="1" fill="currentColor" />
      <circle cx="60" cy="70" r="1" fill="currentColor" />
      <circle cx="60" cy="80" r="1" fill="currentColor" />
      <circle cx="60" cy="90" r="1" fill="currentColor" />
      <circle cx="60" cy="100" r="1" fill="currentColor" />
      <circle cx="70" cy="20" r="1" fill="currentColor" />
      <circle cx="70" cy="30" r="1" fill="currentColor" />
      <circle cx="70" cy="40" r="1" fill="currentColor" />
      <circle cx="70" cy="50" r="1" fill="currentColor" />
      <circle cx="70" cy="60" r="1" fill="currentColor" />
      <circle cx="70" cy="70" r="1" fill="currentColor" />
      <circle cx="70" cy="80" r="1" fill="currentColor" />
      <circle cx="70" cy="90" r="1" fill="currentColor" />
      <circle cx="70" cy="100" r="1" fill="currentColor" />
      <circle cx="80" cy="20" r="1" fill="currentColor" />
      <circle cx="80" cy="30" r="1" fill="currentColor" />
      <circle cx="80" cy="40" r="1" fill="currentColor" />
      <circle cx="80" cy="50" r="1" fill="currentColor" />
      <circle cx="80" cy="60" r="1" fill="currentColor" />
      <circle cx="80" cy="70" r="1" fill="currentColor" />
      <circle cx="80" cy="80" r="1" fill="currentColor" />
      <circle cx="80" cy="90" r="1" fill="currentColor" />
      <circle cx="80" cy="100" r="1" fill="currentColor" />
      <circle cx="90" cy="20" r="1" fill="currentColor" />
      <circle cx="90" cy="30" r="1" fill="currentColor" />
      <circle cx="90" cy="40" r="1" fill="currentColor" />
      <circle cx="90" cy="50" r="1" fill="currentColor" />
      <circle cx="90" cy="60" r="1" fill="currentColor" />
      <circle cx="90" cy="70" r="1" fill="currentColor" />
      <circle cx="90" cy="80" r="1" fill="currentColor" />
      <circle cx="90" cy="90" r="1" fill="currentColor" />
      <circle cx="90" cy="100" r="1" fill="currentColor" />
      <circle cx="100" cy="20" r="1" fill="currentColor" />
      <circle cx="100" cy="30" r="1" fill="currentColor" />
      <circle cx="100" cy="40" r="1" fill="currentColor" />
      <circle cx="100" cy="50" r="1" fill="currentColor" />
      <circle cx="100" cy="60" r="1" fill="currentColor" />
      <circle cx="100" cy="70" r="1" fill="currentColor" />
      <circle cx="100" cy="80" r="1" fill="currentColor" />
      <circle cx="100" cy="90" r="1" fill="currentColor" />
      <circle cx="100" cy="100" r="1" fill="currentColor" />
      <circle cx="30" cy="90" r="7" fill="currentColor" />
    </>,
  );
}

/** The app's mark at poster size: a bullet lands and its line writes out. */
export function Welcome({ className }: ShapeProps) {
  return svg(
    className,
    <>
      <circle className={styles.bullet} cx="37" cy="60" r="22" fill="currentColor" />
      <rect className={styles.bulletLine} x="64" y="52" width="48" height="16" rx="8" fill="currentColor" />
    </>,
    styles.welcome,
  );
}

/** A square split into ink and paper, a dot of the other in each half, turning over: the theme page. */
export function Theme({ className }: ShapeProps) {
  return svg(
    className,
    <g className={styles.turn}>
      <path fillRule="evenodd" d={`M91.66 28.34A8 8 0 0 1 94 34V86a8 8 0 0 1-8 8H34a8 8 0 0 1-5.66-2.34z${ring(74, 74, 6)}`} fill="currentColor" />
      <rect x="26" y="26" width="68" height="68" rx="8" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="46" cy="46" r="6" fill="currentColor" />
    </g>,
    styles.theme,
  );
}

/** The edge of a phone: its key goes in and sound leaves. The side-key page. */
export function SideKey({ className }: ShapeProps) {
  return svg(
    className,
    <>
      {/*
        Zoomed in on the phone's edge rather than a whole phone: a wide slab
        with corners barely rounded, so it reads as a piece of a phone and not
        a tall thin one, and the key large on its right side. (Matt: "zoom in
        on the button just a bit more and make the left side edges barely
        rounded".)
      */}
      <rect x="6" y="10" width="62" height="100" rx="5" fill="currentColor" />
      <rect className={styles.key} x="67" y="42" width="8" height="30" rx="4" fill="currentColor" />
      {[14, 22, 30].map((r, i) => (
        <path
          key={r}
          className={styles.wave}
          style={{ animationDelay: `${i * 140}ms` }}
          d={`M${74 + r} ${57 - r * 0.78}a${r} ${r} 0 0 1 0 ${r * 1.56}`}
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </>,
    styles.sidekey,
  );
}

/** Lines of a note writing themselves in, and a box getting its tick: the markdown page. */
export function Markdown({ className }: ShapeProps) {
  const lines = [
    { x: 16, y: 22, w: 88 },
    { x: 16, y: 42, w: 64 },
    { x: 36, y: 62, w: 52 },
    { x: 16, y: 82, w: 40 },
  ];
  return svg(
    className,
    <>
      {lines.map((line, i) => (
        <rect key={line.y} className={styles.line} style={{ animationDelay: `${i * 220}ms` }} x={line.x} y={line.y} width={line.w} height="10" rx="5" fill="currentColor" />
      ))}
      <rect x="16" y="61" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
      <path className={styles.tick} d="M19 67l3 3l5-6" pathLength={1} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>,
    styles.markdown,
  );
}

/** A lid lifting off a box and settling back: the tips page. */
export function Tips({ className }: ShapeProps) {
  return svg(
    className,
    <>
      <rect x="34" y="58" width="52" height="38" rx="5" fill="currentColor" />
      <rect className={styles.lid} x="30" y="44" width="60" height="10" rx="5" fill="currentColor" />
    </>,
    styles.tips,
  );
}

/** A circle with an arc breaking out of its top right: an update is ready. */
export function Update({ className }: ShapeProps) {
  return svg(
    className,
    <>
      <circle
        cx="56"
        cy="64"
        r="30"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeDasharray="160 40"
        transform="rotate(-70 56 64)"
      />
      <path
        d="M78 40 l16 -16 m0 0 l-14 0 m14 0 l0 14"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </>,
  );
}
