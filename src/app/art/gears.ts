/**
 * Gears that mesh, as geometry: the shapes, and a layout that fills a screen
 * with a working machine. For the thinking animation (art/ThinkingGears.tsx;
 * Matt: "a thinking animation that plays on the whole screen while the AI is
 * thinking, gears on the page that all cleanly mesh together, different kinds
 * of gears").
 *
 * Every gear in one machine shares a module `m` (the size of a tooth), so any
 * two can mesh: a gear of `n` teeth has a pitch circle of radius `n·m/2`, and
 * two meshing gears sit exactly the sum of their pitch radii apart (or, for a
 * gear turning inside a ring, the difference). Speeds follow from the pitch
 * circles rolling on each other without slipping: an outside mesh turns the
 * other way at `n₁/n₂` the speed, an inside mesh the same way.
 *
 * The part that makes teeth interleave instead of crossing is the phase. A
 * gear's "tooth phase" in a direction is how many teeth, counted from its
 * tooth 0, lie between its own zero and that direction: `n·(ψ − θ)/2π`. A
 * whole number means a tooth points exactly that way. Where two gears meet,
 * a tooth of one has to face a gap of the other, so their phases at the
 * contact point must add up (outside mesh) or differ (inside mesh, and a rack)
 * by a half. Those sums are constant while the gears turn at their rolling
 * speeds, so a machine set right at the start stays right forever; the tests
 * check it over time.
 *
 * Angles are radians on the screen: y points down, so a positive angle turns
 * clockwise, as CSS `rotate()` does.
 *
 * The kinds: spur gears (plain, spoked, or drilled), a stacked pair turning
 * on one axle, a planetary set (a ring with teeth inside and out, three
 * planets on a fixed carrier, and a sun), and a rack sliding under a pinion
 * and an idler, which swing back and forth with it.
 */

export type Hub = 'plain' | 'spokes' | 'holes';

export type GearKind = 'spur' | 'stacked' | 'ring' | 'planet' | 'sun' | 'pinion';

export interface Gear {
  id: number;
  kind: GearKind;
  /** Teeth: a spur's, or a ring's inside teeth. */
  teeth: number;
  /** A ring's outside teeth, by which the machine drives it. */
  outerTeeth?: number;
  /** The centre, in px. */
  x: number;
  y: number;
  /** Turning speed, rad/s, clockwise positive. Zero for a gear that swings instead. */
  omega: number;
  /** Its angle at the start. */
  phase: number;
  /**
   * For a gear that swings with the rack: how far, in radians, it turns at the swing's end. Its angle is
   * `phase + swing·s`, with `s` running −1…1 and back, the same `s` as the rack's.
   */
  swing?: number;
  hub: Hub;
  /** Drawn over the machine rather than in it: a stacked gear's top. */
  top?: boolean;
}

export interface Rack {
  /** The pitch line, in px from the top. */
  pitchY: number;
  /** Where a tooth is centred when the rack is at rest (s = 0). */
  origin: number;
  pitch: number;
  /** How far it slides each way, px: its offset is `amplitude·s`. */
  amplitude: number;
}

export interface Mesh {
  a: number;
  b: number;
  kind: 'outside' | 'inside';
  /** From a's centre toward b's, radians. */
  direction: number;
}

export interface GearLayout {
  width: number;
  height: number;
  module: number;
  gears: Gear[];
  meshes: Mesh[];
  rack: Rack | null;
  /** The pinion the rack meshes with. */
  rackPinion: number | null;
  /** How long one swing of the rack takes, one way, ms. */
  swingMs: number;
}

const TAU = Math.PI * 2;
/** How steep a tooth's sides are: the classic 20° pressure angle. */
const FLANK = Math.tan((20 * Math.PI) / 180);

export const pitchRadius = (teeth: number, module: number): number => (teeth * module) / 2;
/** How far a gear reaches: its pitch circle plus a tooth's height above it. */
export const outerRadius = (gear: Pick<Gear, 'teeth' | 'outerTeeth' | 'kind'>, module: number): number =>
  pitchRadius(gear.kind === 'ring' ? (gear.outerTeeth ?? gear.teeth) : gear.teeth, module) + module;

