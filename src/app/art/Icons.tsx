/**
 * The app's few icons, drawn rather than typed.
 *
 * A "←" in text comes from whichever font the phone falls back to for arrows,
 * at whatever weight and baseline that font likes, and on the Fold it did not
 * match the words beside it. These are strokes on currentColor, sized 1em, so
 * they take the text's colour and size and sit on its baseline.
 */

interface IconProps {
  className?: string;
}

const icon = (className: string | undefined, d: string) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" style={{ inlineSize: '1em', blockSize: '1em', verticalAlign: '-0.12em' }}>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A modern house, for the button that goes home (Matt: "change the home logo to be a modern house"; it was Glyph's
 * own dot and dash). A single-pitch roof rising to the right with its overhang drawn past the walls, and a door.
 *
 * It wears the icons' 33% wash (app.css), on the house's body alone: the door and the roof's line are strokes over it,
 * and a wash on them as well would lay a second coat over the door, the doubling the icons are kept clear of. So the
 * wash is set on the body as a style - a `fill` attribute would lose to the stylesheet's rules, a style does not.
 */
export function House({ size = 20, strokeWidth = 2.1, className }: IconProps & { size?: number; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 10.6 19.5 6v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" style={{ fill: 'color-mix(in srgb, currentColor 33%, transparent)' }} />
      <path d="M2.5 11.2 21.5 5.4" />
      <path d="M10 21v-5.5h4V21" />
    </svg>
  );
}

export function ArrowLeft({ className }: IconProps) {
  return icon(className, 'M20 12H5m6-7-7 7 7 7');
}

export function ArrowRight({ className }: IconProps) {
  return icon(className, 'M4 12h15m-6-7 7 7-7 7');
}

/**
 * A cog: eight square-shouldered teeth round a ring, with the hole in the
 * middle. Worked out once from its radii rather than typed in, so the teeth
 * are even.
 */
const COG = (() => {
  const teeth = 8;
  const step = (Math.PI * 2) / teeth;
  const outer = 10;
  const inner = 7.6;
  const points: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    for (const [offset, r] of [
      [-0.27, inner],
      [-0.15, outer],
      [0.15, outer],
      [0.27, inner],
    ] as const) {
      const angle = a + offset * step;
      points.push(`${(12 + r * Math.cos(angle)).toFixed(2)} ${(12 + r * Math.sin(angle)).toFixed(2)}`);
    }
  }
  return `M${points.join('L')}ZM15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z`;
})();

export function Cog({ className }: IconProps) {
  return icon(className, COG);
}

export function Plus({ className }: IconProps) {
  return icon(className, 'M12 5v14M5 12h14');
}

/** A robot's head: an antenna, a rounded box, two eyes and a level mouth. The AI's button. */
export function Robot({ className }: IconProps) {
  return icon(
    className,
    'M12 3v4M5.5 7h13a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9A1.5 1.5 0 0 1 5.5 7M9 12.5h.01M15 12.5h.01M9.5 16h5',
  );
}

/** A pushpin: a cap, a flared body, and the needle below it. */
export function Pin({ className }: IconProps) {
  return icon(className, 'M8.5 3h7M10 3l-.9 5.6L6 12.4h12l-3.1-3.8L14 3M12 12.4V21');
}

/** An archive box: a lid, the box, and the handle slot. */
export function ArchiveBox({ className }: IconProps) {
  return icon(className, 'M3.5 4.5h17v4h-17zM5.5 8.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8.5M10 12.5h4');
}

/** A bin: lid, handle, can and two ribs. */
export function Bin({ className }: IconProps) {
  return icon(className, 'M4 6.5h16M9.5 6.5V4h5v2.5M6.2 6.5 7.1 20h9.8l.9-13.5M10 10.5v6M14 10.5v6');
}

/** A folder: a tab at the top left, then the pocket. Where a note is filed. */
export function Workspace({ className }: IconProps) {
  return icon(className, 'M3.5 6.5a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z');
}

/** A board: three columns, the first two with a card in them. Turning a list into one. */
export function Board({ className }: IconProps) {
  return icon(className, 'M4 5.5h4.5v13H4zM9.75 5.5h4.5v8.5h-4.5zM15.5 5.5H20v11h-4.5');
}
