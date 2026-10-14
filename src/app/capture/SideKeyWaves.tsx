import { useEffect, useRef, useState } from 'react';
import { origin, type Spot } from './sideKey.ts';
import styles from './SideKeyWaves.module.css';
import { onVoiceLevel, paceRings, type RingPacer } from './voiceLevel.ts';

const SVG = 'http://www.w3.org/2000/svg';
/** More than this many rings on screen at once is a smear, not a picture of a voice. */
const MOST_RINGS = 9;

/**
 * Rings rising from where the side key is, while a recording from the side
 * key runs: a picture of sound, and a pointer at the key that stops it.
 *
 * The rings start just outside the screen's edge beside the key, so what
 * shows is arcs opening into the screen, the way sound leaves a speaker.
 * In the page's faintest ink, over the words and under the top line, so the
 * page's text never hides them (Matt: "the waves that come from me talking
 * get lost behind content on the page"). Nothing marks the key itself: a glow
 * there read as a stray dot ("a strange dot near the center that isn't
 * needed").
 *
 * The voice sends them out (Matt: "make the ripple … react to the levels of my
 * voice as I record the note"). In a pause, one faint ring every 2.7 seconds,
 * so the screen shows it is listening; talking, rings go out as often as five
 * a second, each wider, brighter, thicker and quicker the louder the voice
 * (voiceLevel.ts `paceRings`). Rings
 * are added and animated straight in the DOM (Web Animations), never through
 * a React render. Decoration only. With reduced motion three rings stand still.
 *
 * `contained` draws inside its parent instead of over the whole screen, for
 * the preview in Settings.
 */
export function SideKeyWaves({ spot, contained = false }: { spot: Spot; contained?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const at = origin(spot, width, height, contained ? 4 : 12);
  // Far enough to cross most of the screen's width, never the whole screen.
  const reach = contained ? Math.max(width, height) * 0.9 : Math.min(Math.max(width, height) * 0.5, width * 1.1);
  const rings = useRef<SVGGElement>(null);
  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const group = rings.current;
    if (!group || width === 0 || still || typeof group.animate !== 'function') return undefined;
    let level = 0;
    const off = onVoiceLevel((next) => (level = next));
    const pacer: RingPacer = { smooth: 0, lastRingAt: -Infinity };
    let frame = 0;
    const tick = (now: number) => {
      const shape = paceRings(pacer, level, now);
      if (shape && group.childElementCount < MOST_RINGS) {
        const ring = document.createElementNS(SVG, 'circle');
        ring.setAttribute('class', styles.ring ?? '');
        ring.setAttribute('cx', String(at.x));
        ring.setAttribute('cy', String(at.y));
        ring.setAttribute('r', String(reach));
        ring.style.transformOrigin = `${at.x}px ${at.y}px`;
        ring.style.strokeWidth = `${shape.stroke}px`;
        group.appendChild(ring);
        const animation = ring.animate(
          [
            { transform: 'scale(0.04)', opacity: 0 },
            { opacity: shape.opacity, offset: 0.1 },
            { opacity: shape.opacity * 0.32, offset: 0.6 },
            { transform: `scale(${shape.reach})`, opacity: 0 },
          ],
          { duration: shape.durationMs, easing: 'cubic-bezier(0.2, 0.6, 0.35, 1)', fill: 'forwards' },
        );
        animation.onfinish = () => ring.remove();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(frame);
      group.replaceChildren();
    };
  }, [width, height, at.x, at.y, reach, still]);

  return (
    <div
      ref={box}
      className={styles.waves}
      data-contained={contained ? '' : undefined}
      aria-hidden="true"
    >
      {width > 0 ? (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <g ref={rings}>
            {still
              ? [0, 1, 2].map((i) => (
                  <circle key={i} className={`${styles.ring} ${styles.still}`} cx={at.x} cy={at.y} r={reach} style={{ transformOrigin: `${at.x}px ${at.y}px` }} />
                ))
              : null}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
