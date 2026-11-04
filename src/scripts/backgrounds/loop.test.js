// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { runCanvas } from './loop.js';

let frames;
let observers;
beforeEach(() => {
  frames = [];
  observers = [];
  window.matchMedia = () => ({ matches: false });
  window.requestAnimationFrame = (cb) => frames.push(cb);
  window.ResizeObserver = class { observe() {} };
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    observe(el) { this.targets.push(el); }
  };
});

function start(watch) {
  const canvas = document.createElement('canvas');
  canvas.getContext = () => ({});
  runCanvas(canvas, { watch, setup() {}, frame() {} });
  return canvas;
}
const nextFrame = () => frames.shift()(performance.now() + 1000);

describe('the background loop', () => {
  it('watches the screens it is shown on, not the canvas, which is always on screen', () => {
    const top = document.createElement('section');
    const demo = document.createElement('section');
    start([top, demo]);
    expect(observers.flatMap((o) => o.targets)).toEqual([top, demo]);
  });

  it('pauses while none of those screens is in view, and starts again when one comes back', () => {
    const top = document.createElement('section');
    const demo = document.createElement('section');
    start([top, demo]);
    const [io] = observers;
    io.cb([{ target: demo, isIntersecting: false }, { target: top, isIntersecting: true }]);
    nextFrame();
    expect(frames).toHaveLength(1);
    // Scrolling from the first screen to the demo: one of the two is always in view.
    io.cb([{ target: demo, isIntersecting: true }]);
    io.cb([{ target: top, isIntersecting: false }]);
    nextFrame();
    expect(frames).toHaveLength(1);
    // On to Experience: the last frame stays, and nothing more is drawn.
    io.cb([{ target: demo, isIntersecting: false }]);
    nextFrame();
    expect(frames).toHaveLength(0);
    io.cb([{ target: demo, isIntersecting: true }]);
    expect(frames).toHaveLength(1);
  });
});
