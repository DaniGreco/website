import { describe, expect, it } from 'vitest';
import { DENSITY, MARGIN, makeField } from './flow.js';

const positions = (f) => Array.from({ length: f.count }, (_, i) => f.strand(i));
const inside = ([x, y], W, H) => x >= 0 && y >= 0 && x <= W && y <= H;
// Strands live up to MARGIN px outside the screen, where they turn around.
const inPlay = ([x, y], W, H) => x >= -MARGIN && y >= -MARGIN && x <= W + MARGIN && y <= H + MARGIN;

describe('the strands of the background', () => {
  it('fill the screen at the start, with their tails already grown', () => {
    const f = makeField();
    f.resize(1000, 740);
    expect(f.count).toBe(Math.round((1000 * 740) / DENSITY));
    const grown = positions(f).filter((s) => s.tail > 1).length;
    expect(grown / f.count).toBeGreaterThan(0.9);
  });

  it('carry on where they were when the screen gets a little shorter', () => {
    const f = makeField();
    f.resize(1000, 740);
    const before = positions(f);
    // A phone's address bar comes back: the screen is shorter, a few strands go.
    f.resize(1000, 700);
    expect(f.count).toBe(Math.round((1000 * 700) / DENSITY));
    const kept = new Map(before.map((s) => [`${s.x},${s.y}`, s]));
    for (const s of positions(f)) {
      const was = kept.get(`${s.x},${s.y}`);
      expect(was).toBeDefined();
      expect(s.tail).toBe(was.tail);
      expect(s.hue).toBe(was.hue);
    }
  });

  it('drop first the strands that are no longer in view', () => {
    const f = makeField();
    f.resize(1000, 740);
    f.resize(1000, 600);
    const out = positions(f).filter((s) => !inPlay([s.x, s.y], 1000, 600));
    expect(out).toEqual([]);
  });

  it('bring the new strands in from just outside an edge when the screen grows', () => {
    const f = makeField();
    f.resize(1000, 700);
    const old = f.count;
    f.resize(1200, 700);
    expect(f.count).toBe(Math.round((1200 * 700) / DENSITY));
    for (const s of positions(f).slice(old)) {
      expect(inside([s.x, s.y], 1200, 700)).toBe(false);
      expect(s.tail).toBe(1);
    }
  });
});
