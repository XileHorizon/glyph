import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { onScreen, sideKeySpot, type Edge, type SideKeySpot } from './sideKeys.ts';
import { grown, paceWaves, shining, wobbleAmount, wobbleAt, type Pacer, type Ring } from './waves.ts';
import styles from './SideKeyWaves.module.css';

/**
 * Rings widening out of the screen's edge where this phone's side key is
 * (sideKeys.ts), behind the first page's words: the key is there, and the
 * page knows it. Nothing points at it and nothing says "press" (Matt: "don't
 * do anything to prompt the user to press it yet").
 *
 * Drawn on a canvas, since the rings are not circles: their outlines waver
 * (waves.ts) and they keep a resting beat. They answered the microphone once
 * (Matt: "make the pulsing waves wobbly and have them react to the phone's
 * microphone"), and no longer do: a page that is only read is no place for an
 * open microphone (Matt: "disable the always on microphone only enable it when
 * actually recording or in memo mode"). Each ring is centred on the edge
 * itself, so only its inner half shows. Under reduced motion two rings sit
 * still and faint.
 */

const POINTS = 96;
const MAX_RINGS = 14;

function maker(): string {
  try {
    return window.GlyphHost?.deviceMaker?.() ?? '';
  } catch {
    return '';
  }
}

/** This phone's side key, read once. */
function useSideKeySpot(): SideKeySpot {
  return useMemo(() => sideKeySpot(typeof navigator === 'undefined' ? '' : navigator.userAgent, maker()), []);
}

class Waves {
  private rings: Ring[] = [];
  private readonly pacer: Pacer = { smooth: 0, lastAt: -Infinity };
  private level = 0;
  private raf = 0;
  /** The ink, as the canvas's computed colour: any form the browser gives (rgb, oklch), used as it is. */
  private ink = 'currentColor';
  private inkReadAt = -Infinity;
  private stopped = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly edge: Edge,
    /** How far down the screen the key is, 0..1. */
    private readonly at: number,
  ) {}

  hear(level: number): void {
    this.level = level;
  }

  start(): void {
    this.fit();
    window.addEventListener('resize', this.fit);
    document.addEventListener('visibilitychange', this.onVisible);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Reduced motion: two rings, drawn once, still. */
  still(): void {
    this.fit();
    this.readInk(0);
    this.rings = [
      { born: 0, life: 1, reach: 0.45, alpha: 0.16, width: 1.5, seed: 0.4 },
      { born: 0, life: 1, reach: 0.9, alpha: 0.16, width: 1.5, seed: 1.9 },
    ];
    this.draw(0.5, 0);
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.fit);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private readonly fit = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private readonly onVisible = (): void => {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** The ink, from the canvas's own colour, once a second: the theme can change under the page. */
  private readInk(now: number): void {
    if (now - this.inkReadAt < 1000) return;
    this.inkReadAt = now;
    const colour = getComputedStyle(this.canvas).color;
    if (colour) this.ink = colour;
  }

  private readonly frame = (now: number): void => {
    if (this.stopped) return;
    // Hidden: frames stop, and start again when the page is seen (onVisible).
    if (document.visibilityState === 'hidden') return;
    this.readInk(now);
    const ring = paceWaves(this.pacer, this.level, now);
    if (ring) {
      this.rings.push(ring);
      if (this.rings.length > MAX_RINGS) this.rings.shift();
    }
    this.rings = this.rings.filter((r) => now - r.born < r.life);
    this.draw(null, now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Every ring, at `now`; `fixedT` draws them all at one point of their life (the still picture). */
  private draw(fixedT: number | null, now: number): void {
    const { ctx } = this;
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    const originX = this.edge === 'right' ? width : 0;
    const originY = this.at * height;
    const base = 0.36 * Math.min(width, height);
    const amount = wobbleAmount(this.pacer.smooth);
    const seconds = now / 1000;
    for (const ring of this.rings) {
      const t = fixedT ?? (now - ring.born) / ring.life;
      const radius = base * ring.reach * grown(t);
      if (radius < 1) continue;
      ctx.beginPath();
      for (let i = 0; i <= POINTS; i += 1) {
        const theta = (i / POINTS) * Math.PI * 2;
        const r = radius * (1 + amount * wobbleAt(theta, seconds, ring.seed));
        const x = originX + r * Math.cos(theta);
        const y = originY + r * Math.sin(theta);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = ring.alpha * (fixedT === null ? shining(t) : 1);
      ctx.strokeStyle = this.ink;
      ctx.lineWidth = ring.width;
      ctx.stroke();
    }
  }
}

export function SideKeyWaves({ spot }: { spot?: SideKeySpot }) {
  const found = useSideKeySpot();
  const key = spot ?? found;
  const host = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext('2d') ?? null;
    // No drawing surface (a test's document): the layer is simply empty.
    if (!canvas || !ctx) return undefined;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const waves = new Waves(canvas, ctx, key.edge, onScreen(key.at));
    if (reduced) {
      waves.still();
      return () => waves.stop();
    }
    waves.start();
    return () => waves.stop();
  }, [key]);

  const style = { '--at': `${(onScreen(key.at) * 100).toFixed(1)}%` } as CSSProperties;
  return <canvas ref={host} className={styles.waves} data-edge={key.edge} style={style} aria-hidden="true" data-testid="side-key-waves" />;
}