/** The tooth phase of a gear of `teeth` at `angle`, in the direction `direction`: whole where a tooth points that way. */
export function toothPhase(teeth: number, angle: number, direction: number): number {
  return (teeth * (direction - angle)) / TAU;
}

/** The fractional part, always 0…1. */
export const frac = (value: number): number => value - Math.floor(value);

/** The start angle for a gear of `teeth` meshing on the outside of a gear (`teethA`, at `angleA`), placed in `direction` from it. */
export function outsidePhase(teethA: number, angleA: number, direction: number, teeth: number): number {
  const phaseA = toothPhase(teethA, angleA, direction);
  return direction + Math.PI - (TAU * (0.5 - phaseA)) / teeth;
}

/** The start angle for a gear of `teeth` turning inside a ring (`ringTeeth` inside teeth, at `ringAngle`), placed in `direction` from the ring's centre. */
export function insidePhase(ringTeeth: number, ringAngle: number, direction: number, teeth: number): number {
  const phaseRing = toothPhase(ringTeeth, ringAngle, direction);
  return direction - (TAU * (phaseRing + 0.5)) / teeth;
}

/** Where a rack under a pinion (`teeth` at `angle`, centred at `x`) has a tooth centred, so the pinion's teeth fall in its gaps. */
export function rackOrigin(teeth: number, angle: number, x: number, pitch: number): number {
  return x - pitch * (0.5 - toothPhase(teeth, angle, Math.PI / 2));
}

// ---- shapes ------------------------------------------------------------------------------------

const f = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(2));
const polar = (radius: number, angle: number): string => `${f(radius * Math.cos(angle))} ${f(radius * Math.sin(angle))}`;

/**
 * One closed ring of teeth around the centre: outward for a spur, inward for a ring gear. Each tooth is straight
 * sided at the pressure angle, a tip arc and a root arc, and a hair thinner than half the pitch, so meshing teeth
 * never quite touch.
 */
function toothOutline(teeth: number, module: number, inward: boolean): string {
  const pitchR = pitchRadius(teeth, module);
  const tip = inward ? pitchR - module : pitchR + module;
  const root = inward ? pitchR + 1.25 * module : pitchR - 1.25 * module;
  const step = TAU / teeth;
  const halfAtPitch = (Math.PI * pitchR) / teeth / 2 - 0.05 * module;
  // Thinner toward the tip: outward for a spur, inward for a ring's teeth.
  const halfAt = (radius: number) => halfAtPitch - (inward ? pitchR - radius : radius - pitchR) * FLANK;
  const rootHalf = Math.min(halfAt(root) / root, step * 0.47);
  const tipHalf = Math.max(halfAt(tip) / tip, step * 0.1);
  // A tip arc turns the short way along the tooth; a root arc along the gap between teeth.
  let d = `M ${polar(root, -rootHalf)}`;
  for (let k = 0; k < teeth; k += 1) {
    const c = k * step;
    d += ` L ${polar(tip, c - tipHalf)} A ${f(tip)} ${f(tip)} 0 0 1 ${polar(tip, c + tipHalf)} L ${polar(root, c + rootHalf)}`;
    d += ` A ${f(root)} ${f(root)} 0 0 1 ${polar(root, c + step - rootHalf)}`;
  }
  return `${d} Z`;
}

const circle = (radius: number, cx = 0, cy = 0): string =>
  `M ${f(cx + radius)} ${f(cy)} A ${f(radius)} ${f(radius)} 0 1 1 ${f(cx - radius)} ${f(cy)} A ${f(radius)} ${f(radius)} 0 1 1 ${f(cx + radius)} ${f(cy)} Z`;

