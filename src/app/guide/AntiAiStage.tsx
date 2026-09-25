import { Droplets, Fish, Palette, Thermometer } from '@glacier/icons';
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { WispText } from '../art/WispText.tsx';
import { fireMicroTick, fireNativeHaptic } from '../core/haptics.ts';
import { GAGS, PLAYING, beatAt } from './antiAi.ts';
import { useCharging } from './charging.ts';
import type { Gag } from './antiAi.ts';
import styles from './AntiAiStage.module.css';

/**
 * Two gags about the AI Glyph isn't, played over the top of the heads-up
 * page (guide/antiAi.ts has the words and the order).
 *
 * Flat SVG, every movement a CSS animation timed to its beat, so a beat is one
 * React render: the flashing no symbol with the gag's title, then its scene
 * with the punchline. The no symbol is the one red thing on the page (Matt:
 * "bring color into the NO symbols"); the datacenter is drawn in the page's
 * ink and paper alone, no greys (Matt: "purely black and white no shades"),
 * and only its water has colour, blue going green. The scene drawings are
 * placeholders until his own SVGs, made from the prompts in
 * docs/prompts/anti-ai-svgs.md, replace them.
 *
 * - **Seals.** A baby seal on an ice floe, a club winds up from off screen,
 *   BONK, X eyes, a lump, stars going round.
 * - **Water.** A datacenter, LEDs blinking, pipes a lake through itself; the
 *   lake goes from clear blue to sludge green, the fish goes belly up, and it
 *   starts to stink.
 *
 * With reduced motion it doesn't play: the gags are listed still, each with
 * its icon.
 */

const ICONS: Record<Gag, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  seal: Fish,
  water: Droplets,
  art: Palette,
  hot: Thermometer,
};

function prefersStill(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The stamp's slap and settle; the reading time after the words are all in; the slide-away. */
const STAMP_LANDS_MS = 600;
const READ_AFTER_MS = 2000;
const LEAVE_MS = 760;
/** On the last gag, the beat after its words are in before the page points the reader down. */
const LAST_SETTLE_MS = 700;

/**
 * Left idle on the hot phone, its bubble asks to be plugged in, and if the real
 * phone goes on charge while it's asking, it says thanks (Matt: "if you've been
 * idle on the page for a bit have the phone ask to be plugged in and then thank
 * the user if they actually do plug the phone in"). Idle counts from when its
 * words have been read; a scroll, tap or key starts the count again.
 */
const IDLE_ASK_MS = 9000;
const BUBBLE_WORDS = { help: 'help me', ask: 'plug me in?', thanks: 'thank you!' } as const;
type Mood = keyof typeof BUBBLE_WORDS;

/** The hot phone's bubble: help, then (idle) the ask, then (plugged in) thanks. */
function usePhoneMood(read: boolean): Mood {
  const [mood, setMood] = useState<Mood>('help');
  const { charging } = useCharging();
  const chargingRef = useRef(charging);
  chargingRef.current = charging;
  useEffect(() => {
    if (!read || mood !== 'help') return undefined;
    let timer = 0;
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Only when the phone says it's off charge: already charging there's nothing to ask, and where it won't say (no
        // Battery API) the plugging in couldn't be heard to say thanks.
        if (chargingRef.current !== false) return;
        setMood('ask');
        fireNativeHaptic('light');
      }, IDLE_ASK_MS);
    };
    restart();
    const events = ['scroll', 'pointerdown', 'keydown'] as const;
    events.forEach((type) => document.addEventListener(type, restart, { capture: true, passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((type) => document.removeEventListener(type, restart, { capture: true }));
    };
  }, [read, mood]);
  useEffect(() => {
    if (mood !== 'ask' || charging !== true) return;
    setMood('thanks');
    fireNativeHaptic('success');
  }, [mood, charging]);
  return mood;
}

