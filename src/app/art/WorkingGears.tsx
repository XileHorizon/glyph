import { outsidePhase, pitchRadius, spurPath } from './gears.ts';
import styles from './WorkingGears.module.css';

/**
 * Three cogs meshing and turning, small enough to sit in a line of type: the update card while the new version is
 * coming down (Matt: "have it do the download for the update then and show some cogs working together").
 *
 * The teeth really interleave. Every gear here shares one module (the size of a tooth, art/gears.ts), so a gear of
 * `n` teeth has a pitch circle of `n·m/2` and two that mesh sit exactly the sum of their pitch radii apart;
 * `outsidePhase` gives the second gear the start angle that puts a tooth of one into a gap of the other. Speeds
 * follow from the pitch circles rolling on each other: the small gear turns the other way, faster by the ratio of
 * their teeth, which is one CSS animation each and no JavaScript once it starts.
 *
 * Drawn in the card's own ink at the size of its words, and still when the phone asks for reduced motion - the words
 * beside it already say what is happening, so the turning is decoration and never the message.
 */

/** The size of a tooth. Everything else is counted in teeth, so the machine stays meshed at any scale. */
const MODULE = 1.9;
/** The driving cog, then the two it turns: a number of teeth each, chosen so none of the ratios is a whole number. */
const TEETH = [13, 9, 7] as const;
/** How long the driving cog takes to come round once. The others follow from their teeth. */
const TURN_S = 3.4;

const TAU = Math.PI * 2;

export function WorkingGears({ label = 'Working' }: { label?: string }) {
  const [big, mid, small] = TEETH;
  const rBig = pitchRadius(big, MODULE);
  const rMid = pitchRadius(mid, MODULE);
  const rSmall = pitchRadius(small, MODULE);

  // The middle cog sits to the right of the driving one, the small one up and right of that: each at the sum of the
  // two pitch radii, which is where their teeth touch.
  const bigAt = { x: 0, y: 0 };
  const midAt = { x: rBig + rMid, y: 0 };
  const towards = -0.72;
  const smallAt = { x: midAt.x + (rMid + rSmall) * Math.cos(towards), y: midAt.y + (rMid + rSmall) * Math.sin(towards) };

  // A tooth of one into a gap of the next: the start angles that mesh them.
  const midAngle = outsidePhase(big, 0, 0, mid);
  const smallAngle = outsidePhase(mid, midAngle, towards, small);

  // Rolling without slipping: each cog turns the other way from the one driving it, faster by the ratio of teeth.
  const cogs = [
    { at: bigAt, teeth: big, angle: 0, seconds: TURN_S, way: 1 },
    { at: midAt, teeth: mid, angle: midAngle, seconds: (TURN_S * mid) / big, way: -1 },
    { at: smallAt, teeth: small, angle: smallAngle, seconds: (TURN_S * small) / big, way: 1 },
  ];

  const left = bigAt.x - rBig - MODULE;
  const top = smallAt.y - rSmall - MODULE;
  const right = smallAt.x + rSmall + MODULE;
  const foot = bigAt.y + rBig + MODULE;

  return (
    <span className={styles.gears} role="img" aria-label={label}>
      <svg viewBox={`${left} ${top} ${right - left} ${foot - top}`} aria-hidden="true" focusable="false">
        {cogs.map((cog, index) => (
          <g
            key={index}
            style={{
              transform: `translate(${cog.at.x}px, ${cog.at.y}px)`,
              // Each cog turns about its own middle, from the angle that meshes it.
              ['--from' as string]: `${(cog.angle / TAU) * 360}deg`,
              ['--to' as string]: `${(cog.angle / TAU) * 360 + cog.way * 360}deg`,
              ['--turn' as string]: `${cog.seconds.toFixed(2)}s`,
            }}
          >
            <path d={spurPath(cog.teeth, MODULE, cog.teeth > 10 ? 'holes' : 'spokes')} fillRule="evenodd" />
          </g>
        ))}
      </svg>
    </span>
  );
}
