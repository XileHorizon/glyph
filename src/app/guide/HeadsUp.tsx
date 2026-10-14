import { Flame } from '@glacier/icons';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { WispText } from '../art/WispText.tsx';
import { fireMicroTick, fireNativeHaptic } from '../core/haptics.ts';
import styles from './HeadsUp.module.css';

/**
 * The heads-up's headline, felt as well as seen.
 *
 * "Heads up: we use" types out of smoke (WispText) with a soft tick on each
 * letter. Then a held breath: a pause, and ". . ." one dot at a time, each with
 * its own tap. Then "AI." bursts in over a flame (three of Lucide's flames,
 * red, orange and yellow, flickering out of step) with a rumbling fire buzz,
 * and the punchline types in under it, smaller, with the same held breaths:
 * "Ethically! By . . . stealing . . . your phone's CPU." (Matt: "make the 'ethically'
 * say 'By ... stealing ... your phones CPU'").
 * Matt: "haptics playing as the text animates in, add a haptic pause and a
 * '. . .' with a haptic on each dot pausing for a short bit in between before
 * showing AI and doing a fire haptic buzz, then continue the rest of the text".
 */

type Phase = 'lead' | 'dots' | 'ai' | 'rest';


/** The breath before the dots, the gap between them, and the hold on the last. Quick (Matt: "speed up the animations and waiting"). */
const BREATH_MS = 220;
const DOT_GAP_MS = 280;
const HOLD_MS = 280;

/** Letters a second, quicker than WispText's hand. */
const PACE = 24;

/** How long "AI." holds, lit, once typed, before the punchline starts. */
const AI_HOLD_MS = 450;

/**
 * Fire: it combusts, a burst of hard taps packed tight, then burns for a
 * moment, an uneven crackle of taps and soft ticks that slowly thins out.
 * Matt: "I want to feel the rumble of it combust and start burning for a moment".
 */
const FIRE: readonly [number, 'heavy' | 'medium' | 'light' | 'tick'][] = [
  // Whoomph.
  [0, 'heavy'],
  [35, 'heavy'],
  [70, 'heavy'],
  [110, 'medium'],
  [150, 'heavy'],
  [200, 'medium'],
  // Burning: crackles at uneven gaps.
  [270, 'light'],
  [320, 'tick'],
  [380, 'medium'],
  [430, 'tick'],
  [470, 'light'],
  [560, 'tick'],
  [610, 'medium'],
  [690, 'tick'],
  [760, 'light'],
  [840, 'tick'],
  [930, 'light'],
  [1010, 'tick'],
  [1120, 'light'],
  [1240, 'tick'],
  [1380, 'tick'],
];

/** The second line, a piece at a time: words typed out of smoke, and dots each with a tap. */
const PUNCHLINE: readonly ({ kind: 'words'; text: string; police?: boolean } | { kind: 'dots' })[] = [
  { kind: 'words', text: 'Ethically!' },
  { kind: 'words', text: ' By ' },
  { kind: 'dots' },
  // "stealing" brings the police: red and blue lights across the page, and on the word (Matt).
  { kind: 'words', text: ' stealing ', police: true },
  { kind: 'dots' },
  { kind: 'words', text: ' your phone’s CPU.' },
];
const PUNCHLINE_TEXT = 'Ethically! By . . stealing . . your phone’s CPU.';

/** The punchline's dots: two, not three, and quicker than the held breath before the AI (Matt). */
const QUICK = { count: 2, breath: 90, gap: 160, hold: 140 } as const;

/** Dots, one at a time, each with a tap; then `onDone`. */
function Dots({ onDone, count = QUICK.count, breath = QUICK.breath, gap = QUICK.gap, hold = QUICK.hold }: { onDone: () => void; count?: number; breath?: number; gap?: number; hold?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const timers = Array.from({ length: count }, (_, i) =>
      window.setTimeout(() => {
        setShown(i + 1);
        fireNativeHaptic('medium');
      }, breath + i * gap),
    );
    timers.push(window.setTimeout(onDone, breath + (count - 1) * gap + hold));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Played once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span className={styles.inlineDots}>
      {Array.from({ length: count }, (_, i) => i + 1).map((dot) => (
        <span key={dot} className={styles.dot} data-shown={shown >= dot || undefined}>
          .
        </span>
      ))}
    </span>
  );
}