export function AntiAiStage({ waiting = false, onRound }: { waiting?: boolean; onRound?: () => void }) {
  // Which gag is playing: each once, in order, then the last one stays.
  const [index, setIndex] = useState(0);
  const [still] = useState(prefersStill);
  const beat = beatAt(index);

  // A beat leaves once both its stamp has landed and its words have finished typing, and then only after two seconds
  // more to read them (Matt: "add about 2 seconds after the text is done animating in"): the slide-away, then the next.
  // The last gag doesn't leave: it stays, its scene still playing, and the page points the reader on (Guide's nudge;
  // Matt: "don't cycle through the animation after the 'your phone is hot' one, just leave that animation playing and
  // then render in the scroll down CTA").
  const picture = useRef<SVGGElement>(null);
  const onRoundRef = useRef(onRound);
  onRoundRef.current = onRound;
  const [wordsDone, setWordsDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [stamped, setStamped] = useState(false);
  const last = index >= PLAYING.length - 1;
  const [read, setRead] = useState(false);
  const mood = usePhoneMood(read && beat.gag === 'hot');
  useEffect(() => {
    setWordsDone(false);
    setLeaving(false);
    setStamped(false);
    if (still || waiting) return undefined;
    const timer = window.setTimeout(() => setStamped(true), beat.sceneMs + STAMP_LANDS_MS);
    return () => window.clearTimeout(timer);
  }, [beat, index, still, waiting]);
  useEffect(() => {
    if (!stamped || !wordsDone) return undefined;
    if (last) {
      const timer = window.setTimeout(() => {
        onRoundRef.current?.();
        setRead(true);
      }, LAST_SETTLE_MS);
      return () => window.clearTimeout(timer);
    }
    const timers = [window.setTimeout(() => setLeaving(true), READ_AFTER_MS), window.setTimeout(() => setIndex((turn) => turn + 1), READ_AFTER_MS + LEAVE_MS)];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Read at the moment it fires; the turn it belongs to is this beat's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamped, wordsDone]);

  // The NO lands with a slam you feel, then a rumble that dithers away: hard taps thinning to soft ticks, further and further apart (Matt).
  useEffect(() => {
    if (still || waiting) return undefined;
    const impact = beat.sceneMs + 280;
    if (beat.stamp !== 'no') return undefined;
    const rumble: readonly [number, 'heavy' | 'medium' | 'light' | 'tick'][] = [
      [0, 'heavy'],
      [40, 'heavy'],
      [110, 'medium'],
      [170, 'medium'],
      [250, 'light'],
      [330, 'medium'],
      [430, 'light'],
      [540, 'tick'],
      [670, 'light'],
      [820, 'tick'],
      [1000, 'tick'],
    ];
    const timers = rumble.map(([at, kind]) => window.setTimeout(() => (kind === 'tick' ? fireMicroTick() : fireNativeHaptic(kind)), impact + at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [beat, index, still, waiting]);

  // The siren, felt: a pulse with each flash of the lights while the robot runs.
  useEffect(() => {
    if (still || waiting || beat.gag !== 'art') return undefined;
    const timers: number[] = [];
    for (let at = 200, i = 0; at < beat.sceneMs + 1300; at += 225, i += 1) {
      timers.push(window.setTimeout(() => (i % 2 === 0 ? fireNativeHaptic('medium') : fireMicroTick()), at));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [beat, index, still, waiting]);

  if (still) {
    return (
      <ul className={styles.stillList}>
        {PLAYING.map((gag) => {
          const Icon = ICONS[gag];
          return (
            <li key={gag} className={styles.stillItem} data-gag={gag}>
              <span className={styles.badge} aria-hidden="true">
                <Icon size={22} strokeWidth={2.2} />
              </span>
              <span>
                <strong className={styles.title}>{GAGS[gag].title}</strong>
                <span className={styles.line}>{GAGS[gag].line}</span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  // Held back until the headline has played (Matt: "don't show any of the clubbing seals or other animations until all the other animations have played through"); its room is kept so nothing jumps.
  if (waiting) {
    return (
      <section className={styles.stage} aria-hidden="true">
        <svg className={styles.scene} viewBox="0 0 320 180" />
        <div className={styles.caption} />
      </section>
    );
  }

  const words = GAGS[beat.gag];
  const Icon = ICONS[beat.gag];
  // The scene plays, the stamp slaps down over it at --slap, holds, and then scene and words go back into smoke.
  return (
    <section className={styles.stage} data-leaving={leaving || undefined} aria-live="polite" aria-label="What Ghost.md’s AI doesn’t do" style={{ '--beat': `${beat.sceneMs}ms`, '--slap': `${beat.sceneMs}ms` } as CSSProperties}>
      <svg key={index} className={styles.scene} viewBox="0 0 320 180" role="img" aria-label={`${words.title} ${words.line}`}>
        {leaving ? <SmokeOut target={picture} /> : null}
        <g ref={picture} filter={leaving ? 'url(#smokeOutWisp)' : undefined}>
        <g className={styles.shake}>
          {beat.gag === 'seal' ? <SealScene /> : beat.gag === 'art' ? <ArtScene /> : beat.gag === 'hot' ? <HotScene sceneMs={beat.sceneMs} /> : <WaterScene sceneMs={beat.sceneMs} />}
        </g>
        {/* The NO lands on what Glyph's AI doesn't do; the hot phone, what it does, gets no stamp (Matt: "remove the check mark that goes over the hot phones too"). */}
        {beat.stamp === 'no' ? <NoScene /> : null}
        {/* "help me", from the hot phone, once its scene has played; left idle it asks to be plugged in, and thanks you if you do. */}
        {beat.gag === 'hot' ? (
          <g key={mood} className={mood === 'help' ? styles.helpBubble : styles.helpBubbleNow} data-mood={mood}>
            <path d="M16 14 H80 Q88 14 88 22 V42 Q88 50 80 50 H78 C78 53 80 56 83 57.5 Q85.5 58.5 83.5 60 C77 62 71 57 68 50 H16 Q8 50 8 42 V22 Q8 14 16 14 Z" fill="var(--app-paper, #000)" stroke="currentColor" strokeWidth="4" />
            <text x="48" y="37" textAnchor="middle" className={styles.helpWords}>
              {BUBBLE_WORDS[mood]}
            </text>
          </g>
        ) : null}
        </g>
      </svg>
      {/* The heist brings the police: red and blue light strobing across the page behind everything. */}
      {beat.gag === 'art' ? <div key={`police-${index}`} className={styles.police} aria-hidden="true" /> : null}
      <div key={`words-${index}`} className={`${styles.caption} ${styles.away}`} data-gag={beat.gag}>
        <span className={styles.badge} aria-hidden="true">
          <Icon size={22} strokeWidth={2.2} />
        </span>
        {/* Every playing gag's words held in the same place, unseen, so the caption is always as tall as the longest and nothing jumps between slides. */}
        <span className={styles.wordsCell}>
          {PLAYING.map((gag) => (
            <span key={gag} className={styles.placeholder} aria-hidden="true">
              <span className={styles.title}>{GAGS[gag].title}</span>
              <span className={styles.line}>{GAGS[gag].line}</span>
            </span>
          ))}
          <CaptionWords title={words.title} line={words.line} leaving={leaving} onDone={() => setWordsDone(true)} />
        </span>
      </div>
    </section>
  );
}

/**
 * A gag's words, typed out of smoke with a tick per letter like the headline
 * (Matt: "should animate in with the normal text animations"): the title, then
 * its line once the title has settled. Remounted with each beat, so each types
 * afresh.
 */
function CaptionWords({ title, line, leaving, onDone }: { title: string; line: string; leaving: boolean; onDone: () => void }) {
  const [titled, setTitled] = useState(false);
  const tick = () => fireMicroTick();
  // Leaving, the words un-type back into smoke, the way they came.
  return (
    <span>
      <WispText as="span" className={styles.title} text={leaving ? '' : title} pace={22} onLetter={tick} onSettled={(shown) => shown && setTitled(true)} />
      {titled ? (
        <WispText as="span" className={styles.line} text={leaving ? '' : line} pace={34} onLetter={tick} onSettled={(shown) => shown && onDone()} />
      ) : (
        <span className={`${styles.line} ${styles.placeholder}`}>{line}</span>
      )}
    </span>
  );
}

/**
 * The way out, the way in backwards: over LEAVE_MS the whole picture is bent
 * and blurred by the same turbulence its lines were drawn out of, and fades
 * away as it goes (Matt: "fade away while doing the wisp effect"). Driven frame
 * by frame from script, since an SVG animation added mid-document would start
 * in the past.
 */
function SmokeOut({ target }: { target: React.RefObject<SVGGElement | null> }) {
  const bend = useRef<SVGFEDisplacementMapElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (LEAVE_MS - 60));
      bend.current?.setAttribute('scale', (34 * t * t).toFixed(1));
      blur.current?.setAttribute('stdDeviation', (3.5 * t).toFixed(2));
      if (target.current) target.current.style.opacity = String(1 - t * t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <defs>
      <filter id="smokeOutWisp" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="11" result="noise" />
        <feDisplacementMap ref={bend} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" result="bent" />
        <feGaussianBlur ref={blur} in="bent" stdDeviation="0" />
      </filter>
    </defs>
  );
}

/** When the phone's "help me" pops up: this long after the scene has played (where the A-OK used to land). */
const HELP_AFTER_CHECK_MS = 560;

/**
 * Just a hot phone, the one thing Glyph's AI does do: a phone with a note on
 * its screen, heat shimmering off it, a bead of sweat flying, and a
 * thermometer beside it filling with red, and a "help me" popping up beside it
 * (Matt), which asks to be plugged in if the page is left idle.
 */
function HotScene({ sceneMs }: { sceneMs: number }) {
  const mercuryCells = useShiftingDither(mercuryDither);
  // A little tap as the bubble pops up.
  useEffect(() => {
    const timer = window.setTimeout(() => fireNativeHaptic('light'), sceneMs + HELP_AFTER_CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [sceneMs]);
  const ink = 'currentColor';
  const paper = 'var(--app-paper, #000)';
  return (
    <g className={styles.hot} strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <filter id="wispHeat" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="noise">
            <animate attributeName="baseFrequency" values="0.05;0.085;0.05" dur="3.2s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" result="bent" />
          <feGaussianBlur in="bent" stdDeviation="0.9" />
        </filter>
      </defs>
      {/* Heat coming off the top of the phone, wavering like smoke. */}
      <g className={styles.heat} fill="none" stroke={ink} strokeWidth="4" filter="url(#wispHeat)">
        <path d="M138 40 q -6 -7 0 -14 t 0 -14" />
        <path d="M160 36 q -6 -7 0 -14 t 0 -14" style={{ animationDelay: '260ms' }} />
        <path d="M182 40 q -6 -7 0 -14 t 0 -14" style={{ animationDelay: '520ms' }} />
      </g>
      <g className={styles.phoneWarm}>
        <rect x="122" y="48" width="76" height="118" rx="14" fill={paper} stroke={ink} strokeWidth="6" />
        <line x1="150" y1="58" x2="170" y2="58" stroke={ink} strokeWidth="4" />
        {/* A note on its screen. */}
        <g stroke={ink} strokeWidth="4">
          <line x1="138" y1="80" x2="178" y2="80" />
          <line x1="138" y1="96" x2="170" y2="96" />
          <line x1="138" y1="112" x2="176" y2="112" />
          <line x1="138" y1="128" x2="160" y2="128" />
        </g>
        {/* Sweat. */}
        <path className={styles.sweat} d="M110 76 q -5 8 0 11 q 5 -3 0 -11 z" fill={ink} />
        <path className={styles.sweat} d="M210 92 q -5 8 0 11 q 5 -3 0 -11 z" fill={ink} style={{ animationDelay: '700ms' }} />
      </g>
      {/* The thermometer: one outline, tube and bulb, and one red shape inside, rising, dithering away at its foot. */}
      <defs>
        <clipPath id="mercuryRise">
          <rect className={styles.mercuryClip} x="226" y="40" width="32" height="130" />
        </clipPath>
        <mask id="mercuryFoot" maskUnits="userSpaceOnUse" x="220" y="40" width="44" height="130">
          <rect x="220" y="40" width="44" height={MERCURY_DITHER_FROM - 40} fill="#fff" />
          {mercuryCells.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={DITHER_CELL} height={DITHER_CELL} fill="#fff" />
          ))}
        </mask>
      </defs>
      <g>
        <path d="M232 60 A10 10 0 0 1 252 60 V136.8 A15 15 0 1 1 232 136.8 Z" fill={paper} stroke={ink} strokeWidth="5" />
        <g clipPath="url(#mercuryRise)" mask="url(#mercuryFoot)">
          <path d="M238 60 A4 4 0 0 1 246 60 V139.9 A9 9 0 1 1 238 139.9 Z" fill="var(--no, #ff3b30)" />
        </g>
        <g stroke={ink} strokeWidth="3">
          <line x1="258" y1="70" x2="266" y2="70" />
          <line x1="258" y1="90" x2="266" y2="90" />
          <line x1="258" y1="110" x2="266" y2="110" />
        </g>
      </g>
    </g>
  );
}

/** The NO: slapped down over the scene when it has played, with a glow behind it. */
function NoScene() {
  return (
    <g className={styles.no}>
      <circle className={styles.noGlow} cx="160" cy="90" r="80" />
      <g className={styles.noSign}>
        <circle cx="160" cy="90" r="58" fill="none" stroke="currentColor" strokeWidth="16" />
        <line x1="119" y1="49" x2="201" y2="131" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
      </g>
    </g>
  );
}


function SealScene() {
  // An infographic pictogram, not a cartoon: solid ink silhouettes on an ice slab in a moving sea, geometric and even, paper for the
  // details cut into them, and red only on the lump and the word. Built on the same parts and pivots as before, so the
  // swing, the squash, the X eyes and the dizziness still land (the seal block of AntiAiStage.module.css).
  const ink = 'currentColor';
  const paper = 'var(--app-paper, #000)';
  const red = 'var(--no, #ff3b30)';
  return (
    <g className={styles.seal} strokeLinecap="round" strokeLinejoin="round">
      <defs>
        {/* The water keeps its distance from the edges of the picture. */}
        <clipPath id="seaBounds">
          <rect x="22" y="110" width="276" height="66" rx="10" />
        </clipPath>
      </defs>
      {/* The floe: an ice slab seen a little from above, a white top and a solid ink edge, bobbing with the seal. */}
      <g className={styles.sealBody}>
        <path d="M62 122 L80 132 L248 130 L266 120 L266 134 L248 146 L80 148 L62 136 Z" fill={ink} stroke={ink} strokeWidth="4.5" />
        <path d="M62 122 L90 111 L232 109 L266 120 L248 130 L80 132 Z" fill={paper} stroke={ink} strokeWidth="4.5" />
        <path d="M104 118 L128 116 M196 115 L222 117" fill="none" stroke={ink} strokeWidth="3" />
      </g>
      {/* The sea closes over the slab's foot: paper below the waterline, then three waves drifting at their own speeds. */}
      <g clipPath="url(#seaBounds)">
        <rect x="0" y="139" width="320" height="41" fill={paper} />
        <path className={styles.waveNear} d="M-40 138 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0 c 7.3 -3.2 12.7 -3.2 20.0 0 c 7.3 3.2 12.7 3.2 20.0 0" fill="none" stroke={ink} strokeWidth="4.5" />
        <path className={styles.waveMid} d="M-56 153 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0 c 10.2 2.6 17.8 2.6 28.0 0 c 10.2 -2.6 17.8 -2.6 28.0 0" fill="none" stroke={ink} strokeWidth="3.5" strokeDasharray="40 16" />
        <path className={styles.waveFar} d="M-72 166 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0 c 13.1 2.2 22.9 2.2 36.0 0 c 13.1 -2.2 22.9 -2.2 36.0 0" fill="none" stroke={ink} strokeWidth="3" strokeDasharray="44 28" />
      </g>
      {/* Ripples rolling out from where the slab meets the water. */}
      <g stroke={ink} strokeWidth="3" fill="none">
        <path className={styles.ripple} d="M52 142 q -8 0 -14 -4" />
        <path className={styles.ripple} d="M276 140 q 8 0 14 -4" style={{ animationDelay: '600ms' }} />
      </g>

      <g className={styles.sealBody}>
        {/* Body: one smooth silhouette from the neck to the tail flippers. */}
        <path d="M112 84 C150 80 190 90 212 106 L234 94 C236 102 234 110 228 114 L238 122 C226 124 216 123 210 121 C186 124 138 124 112 120 Z" fill={ink} />
        {/* Fore flipper, set off from the body by a paper edge. */}
        <path d="M136 121 C142 128 152 130 160 126" fill="none" stroke={paper} strokeWidth="7" />
        <path d="M136 121 C142 128 152 130 160 126" fill="none" stroke={ink} strokeWidth="4" />
        <g className={styles.sealHead}>
          <circle cx="110" cy="100" r="20" fill={ink} />
          <path d="M92 100 C86 102 84 108 90 111 C96 114 104 112 106 108" fill={ink} />
          <circle cx="88" cy="106" r="2.6" fill={paper} />
          <g className={styles.eyesOpen}>
            <circle cx="104" cy="94" r="3.6" fill={paper} />
          </g>
          <g className={styles.eyesX} stroke={paper} strokeWidth="2.6">
            <path d="M100.5 90.5 l7 7 M107.5 90.5 l-7 7" />
          </g>
          <circle className={styles.lump} cx="114" cy="74" r="7" fill={red} />
        </g>
        {/* Dizziness: three clean four-point sparks going round. */}
        <g className={styles.dizzy}>
          <g className={styles.orbit} fill={ink}>
            <path d="M86 58 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z" />
            <path d="M136 56 l1.6 -5 l1.6 5 l5 1.6 l-5 1.6 l-1.6 5 l-1.6 -5 l-5 -1.6 z" />
            <path d="M110 46 l1.3 -4 l1.3 4 l4 1.3 l-4 1.3 l-1.3 4 l-1.3 -4 l-4 -1.3 z" />
          </g>
        </g>
      </g>

      {/* The arm and club: solid ink, a sleeve bar, a round fist, a tapered club. */}
      <g className={styles.club}>
        <rect x="226" y="-60" width="22" height="78" rx="11" fill={ink} />
        <g className={styles.clubStick}>
          <path d="M236 14.5 L170 12 C140 10 104 9 98 18 C104 27 140 26 170 24 L236 21.5 Z" fill={ink} />
        </g>
        <circle cx="236" cy="18" r="10" fill={ink} stroke={paper} strokeWidth="3" />
      </g>

      {/* The hit: radiating strokes and the word, no comic burst. */}
      <g className={styles.bonk}>
        <g stroke={ink} strokeWidth="4">
          <path d="M78 34 V24 M56 42 l-7 -7 M100 42 l7 -7 M48 62 H38 M108 62 H118" />
        </g>
        <text x="78" y="70" textAnchor="middle" className={styles.bonkWord}>
          BONK
        </text>
      </g>
    </g>
  );
}

/**
 * The art heist, in the same pictogram hand: a gallery wall with an empty frame
 * where a painting hung, its artist sobbing under it (Matt: "add a crying human
 * artist"), and a robot sprinting off across the floor with the painting under
 * its arm, legs going, arm pumping, speed lines behind.
 */
function ArtScene() {
  const ink = 'currentColor';
  const paper = 'var(--app-paper, #000)';
  return (
    <g className={styles.art} strokeLinecap="round" strokeLinejoin="round">
      {/* The floor, and the wall's empty frame: the painting's outline still dashed where it hung. */}
      <line x1="20" y1="150" x2="300" y2="150" stroke={ink} strokeWidth="6" />
      <rect x="26" y="40" width="58" height="46" fill={paper} stroke={ink} strokeWidth="5" />
      <rect x="36" y="50" width="38" height="26" fill="none" stroke={ink} strokeWidth="3" strokeDasharray="5 5" />
      <line x1="55" y1="40" x2="55" y2="28" stroke={ink} strokeWidth="3" />

      {/* The artist, left under the empty frame: beret on, face in hands, shoulders heaving, tears falling. */}
      <g className={styles.sob}>
        <path d="M34 150 C34 128 40 116 54 116 C68 116 74 128 74 150 Z" fill={ink} />
        <circle cx="54" cy="102" r="11" fill={ink} />
        <ellipse cx="52" cy="90" rx="11" ry="4" fill={ink} transform="rotate(-14 52 90)" />
        <circle cx="45" cy="86" r="2.5" fill={ink} />
        {/* Hands up over the face, set off from it by paper. */}
        <path d="M42 124 C40 114 44 106 50 104 M66 124 C68 114 64 106 58 104" fill="none" stroke={paper} strokeWidth="9" />
        <path d="M42 124 C40 114 44 106 50 104 M66 124 C68 114 64 106 58 104" fill="none" stroke={ink} strokeWidth="5" />
      </g>
      <g className={styles.tears} fill="var(--tear, #2f7df6)">
        <path className={styles.tear} d="M44 108 q-3 5 0 7 q3 -2 0 -7 z" />
        <path className={styles.tear} d="M65 108 q-3 5 0 7 q3 -2 0 -7 z" style={{ animationDelay: '380ms' }} />
        <path className={styles.tear} d="M44 108 q-3 5 0 7 q3 -2 0 -7 z" style={{ animationDelay: '760ms' }} />
      </g>

      <g className={styles.robotRun}>
        {/* Speed lines trailing it. */}
        <g className={styles.speed} stroke={ink} strokeWidth="4">
          <line x1="66" y1="92" x2="88" y2="92" />
          <line x1="58" y1="106" x2="86" y2="106" />
          <line x1="70" y1="120" x2="90" y2="120" />
        </g>
        <g className={styles.robotBob}>
          {/* Legs, swinging from the hips. */}
          <g className={styles.legBack}>
            <line x1="116" y1="114" x2="104" y2="146" stroke={ink} strokeWidth="9" />
          </g>
          <g className={styles.legFront}>
            <line x1="126" y1="114" x2="138" y2="146" stroke={ink} strokeWidth="9" />
          </g>
          {/* The back arm, pumping. */}
          <g className={styles.armBack}>
            <line x1="106" y1="86" x2="92" y2="104" stroke={ink} strokeWidth="8" />
          </g>
          {/* Torso, neck, head with its visor and antenna. */}
          <rect x="102" y="78" width="36" height="38" rx="6" fill={ink} />
          <circle cx="120" cy="96" r="5" fill={paper} />
          <rect x="116" y="72" width="8" height="8" fill={ink} />
          <rect x="104" y="48" width="32" height="26" rx="6" fill={ink} />
          <rect x="112" y="56" width="20" height="8" rx="4" fill={paper} />
          <line x1="120" y1="48" x2="120" y2="38" stroke={ink} strokeWidth="3" />
          <circle cx="120" cy="36" r="3.5" fill={ink} />
          {/* The painting under its front arm: a frame, a little landscape in it. */}
          <g transform="rotate(-10 160 90)">
            <rect x="136" y="68" width="52" height="40" fill={paper} stroke={ink} strokeWidth="5" />
            <path d="M142 102 L156 86 L166 96 L174 88 L184 102 Z" fill={ink} />
            <circle cx="176" cy="78" r="4" fill={ink} />
          </g>
          <line x1="134" y1="86" x2="150" y2="100" stroke={ink} strokeWidth="8" />
        </g>
      </g>
    </g>
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * An ordered (Bayer 4×4) dither from nothing to solid across the sludge's first
 * stretch out of the datacenter: a cell is on where its threshold is under how
 * far along it is. The cells of the mask on the pipe's sludge (WaterScene).
 */
const DITHER_CELL = 2;
const DITHER_FROM = 123;
const DITHER_TO = 151;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** A shift into the Bayer matrix: a different shift is the same density with its pixels in other places. */
type Shift = readonly [number, number];

function sludgeDither([sx, sy]: Shift): [number, number][] {
  const cells: [number, number][] = [];
  for (let x = DITHER_FROM, col = 0; x < DITHER_TO; x += DITHER_CELL, col += 1) {
    const along = (x + DITHER_CELL / 2 - DITHER_FROM) / (DITHER_TO - DITHER_FROM);
    for (let y = 94, row = 0; y < 110; y += DITHER_CELL, row += 1) {
      if ((BAYER[(row + sy) % 4]![(col + sx) % 4]! + 0.5) / 16 < along) cells.push([x, y]);
    }
  }
  return cells;
}

/** The thermometer's red, solid down to the top of its bulb, then dithering away to nothing at its foot (HotScene). */
const MERCURY_DITHER_FROM = 142;
const MERCURY_DITHER_TO = 158;
function mercuryDither([sx, sy]: Shift): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = MERCURY_DITHER_FROM, row = 0; y < MERCURY_DITHER_TO; y += DITHER_CELL, row += 1) {
    const solid = 1 - (y + DITHER_CELL / 2 - MERCURY_DITHER_FROM) / (MERCURY_DITHER_TO - MERCURY_DITHER_FROM);
    for (let x = 230, col = 0; x < 256; x += DITHER_CELL, col += 1) {
      if ((BAYER[(row + sy) % 4]![(col + sx) % 4]! + 0.5) / 16 < solid) cells.push([x, y]);
    }
  }
  return cells;
}

/**
 * A dither that slowly shuffles (Matt: "the dither should be animated … slowly
 * randomize"): every so often the matrix shifts to another random offset, so
 * the same fade has its pixels somewhere new.
 */
function useShiftingDither(build: (shift: Shift) => [number, number][], everyMs = 420): [number, number][] {
  const [shift, setShift] = useState<Shift>([0, 0]);
  useEffect(() => {
    if (prefersStill()) return undefined;
    const timer = window.setInterval(() => setShift([Math.floor(Math.random() * 4), Math.floor(Math.random() * 4)]), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return build(shift);
}

/** A number between `low` and `high`. */
const between = (low: number, high: number) => low + Math.random() * (high - low);

/**
 * The lake's bubbles, felt, and the stink, felt. Matt: "I want the bubble
 * haptics to be sporadic and line up with the bubbles in the water itself and
 * the stinky lines".
 *
 * Bubbles are made one at a time at uneven moments (every 180 to 1100 ms, now
 * and then two close together), at a random spot in the water, and each rises
 * for its own time, swelling, and pops at the surface. Two soft ticks as it
 * swells and a tap as it pops, on that bubble's own clock, so what is felt is
 * what is seen. Each is coloured by the same blue-to-green as the lake, picked
 * up at the moment it's made.
 *
 * The stink lines, as each rises into view (CSS `stinkIn`, 60–76% of the scene,
 * a line every 220 ms), give a wobbly shudder: a tap and two soft ticks.
 */
function useLakeFeel(layer: React.RefObject<SVGGElement | null>, sceneMs: number) {
  useEffect(() => {
    const group = layer.current;
    if (!group || typeof group.animate !== 'function') return undefined;
    const started = performance.now();
    const timers: number[] = [];
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    const stopAt = sceneMs + 1300;

    const bubble = () => {
      const elapsed = performance.now() - started;
      if (elapsed > stopAt) return;
      const rise = between(900, 1700);
      const r = between(2.5, 5.5);
      const x = between(178, 286);
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', x.toFixed(1));
      circle.setAttribute('cy', between(156, 164).toFixed(1));
      circle.setAttribute('r', r.toFixed(1));
      circle.setAttribute('class', styles.bubble ?? '');
      // The lake's colour right now: the fill animation, started as far in as the scene is.
      circle.style.animationDelay = `-${Math.round(elapsed)}ms`;
      group.appendChild(circle);
      const lift = -between(14, 22);
      const motion = circle.animate(
        [
          { opacity: 0, transform: 'translateY(4px) scale(0.5)' },
          { opacity: 1, offset: 0.2 },
          { opacity: 1, transform: `translateY(${lift * 0.85}px) scale(1.25)`, offset: 0.86 },
          { opacity: 0, transform: `translateY(${lift}px) scale(1.9)` },
        ],
        { duration: rise, easing: 'ease-in', fill: 'forwards' },
      );
      motion.onfinish = () => circle.remove();
      later(rise * 0.45, () => fireMicroTick());
      later(rise * 0.72, () => fireMicroTick());
      later(rise * 0.86, () => fireNativeHaptic(r > 4.5 ? 'medium' : 'light'));
      // The next one, sporadically: mostly a while, sometimes right behind this one.
      later(Math.random() < 0.25 ? between(120, 260) : between(420, 1100), bubble);
    };
    later(between(200, 600), bubble);

    for (const delay of [0, 220, 440]) {
      const at = sceneMs * 0.66 + delay;
      later(at, () => fireNativeHaptic('medium'));
      later(at + 70, () => fireMicroTick());
      later(at + 150, () => fireMicroTick());
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      group.replaceChildren();
    };
  }, [layer, sceneMs]);
}

/**
 * Lines drawn in out of smoke, like the headline's letters (Matt: "ghastly draw
 * in the lines with the wisp effect"): every element marked `data-draw` traces
 * its stroke from nothing, one after another, while the whole drawing is bent
 * and blurred by a turbulence filter that settles to still; `data-fade` shapes
 * fade in with them. The filter comes off once it has settled, so it costs
 * nothing after.
 */
const DRAW_MS = 675;
const DRAW_STAGGER_MS = 82;
const SETTLE_MS = 1300;

function useDrawIn(root: React.RefObject<SVGGElement | null>) {
  useEffect(() => {
    const group = root.current;
    if (!group || typeof group.animate !== 'function') return undefined;
    const drawn = Array.from(group.querySelectorAll<SVGGeometryElement>('[data-draw]'));
    // Lines in one group (the pipe's margin, wall and bore) draw as one, at the same moment and pace, so the pipe is
    // hollow as it goes rather than a solid bar that opens up after.
    const turns = new Map<string, number>();
    let turn = 0;
    drawn.forEach((el) => {
      const name = el.dataset.drawGroup;
      let at: number;
      if (name && turns.has(name)) at = turns.get(name)!;
      else {
        at = turn;
        turn += 1;
        if (name) turns.set(name, at);
      }
      const length = Math.ceil(el.getTotalLength?.() ?? 0) + 2;
      el.style.strokeDasharray = `${length} ${length}`;
      el.animate(
        [
          { strokeDashoffset: length, fillOpacity: 0 },
          { strokeDashoffset: 0, fillOpacity: 1 },
        ],
        { duration: DRAW_MS, delay: at * DRAW_STAGGER_MS, easing: 'cubic-bezier(0.35, 0.1, 0.25, 1)', fill: 'backwards' },
      );
    });
    group.querySelectorAll<SVGElement>('[data-fade]').forEach((el) => {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DRAW_MS, delay: drawn.length * DRAW_STAGGER_MS * 0.6, fill: 'backwards' });
    });
    const timer = window.setTimeout(() => group.removeAttribute('filter'), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [root]);
}

function WaterScene({ sceneMs }: { sceneMs: number }) {
  const bubbles = useRef<SVGGElement>(null);
  const drawing = useRef<SVGGElement>(null);
  const sludgeCells = useShiftingDither(sludgeDither);
  useLakeFeel(bubbles, sceneMs);
  useDrawIn(drawing);
  return (
    <g ref={drawing} className={styles.water} filter="url(#wispDraw)">
      <defs>
        {/* The smoke the lines come out of: a bend that eases to nothing, and a blur that clears. */}
        <filter id="wispDraw" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" result="bent">
            <animate attributeName="scale" values="30;10;0" keyTimes="0;0.6;1" dur="1.2s" fill="freeze" />
          </feDisplacementMap>
          <feGaussianBlur in="bent" stdDeviation="0">
            <animate attributeName="stdDeviation" values="3.5;1;0" keyTimes="0;0.5;1" dur="1.2s" fill="freeze" />
          </feGaussianBlur>
        </filter>
        {/* The smoke's own wisp, always moving: steam and stink waver and soften like the headline's letters settling. */}
        <filter id="wispSmoke" x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="noise">
            <animate attributeName="baseFrequency" values="0.05;0.085;0.05" dur="3.2s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" result="bent" />
          <feGaussianBlur in="bent" stdDeviation="0.9" />
        </filter>
      </defs>
      <defs>
        <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className={styles.lakeTop} />
          <stop offset="1" className={styles.lakeBottom} />
        </linearGradient>
      </defs>
      {/* The datacenter: a slab of racks with lights fading on and off, puffing out of its smokestack; ink lines on paper, no grey. */}
      <g className={styles.steam} fill="none" stroke="currentColor" strokeWidth="4" filter="url(#wispSmoke)">
        <circle cx="98" cy="22" r="7" />
        <circle cx="98" cy="22" r="9" />
        <circle cx="98" cy="22" r="6" />
      </g>
      <rect data-draw="" x="88" y="30" width="20" height="18" rx="2" fill="var(--app-paper, #000)" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      <path data-draw="" d="M18 138 V50 Q18 44 24 44 H120 Q126 44 126 50 V138" fill="var(--app-paper, #000)" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
      {/* The ground and the lake's bowl, one unbroken line: along under the datacenter, then down and round the water, open at the top. */}
      <path data-draw="" d="M10 138 H150 Q152 176 230 176 Q308 176 310 138" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      {/* The roof: a line at the building's own weight, not a slab. */}
      <line data-draw="" x1="20.5" y1="56" x2="123.5" y2="56" stroke="currentColor" strokeWidth="5" />
      {[30, 62, 94].map((x, column) => (
        <g key={x}>
          <rect data-draw="" x={x} y="70" width="22" height="62" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
          {[0, 1, 2, 3, 4].map((row) => (
            <circle
              key={row}
              className={styles.led}
              cx={x + 6 + ((row + column) % 2) * 10}
              cy={78 + row * 12}
              r="2.8"
              fill="currentColor"
              style={{ animationDelay: `${((row * 5 + column * 7) % 11) * 140}ms` }}
            />
          ))}
        </g>
      ))}
      {/* The pipe from the lake, through the racks, and back into the lake. */}
      <path data-draw="" data-draw-group="pipe" d="M129 102 H160 Q180 102 180 122 V130" fill="none" stroke="var(--app-paper, #000)" strokeWidth="34" strokeLinecap="butt" />
      <path data-draw="" data-draw-group="pipe" d="M126 102 H160 Q180 102 180 122 V130" fill="none" stroke="currentColor" strokeWidth="24" strokeLinecap="butt" />
      {/* A band of paper inside the pipe's wall, so the sludge runs clear of it. */}
      <path data-draw="" data-draw-group="pipe" d="M123 102 H160 Q180 102 180 122 V130" fill="none" stroke="var(--app-paper, #000)" strokeWidth="16" strokeLinecap="butt" />
      {/* Inside the pipe the water runs the whole way, in its turning colour, streaks of paper travelling along it. */}
      <defs>
        {/* Where the sludge leaves the datacenter it dithers in, a pixel at a time, instead of starting at a hard edge. */}
        <mask id="sludgeFade" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="180">
          <rect x={DITHER_TO} y="0" width={320 - DITHER_TO} height="180" fill="#fff" />
          {sludgeCells.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={DITHER_CELL} height={DITHER_CELL} fill="#fff" />
          ))}
        </mask>
      </defs>
      <g mask="url(#sludgeFade)">
        <path className={styles.pour} d="M123 102 H160 Q180 102 180 122 V150" fill="none" strokeWidth="10" strokeLinecap="butt" />
        <path className={styles.pipeFlow} d="M123 102 H160 Q180 102 180 122 V150" fill="none" strokeWidth="3.5" strokeLinecap="butt" />
      </g>

      <path data-fade="" d="M156 138 Q158 170 230 170 Q302 170 304 138 Z" fill="url(#lake)" />
      <ellipse cx="230" cy="139" rx="72" ry="4" className={styles.lakeSurface} />
      {/* Rings spreading where the sewage hits the lake's surface. */}
      <g className={styles.drips}>
        <ellipse className={styles.splash} cx="180" cy="140" rx="8" ry="2.6" fill="none" strokeWidth="2.5" />
        <ellipse className={styles.splash} cx="180" cy="140" rx="8" ry="2.6" fill="none" strokeWidth="2.5" style={{ animationDelay: '450ms' }} />
      </g>
      {/* Bubbles come and go here at their own uneven times (useLakeFeel). */}
      <g ref={bubbles} className={styles.bubbles} />
      <g className={styles.fish}>
        <g className={styles.fishFlip}>
          {/* A cut-out of paper round the fish, so the water stands clear of it. */}
          <g fill="var(--app-paper, #000)" stroke="var(--app-paper, #000)" strokeWidth="7" strokeLinejoin="round">
            <ellipse cx="230" cy="154" rx="13" ry="7" />
            <path d="M243 154 l9 -7 v14 z" />
          </g>
          <ellipse cx="230" cy="154" rx="13" ry="7" fill="currentColor" />
          <path d="M243 154 l9 -7 v14 z" fill="currentColor" />
          <circle className={styles.fishEye} cx="222" cy="152" r="2.2" fill="var(--app-paper, #000)" />
          <path className={styles.fishEyeX} d="M219.5 149.5 l5 5 M224.5 149.5 l-5 5" stroke="var(--app-paper, #000)" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>
      <g className={styles.stink} fill="none" stroke="#9dff3a" strokeWidth="5" strokeLinecap="round" filter="url(#wispSmoke)">
        <path d="M200 118 q -6 -8 0 -16 t 0 -16" />
        <path d="M232 114 q -6 -8 0 -16 t 0 -16" style={{ animationDelay: '220ms' }} />
        <path d="M264 118 q -6 -8 0 -16 t 0 -16" style={{ animationDelay: '440ms' }} />
      </g>
    </g>
  );
}
