import { describe, expect, it } from 'vitest';
import { angleAt, frac, insidePhase, layoutGears, outerRadius, outsidePhase, pitchRadius, rackOrigin, ringPath, spurPath, toothPhase, type Gear, type GearLayout } from './gears.ts';

const TAU = Math.PI * 2;
/** How far a phase sum may be from a half before the teeth would show crossing: well under a hundredth of a tooth. */
const NEAR = 1e-6;

/** The teeth a gear meshes with on its outside: a ring's outer set, anything else its only one. */
const outside = (gear: Gear) => (gear.kind === 'ring' ? gear.outerTeeth! : gear.teeth);

/** Distance around the unit circle from `value`'s fraction to a half. */
const offHalf = (value: number) => Math.abs(frac(value) - 0.5);

function byId(layout: GearLayout, id: number): Gear {
  const gear = layout.gears.find((g) => g.id === id);
  if (!gear) throw new Error(`no gear ${id}`);
  return gear;
}

/** Every mesh of a layout holds at `t` seconds with the swing at `s`: a tooth of one gear always faces a gap of the other. */
function meshesHold(layout: GearLayout, t: number, s: number): void {
  for (const mesh of layout.meshes) {
    const a = byId(layout, mesh.a);
    const b = byId(layout, mesh.b);
    const angleA = angleAt(a, t, s);
    const angleB = angleAt(b, t, s);
    if (mesh.kind === 'outside') {
      const sum = toothPhase(outside(a), angleA, mesh.direction) + toothPhase(outside(b), angleB, mesh.direction + Math.PI);
      expect(offHalf(sum), `outside mesh ${a.kind} ${a.id} → ${b.kind} ${b.id} at t=${t}`).toBeLessThan(NEAR);
    } else {
      const difference = toothPhase(b.teeth, angleB, mesh.direction) - toothPhase(a.teeth, angleA, mesh.direction);
      expect(offHalf(difference), `inside mesh ring ${a.id} → ${b.kind} ${b.id} at t=${t}`).toBeLessThan(NEAR);
    }
  }
}

describe('two gears meshing', () => {
  it('keeps a tooth of one in a gap of the other as they turn at their rolling speeds', () => {
    const teethA = 30;
    const teethB = 12;
    const direction = 0.83;
    const a = { phase: 0.4, omega: 0.7 };
    const b = { phase: outsidePhase(teethA, a.phase, direction, teethB), omega: (-a.omega * teethA) / teethB };
    for (let t = 0; t < 40; t += 0.37) {
      const sum = toothPhase(teethA, a.phase + a.omega * t, direction) + toothPhase(teethB, b.phase + b.omega * t, direction + Math.PI);
      expect(offHalf(sum)).toBeLessThan(NEAR);
    }
  });

  it('keeps a planet in step with the ring it turns inside', () => {
    const ringTeeth = 42;
    const planetTeeth = 12;
    const ring = { phase: 1.1, omega: -0.3 };
    for (const direction of [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 + (2 * TAU) / 3]) {
      const planet = { phase: insidePhase(ringTeeth, ring.phase, direction, planetTeeth), omega: (ring.omega * ringTeeth) / planetTeeth };
      for (let t = 0; t < 30; t += 0.41) {
        const difference = toothPhase(planetTeeth, planet.phase + planet.omega * t, direction) - toothPhase(ringTeeth, ring.phase + ring.omega * t, direction);
        expect(offHalf(difference)).toBeLessThan(NEAR);
      }
    }
  });

  it('keeps a rack in step with its pinion however far it slides', () => {
    const teeth = 14;
    const module = 4;
    const pitch = Math.PI * module;
    const r = pitchRadius(teeth, module);
    const phase = 2.2;
    const x = 120;
    const origin = rackOrigin(teeth, phase, x, pitch);
    for (let slide = -40; slide <= 40; slide += 3.3) {
      const angle = phase - slide / r;
      const rackPhase = (x - origin - slide) / pitch;
      expect(offHalf(toothPhase(teeth, angle, Math.PI / 2) + rackPhase)).toBeLessThan(NEAR);
    }
  });
});