/** Where the fire sits over the words before it, in the words' own box: the patch its heat bends. */
interface HeatSpot {
  /** The words' box, which the filter's user space is measured from. */
  w: number;
  h: number;
  /** The patch over the flame, reaching up a little past its tips. */
  x: number;
  y: number;
  sw: number;
  sh: number;
}

function useHeatSpot(words: RefObject<HTMLElement | null>, fire: RefObject<HTMLElement | null>, on: boolean): HeatSpot | null {
  const [spot, setSpot] = useState<HeatSpot | null>(null);
  useLayoutEffect(() => {
    if (!on) return undefined;
    const measure = () => {
      const box = words.current?.getBoundingClientRect();
      const flame = fire.current?.getBoundingClientRect();
      if (!box || !flame) return;
      const reach = flame.height * 0.25;
      setSpot({ w: box.width, h: box.height, x: flame.left - box.left, y: flame.top - box.top - reach, sw: flame.width, sh: flame.height + reach });
    };
    measure();
    // Again once the flame has finished growing in (its scale transition).
    const grown = window.setTimeout(measure, 650);
    const observer = new ResizeObserver(measure);
    if (words.current) observer.observe(words.current);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(grown);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [words, fire, on]);
  return on ? spot : null;
}

/** How long the police lights run once "stealing" starts, fading out at the end. */
const SIREN_MS = 1800;

export function HeadsUp({ onDone }: { onDone?: () => void }) {
  const [piece, setPiece] = useState(0);
  const [phase, setPhase] = useState<Phase>('lead');
  const [dots, setDots] = useState(0);

  // "AI." lingers, lit, a moment after it types, then the punchline.
  const [aiTyped, setAiTyped] = useState(false);
  useEffect(() => {
    if (phase !== 'ai' || !aiTyped) return undefined;
    const timer = window.setTimeout(() => setPhase('rest'), AI_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase, aiTyped]);

  useEffect(() => {
    if (phase !== 'dots') return undefined;
    const timers = [1, 2, 3].map((dot) =>
      window.setTimeout(() => {
        setDots(dot);
        fireNativeHaptic('medium');
      }, BREATH_MS + (dot - 1) * DOT_GAP_MS),
    );
    timers.push(window.setTimeout(() => setPhase('ai'), BREATH_MS + 2 * DOT_GAP_MS + HOLD_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  // The fire, felt, from the moment the AI lights. Its own timers, kept past the next phase change (the AI settles and
  // the punchline starts while it's still burning) and cleared only when the page goes. Set inside the dots' timers,
  // as it first was, the very phase change that started it cleared it.
  const burning = useRef<number[]>([]);
  useEffect(() => {
    if (phase !== 'ai') return;
    burning.current = FIRE.map(([at, kind]) => window.setTimeout(() => (kind === 'tick' ? fireMicroTick() : fireNativeHaptic(kind)), at));
  }, [phase]);
  useEffect(() => () => burning.current.forEach((timer) => window.clearTimeout(timer)), []);

  // The last piece of the punchline has settled: the rest of the page may start its show.
  useEffect(() => {
    if (piece >= PUNCHLINE.length) onDone?.();
  }, [piece, onDone]);

  // The police arrive with "stealing": lights for a while, a pulse of haptics with each flash, then gone.
  const stealingAt = PUNCHLINE.findIndex((part) => part.kind === 'words' && part.police);
  const [siren, setSiren] = useState<'off' | 'on' | 'leaving'>('off');
  const sirenStarted = phase === 'rest' && piece >= stealingAt;
  useEffect(() => {
    if (!sirenStarted) return;
    setSiren('on');
    const timers: number[] = [];
    for (let at = 0, i = 0; at < SIREN_MS; at += 225, i += 1) timers.push(window.setTimeout(() => (i % 2 === 0 ? fireNativeHaptic('medium') : fireMicroTick()), at));
    timers.push(window.setTimeout(() => setSiren('leaving'), SIREN_MS));
    timers.push(window.setTimeout(() => setSiren('off'), SIREN_MS + 500));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [sirenStarted]);

  const hazeId = `fireHaze-${useId().replace(/:/g, '')}`;
  // Once "Heads up: we use" has typed and the fire is lit, its heat bends the letters the flame sits over; the flame stays crisp
  // (Matt: "I want the effect to affect the d and the s text behind it, not the actual fire itself, after you're done").
  const leadWords = useRef<HTMLSpanElement>(null);
  const fire = useRef<HTMLSpanElement>(null);
  const tick = () => fireMicroTick();
  const lit = phase === 'ai' || phase === 'rest';
  const heat = useHeatSpot(leadWords, fire, lit);

  return (
    <h1 className={styles.headsUp} aria-label={`Heads up: we use AI. ${PUNCHLINE_TEXT}`}>
      {siren !== 'off' ? <span className={styles.police} data-leaving={siren === 'leaving' || undefined} aria-hidden="true" /> : null}
      <span className={styles.big} aria-hidden="true">
        {heat ? (
          <svg className={styles.hazeDefs} aria-hidden="true">
            {/* Bent by the noise inside the patch over the fire (soft-edged), untouched outside it. User space is the words' own box. */}
            <filter id={`${hazeId}-words`} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={-20} y={-20} width={heat.w + 40} height={heat.h + 40} colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.035 0.11" numOctaves="2" seed="7" result="noise">
                <animate attributeName="baseFrequency" values="0.035 0.11;0.05 0.16;0.035 0.11" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="seed" values="7;8;9;10;11;12" dur="0.9s" calcMode="discrete" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G" result="bent" />
              <feFlood floodColor="#fff" x={heat.x + heat.sw * 0.1} y={heat.y + heat.sh * 0.1} width={heat.sw * 0.8} height={heat.sh * 0.8} result="patch" />
              <feGaussianBlur in="patch" stdDeviation={heat.sw * 0.12} x={-20} y={-20} width={heat.w + 40} height={heat.h + 40} result="spot" />
              <feComposite in="bent" in2="spot" operator="in" result="bentSpot" />
              <feComposite in="SourceGraphic" in2="spot" operator="out" result="rest" />
              <feMerge>
                <feMergeNode in="rest" />
                <feMergeNode in="bentSpot" />
              </feMerge>
            </filter>
          </svg>
        ) : null}
        <span ref={leadWords} style={{ filter: heat ? `url(#${hazeId}-words)` : undefined }}>
          <WispText text="Heads up: we use " pace={PACE} onLetter={tick} onSettled={() => setPhase((was) => (was === 'lead' ? 'dots' : was))} />
        </span>
        <span className={styles.ai}>
          <span ref={fire} className={styles.flame} data-lit={lit || undefined}>
            <Flame className={styles.outer} size={24} strokeWidth={1.4} />
            <Flame className={styles.middle} size={24} strokeWidth={1.4} />
            <Flame className={styles.core} size={24} strokeWidth={1.4} />
          </span>
          {phase === 'dots' ? (
            <span className={styles.dots}>
              {[1, 2, 3].map((dot) => (
                <span key={dot} className={styles.dot} data-shown={dots >= dot || undefined}>
                  .
                </span>
              ))}
            </span>
          ) : null}
          {lit ? <WispText text="AI." pace={40} onSettled={() => setAiTyped(true)} /> : <span className={styles.placeholder}>AI.</span>}
        </span>
      </span>
      <span className={styles.small} aria-hidden="true">
        {/* The whole line held in place, hidden, so nothing below moves while it types. */}
        <span className={styles.placeholder}>{PUNCHLINE_TEXT}</span>
        <span className={styles.typing}>
          {phase === 'rest'
            ? PUNCHLINE.slice(0, piece + 1).map((part, index) =>
                part.kind === 'dots' ? (
                  <Dots key={index} onDone={() => setPiece((was) => Math.max(was, index + 1))} />
                ) : part.police ? (
                  <span key={index} className={styles.stealing} data-siren={siren !== 'off' || undefined}>
                    <WispText text={part.text} pace={PACE} onLetter={tick} onSettled={() => setPiece((was) => Math.max(was, index + 1))} />
                  </span>
                ) : (
                  <WispText key={index} text={part.text} pace={PACE} onLetter={tick} onSettled={() => setPiece((was) => Math.max(was, index + 1))} />
                ),
              )
            : null}
        </span>
      </span>
    </h1>
  );
}