/** The cut-outs inside a gear's body: the axle hole, and spokes or a ring of holes when there is room for them. */
function hubCuts(hub: Hub, rim: number, module: number, count: number): string {
  const axle = Math.max(1.6 * module, rim * 0.14);
  let d = circle(axle);
  const inner = axle * 2.3;
  const outer = rim - 1.6 * module;
  if (outer - inner < 4 * module) return d;
  if (hub === 'spokes') {
    const half = 1.1 * module;
    for (let k = 0; k < count; k += 1) {
      const a0 = (k * TAU) / count;
      const a1 = ((k + 1) * TAU) / count;
      d += ` M ${polar(inner, a0 + half / inner)} L ${polar(outer, a0 + half / outer)} A ${f(outer)} ${f(outer)} 0 0 1 ${polar(outer, a1 - half / outer)}`;
      d += ` L ${polar(inner, a1 - half / inner)} A ${f(inner)} ${f(inner)} 0 0 0 ${polar(inner, a0 + half / inner)} Z`;
    }
  } else if (hub === 'holes') {
    const at = (inner + outer) / 2;
    const size = Math.min((outer - inner) * 0.34, ((Math.PI * at) / count) * 0.55);
    for (let k = 0; k < count; k += 1) d += ` ${circle(size, at * Math.cos((k * TAU) / count), at * Math.sin((k * TAU) / count))}`;
  }
  return d;
}

/** A spur gear, centred on 0,0, its tooth 0 pointing along +x: the outline and its cut-outs, for `fill-rule: evenodd`. */
export function spurPath(teeth: number, module: number, hub: Hub): string {
  const rim = pitchRadius(teeth, module) - 1.25 * module;
  return `${toothOutline(teeth, module, false)} ${hubCuts(hub, rim, module, teeth >= 30 ? 6 : teeth >= 20 ? 5 : 4)}`;
}

/** A ring gear: teeth inside and out on one band, for `fill-rule: evenodd`. */
export function ringPath(innerTeeth: number, outerTeeth: number, module: number): string {
  return `${toothOutline(outerTeeth, module, false)} ${toothOutline(innerTeeth, module, true)}`;
}

/** The carrier the planets turn on: a plate joining their axles, still. */
export function carrierPath(arm: number, module: number, count: number): string {
  let d = circle(arm * 0.34);
  for (let k = 0; k < count; k += 1) d += ` ${circle(1.4 * module, arm * Math.cos((k * TAU) / count + Math.PI / 2), arm * Math.sin((k * TAU) / count + Math.PI / 2))}`;
  return d;
}

/** A rack's teeth along its pitch line, from `from` to `to` px, pointing up, with the body below; y 0 is the pitch line. */
export function rackPath(from: number, to: number, pitch: number, origin: number, module: number, depth: number): string {
  const tip = -module;
  const root = 1.25 * module;
  const halfAtPitch = pitch / 4 - 0.05 * module;
  const tipHalf = halfAtPitch - module * FLANK;
  const rootHalf = Math.min(halfAtPitch + 1.25 * module * FLANK, pitch * 0.47);
  const first = Math.floor((from - origin) / pitch) - 1;
  const last = Math.ceil((to - origin) / pitch) + 1;
  let d = `M ${f(origin + first * pitch - rootHalf)} ${f(depth)} L ${f(origin + first * pitch - rootHalf)} ${f(root)}`;
  for (let k = first; k <= last; k += 1) {
    const c = origin + k * pitch;
    d += ` L ${f(c - rootHalf)} ${f(root)} L ${f(c - tipHalf)} ${f(tip)} L ${f(c + tipHalf)} ${f(tip)} L ${f(c + rootHalf)} ${f(root)}`;
  }
  return `${d} L ${f(origin + last * pitch + rootHalf)} ${f(depth)} Z`;
}

// ---- a machine --------------------------------------------------------------------------------

/** A small, seeded random, so a layout can be made again and tested. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tooth's worth of clearance between gears that do not mesh. */
const CLEAR = 1.5;

interface Placed {
  gear: Gear;
  /** Its reach, for collisions. */
  reach: number;
}

/**
 * A machine for a screen `width` × `height`: a large driving gear, a planetary set driven by its ring, spur gears of
 * mixed sizes and hubs meshed off whatever has room, stacked gears on a few axles, and along the bottom a rack
 * swinging under a pinion and an idler. Gears may run off the edges, as a machine seen through a window does; none
 * overlaps another it does not mesh with. `speed` is how fast the pitch circles roll, px/s.
 */