describe('a machine for a screen', () => {
  const screens: [string, number, number][] = [
    ['a phone', 390, 844],
    ['an unfolded Fold', 904, 820],
    ['a small phone', 360, 640],
  ];

  for (const [name, width, height] of screens) {
    it(`meshes every pair on ${name}, at any moment and any point of the swing`, () => {
      for (const seed of [1, 7, 42, 2026]) {
        const layout = layoutGears(width, height, seed);
        for (const t of [0, 1.7, 13.3, 90]) for (const s of [-1, -0.4, 0, 0.8, 1]) meshesHold(layout, t, s);
      }
    });

    it(`sets meshing gears exactly a pitch apart, and nothing else touching, on ${name}`, () => {
      for (const seed of [3, 11, 99]) {
        const layout = layoutGears(width, height, seed);
        const { module } = layout;
        for (const mesh of layout.meshes) {
          const a = byId(layout, mesh.a);
          const b = byId(layout, mesh.b);
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const expected =
            mesh.kind === 'outside'
              ? pitchRadius(outside(a), module) + pitchRadius(outside(b), module)
              : pitchRadius(a.teeth, module) - pitchRadius(b.teeth, module);
          expect(distance).toBeCloseTo(expected, 6);
        }
        // The machine's own gears (not a stacked top, not what turns inside a ring) never overlap unless they mesh.
        const free = layout.gears.filter((g) => g.kind !== 'stacked' && g.kind !== 'planet' && g.kind !== 'sun');
        const meshed = (a: Gear, b: Gear) => layout.meshes.some((m) => (m.a === a.id && m.b === b.id) || (m.a === b.id && m.b === a.id));
        for (let i = 0; i < free.length; i += 1) {
          for (let j = i + 1; j < free.length; j += 1) {
            const a = free[i]!;
            const b = free[j]!;
            if (meshed(a, b)) continue;
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.kind} ${a.id} and ${b.kind} ${b.id}`).toBeGreaterThanOrEqual(outerRadius(a, module) + outerRadius(b, module));
          }
        }
      }
    });

    it(`turns each gear at the speed its neighbour rolls it, on ${name}`, () => {
      const layout = layoutGears(width, height, 5);
      for (const mesh of layout.meshes) {
        const a = byId(layout, mesh.a);
        const b = byId(layout, mesh.b);
        if (a.swing !== undefined || b.swing !== undefined) {
          expect((b.swing ?? 0) * outside(b)).toBeCloseTo(-(a.swing ?? 0) * outside(a), 9);
        } else if (mesh.kind === 'outside') {
          expect(b.omega * outside(b)).toBeCloseTo(-a.omega * outside(a), 9);
        } else {
          expect(b.omega * b.teeth).toBeCloseTo(a.omega * a.teeth, 9);
        }
      }
    });
  }

  it('has every kind of gear in it: spurs of several sizes and hubs, a stacked pair, a planetary set and a rack', () => {
    const layout = layoutGears(390, 844, 42);
    const kinds = new Set(layout.gears.map((g) => g.kind));
    for (const kind of ['spur', 'stacked', 'ring', 'planet', 'sun', 'pinion'] as const) expect(kinds, kind).toContain(kind);
    expect(new Set(layout.gears.filter((g) => g.kind === 'spur').map((g) => g.teeth)).size).toBeGreaterThan(2);
    expect(new Set(layout.gears.map((g) => g.hub)).size).toBe(3);
    expect(layout.rack).not.toBeNull();
    expect(layout.gears.filter((g) => g.kind === 'planet')).toHaveLength(3);
  });

  it('draws a gear with a tooth for each tooth, and a ring with both sets', () => {
    expect(spurPath(16, 4, 'plain').match(/ A /g)?.length ?? 0).toBeGreaterThanOrEqual(32);
    const ring = ringPath(42, 54, 4);
    expect(ring.match(/Z/g)).toHaveLength(2);
  });
});