export function layoutGears(width: number, height: number, seed: number, speed = 24): GearLayout {
  const random = seeded(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const short = Math.min(width, height);
  const module = Math.max(3.2, Math.min(6, short / 92));
  const gears: Gear[] = [];
  const placed: Placed[] = [];
  const meshes: Mesh[] = [];
  let nextId = 0;

  const reachOf = (gear: Gear) => outerRadius(gear, module);
  const fits = (x: number, y: number, reach: number, except: readonly number[]) => {
    const slack = reach * 0.35;
    if (x < -slack || x > width + slack || y < -slack || y > height + slack) return false;
    return placed.every((p) => except.includes(p.gear.id) || Math.hypot(p.gear.x - x, p.gear.y - y) >= p.reach + reach + CLEAR * module);
  };
  const add = (gear: Omit<Gear, 'id'>): Gear => {
    const made = { ...gear, id: nextId++ };
    gears.push(made);
    placed.push({ gear: made, reach: reachOf(made) });
    return made;
  };
  const spinFor = (teeth: number) => speed / pitchRadius(teeth, module);

  // The rack along the bottom, its pinion and an idler, first, so the rest of the machine keeps clear of them.
  const pitch = Math.PI * module;
  const pitchY = height - 3.2 * module;
  const pinionTeeth = 14;
  const pinionR = pitchRadius(pinionTeeth, module);
  const pinion = add({ kind: 'pinion', teeth: pinionTeeth, x: width * (0.18 + random() * 0.18), y: pitchY - pinionR, omega: 0, phase: random() * TAU, swing: 0, hub: 'holes' });
  const amplitude = pitch * 2.5;
  pinion.swing = -amplitude / pinionR;
  const rack: Rack = { pitchY, origin: rackOrigin(pinionTeeth, pinion.phase, pinion.x, pitch), pitch, amplitude };
  const idlerTeeth = 22;
  const idlerDirection = -Math.PI / 2 - (0.45 + random() * 0.5);
  const idlerDistance = pinionR + pitchRadius(idlerTeeth, module);
  const idler = add({
    kind: 'spur',
    teeth: idlerTeeth,
    x: pinion.x + idlerDistance * Math.cos(idlerDirection),
    y: pinion.y + idlerDistance * Math.sin(idlerDirection),
    omega: 0,
    phase: outsidePhase(pinionTeeth, pinion.phase, idlerDirection, idlerTeeth),
    swing: -(pinion.swing * pinionTeeth) / idlerTeeth,
    hub: 'spokes',
  });
  meshes.push({ a: pinion.id, b: idler.id, kind: 'outside', direction: idlerDirection });
  // Nothing else reaches down into the rack.
  const aboveRack = (y: number, reach: number) => y + reach <= pitchY - 2.2 * module;
  const swingers = [pinion.id, idler.id];

  // The driver: large, high on the screen.
  const driverTeeth = short > 600 ? 44 : 36;
  const driver = add({ kind: 'spur', teeth: driverTeeth, x: width * (0.58 + random() * 0.14), y: height * (0.26 + random() * 0.08), omega: spinFor(driverTeeth), phase: random() * TAU, hub: 'spokes' });

  // The planetary set, driven through its ring's outside teeth.
  const ringInner = 42;
  const ringOuter = 54;
  const sunTeeth = 18;
  const planetTeeth = 12;
  const ringReach = pitchRadius(ringOuter, module) + module;
  const ringDistance = pitchRadius(driverTeeth, module) + pitchRadius(ringOuter, module);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const direction = Math.PI * (0.55 + random() * 0.4);
    const x = driver.x + ringDistance * Math.cos(direction);
    const y = driver.y + ringDistance * Math.sin(direction);
    if (!fits(x, y, ringReach, [driver.id]) || !aboveRack(y, ringReach)) continue;
    const ringPhase = outsidePhase(driverTeeth, driver.phase, direction, ringOuter);
    const ring = add({ kind: 'ring', teeth: ringInner, outerTeeth: ringOuter, x, y, omega: (-driver.omega * driverTeeth) / ringOuter, phase: ringPhase, hub: 'plain' });
    meshes.push({ a: driver.id, b: ring.id, kind: 'outside', direction });
    const arm = pitchRadius(ringInner, module) - pitchRadius(planetTeeth, module);
    const planets: Gear[] = [];
    for (let k = 0; k < 3; k += 1) {
      const toward = Math.PI / 2 + (k * TAU) / 3;
      const planet: Gear = {
        id: nextId++,
        kind: 'planet',
        teeth: planetTeeth,
        x: x + arm * Math.cos(toward),
        y: y + arm * Math.sin(toward),
        omega: (ring.omega * ringInner) / planetTeeth,
        phase: insidePhase(ringInner, ringPhase, toward, planetTeeth),
        hub: 'plain',
      };
      gears.push(planet);
      planets.push(planet);
      meshes.push({ a: ring.id, b: planet.id, kind: 'inside', direction: toward });
    }
    const first = planets[0]!;
    const fromPlanet = Math.PI / 2 + Math.PI;
    const sun: Gear = {
      id: nextId++,
      kind: 'sun',
      teeth: sunTeeth,
      x,
      y,
      omega: (-first.omega * planetTeeth) / sunTeeth,
      phase: outsidePhase(planetTeeth, first.phase, fromPlanet, sunTeeth),
      hub: 'holes',
    };
    gears.push(sun);
    planets.forEach((planet, k) => meshes.push({ a: planet.id, b: sun.id, kind: 'outside', direction: Math.PI / 2 + (k * TAU) / 3 + Math.PI }));
    break;
  }

  // Spur gears off whatever outside teeth have room, until the screen is busy.
  const target = Math.round((width * height) / 26000) + 4;
  const sizes = [10, 12, 14, 16, 18, 20, 24, 28, 32];
  const hubs: Hub[] = ['plain', 'spokes', 'holes', 'spokes'];
  for (let attempt = 0; attempt < 700 && gears.filter((g) => g.kind === 'spur').length < target; attempt += 1) {
    const from = pick(gears.filter((g) => (g.kind === 'spur' || g.kind === 'ring') && !g.top && !swingers.includes(g.id)));
    const fromTeeth = from.kind === 'ring' ? from.outerTeeth! : from.teeth;
    const teeth = pick(sizes);
    const direction = random() * TAU;
    const distance = pitchRadius(fromTeeth, module) + pitchRadius(teeth, module);
    const x = from.x + distance * Math.cos(direction);
    const y = from.y + distance * Math.sin(direction);
    const reach = pitchRadius(teeth, module) + module;
    if (!fits(x, y, reach, [from.id]) || !aboveRack(y, reach)) continue;
    const gear = add({
      kind: 'spur',
      teeth,
      x,
      y,
      omega: (-from.omega * fromTeeth) / teeth,
      phase: outsidePhase(fromTeeth, from.phase, direction, teeth),
      hub: teeth >= 18 ? pick(hubs) : 'plain',
    });
    meshes.push({ a: from.id, b: gear.id, kind: 'outside', direction });
  }

  // A stacked gear on the axle of a few big ones: a smaller gear on top, turning with it.
  for (const base of gears.filter((g) => g.kind === 'spur' && g.teeth >= 24 && !swingers.includes(g.id)).slice(0, 2)) {
    const teeth = Math.max(10, Math.round(base.teeth * 0.42));
    gears.push({ id: nextId++, kind: 'stacked', teeth, x: base.x, y: base.y, omega: base.omega, phase: random() * TAU, hub: 'plain', top: true });
  }

  return { width, height, module, gears, meshes, rack, rackPinion: pinion.id, swingMs: 3400 };
}

/**
 * A gear's angle at `t` seconds, with the swing at `s` (−1…1): what the animation draws, and what the tests turn to
 * check that the teeth stay interleaved.
 */
export function angleAt(gear: Gear, t: number, s = 0): number {
  return gear.phase + gear.omega * t + (gear.swing ?? 0) * s;
}
