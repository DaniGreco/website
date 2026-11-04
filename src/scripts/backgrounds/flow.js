// Thin strands following an invisible current: particles move along a noise flow field.
// Each particle remembers a point every few pixels it travels (not every frame), so a long
// tail costs few segments, and the tail fades to nothing. The canvas is cleared every frame,
// so trails always disappear instead of piling up.
// The pointer is a black hole: its pull grows with closeness like gravity, strands spiral
// in and circle it, and once it moves on they drift back to the current.
// Strands live for ever: one that leaves the screen comes back in from a random point of an
// edge, just out of sight, so none ever appears or vanishes in view.
// Each strand has its own velocity and only steers towards the current, so nothing snaps.
// When the screen changes size (on phones it does while scrolling, as the address bar hides and
// comes back) the strands carry on: a few are added from an edge or dropped, out of view first.
import { makeNoise } from './noise.js';
import { runCanvas } from './loop.js';

const noise = makeNoise(3);
const TAIL = 40; // points remembered per particle
const STEP = 4; // px travelled between two remembered points
const BANDS = 5; // the tail is drawn in bands, fainter towards its end
const BAND = TAIL / BANDS;
const RGB = ['35, 87, 214', '74, 120, 228', '31, 63, 153'];
const SPEED = 2; // px per frame along the current
const STEER = 0.08; // how quickly a strand turns towards the current
const HOLE = 4000; // pull of the pointer: HOLE / (distance² + SOFT²), in px per frame²
const SOFT = 60; // px: softens the pull near the centre
const SPIN = 0.6; // sideways share of the pull, so strands spiral instead of falling straight
const MAX_SPEED = 6;
export const DENSITY = 3700; // one strand per this many px² (about 350 on a 1440 × 900 screen)
export const MARGIN = 20; // px outside the screen where strands turn around

// The strands, in flat arrays: one entry per strand, or TAIL entries for the remembered points.
const FIELDS = {
  px: [Float32Array, 1], py: [Float32Array, 1], // current position
  vx: [Float32Array, 1], vy: [Float32Array, 1], // current velocity
  xs: [Float32Array, TAIL], ys: [Float32Array, TAIL], // remembered points, ring buffers of TAIL per strand
  head: [Uint16Array, 1], // newest remembered point
  filled: [Uint16Array, 1], // how many remembered points are valid
  pull: [Float32Array, 1], // how strongly the pointer bends each strand, smoothed
  hue: [Uint8Array, 1], // which of the colours
};

export function makeField() {
  let count = 0;
  let warm = false;
  let px = new Float32Array(0);
  let py = new Float32Array(0);
  let vx = new Float32Array(0);
  let vy = new Float32Array(0);
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);
  let head = new Uint16Array(0);
  let filled = new Uint16Array(0);
  let pull = new Float32Array(0);
  let hue = new Uint8Array(0);

  // Anywhere on screen at the start; later only from just outside an edge.
  function spawn(i, W, H, fromEdge) {
    let x = Math.random() * W;
    let y = Math.random() * H;
    if (fromEdge) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) x = -MARGIN / 2;
      else if (side === 1) x = W + MARGIN / 2;
      else if (side === 2) y = -MARGIN / 2;
      else y = H + MARGIN / 2;
    }
    px[i] = x;
    py[i] = y;
    vx[i] = 0;
    vy[i] = 0;
    xs[i * TAIL] = x;
    ys[i * TAIL] = y;
    head[i] = 0;
    filled[i] = 1;
    pull[i] = 0;
    hue[i] = Math.floor(Math.random() * RGB.length);
  }

  // Match the number of strands to the area. The strands there are carry on, those in view first;
  // new ones come in from an edge. Only the first time are tails grown in advance, so the first
  // frames are not a field of dots.
  function resize(W, H) {
    const next = Math.round((W * H) / DENSITY);
    // Strands left outside come back in by themselves as they move (advance).
    if (warm && next === count) return;
    const kept = [];
    const gone = [];
    for (let i = 0; i < count; i++) {
      const out = px[i] < -MARGIN || py[i] < -MARGIN || px[i] > W + MARGIN || py[i] > H + MARGIN;
      (out ? gone : kept).push(i);
    }
    const keep = kept.concat(gone).slice(0, next);
    const old = { px, py, vx, vy, xs, ys, head, filled, pull, hue };
    const made = {};
    // Usually no strand is out, and the ones kept are the first ones: one copy per array.
    const inOrder = keep.every((from, to) => from === to);
    for (const [name, [Type, n]] of Object.entries(FIELDS)) {
      const arr = new Type(next * n);
      if (inOrder) arr.set(old[name].subarray(0, keep.length * n));
      else keep.forEach((from, to) => arr.set(old[name].subarray(from * n, (from + 1) * n), to * n));
      made[name] = arr;
    }
    ({ px, py, vx, vy, xs, ys, head, filled, pull, hue } = made);
    const fromEdge = warm;
    for (let i = keep.length; i < next; i++) spawn(i, W, H, fromEdge);
    count = next;
    if (!warm && count) {
      for (let n = 0; n < TAIL * 3; n++) advance(0, W, H, null);
      warm = true;
    }
  }

  function advance(t, W, H, pointer) {
    const f = 1 / 420;
    const near = pointer && pointer.active > 0.001;
    for (let i = 0; i < count; i++) {
      const x = px[i];
      const y = py[i];
      const angle = noise(x * f, y * f, t * 0.04) * Math.PI * 2;
      // Steer towards the current instead of jumping onto it.
      let ax = (Math.cos(angle) * SPEED - vx[i]) * STEER;
      let ay = (Math.sin(angle) * SPEED - vy[i]) * STEER;
      let k = 0;
      if (near) {
        const dx = pointer.x - x;
        const dy = pointer.y - y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 1;
        const g = (HOLE * pointer.active) / (d2 + SOFT * SOFT);
        ax += (dx / d) * g - (dy / d) * g * SPIN;
        ay += (dy / d) * g + (dx / d) * g * SPIN;
        k = Math.min(1, g / 0.25);
      }
      vx[i] += ax;
      vy[i] += ay;
      const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      if (speed > MAX_SPEED) {
        vx[i] *= MAX_SPEED / speed;
        vy[i] *= MAX_SPEED / speed;
      }
      pull[i] += (k - pull[i]) * 0.15;
      const nx = x + vx[i];
      const ny = y + vy[i];
      if (nx < -MARGIN || ny < -MARGIN || nx > W + MARGIN || ny > H + MARGIN) {
        spawn(i, W, H, true);
        continue;
      }
      px[i] = nx;
      py[i] = ny;
      const o = i * TAIL;
      const lx = nx - xs[o + head[i]];
      const ly = ny - ys[o + head[i]];
      if (lx * lx + ly * ly >= STEP * STEP) {
        head[i] = (head[i] + 1) % TAIL;
        xs[o + head[i]] = nx;
        ys[o + head[i]] = ny;
        if (filled[i] < TAIL) filled[i] += 1;
      }
    }
  }

  function draw(ctx, W, H) {
    ctx.clearRect(0, 0, W, H);
    // One path per colour, tail band and strength: every separate stroke has a fixed cost,
    // so strands are batched into at most 30 of them.
    const slot = (c, b, s) => (c * BANDS + b) * 2 + s;
    const paths = Array.from({ length: RGB.length * BANDS * 2 }, () => new Path2D());
    const used = new Uint8Array(paths.length);
    for (let i = 0; i < count; i++) {
      const n = filled[i];
      const o = i * TAIL;
      const strong = pull[i] > 0.2 ? 1 : 0;
      const c = hue[i];
      // From the current position back through the remembered points, newest first.
      let p = slot(c, 0, strong);
      let path = paths[p];
      used[p] = 1;
      path.moveTo(px[i], py[i]);
      let idx = head[i];
      path.lineTo(xs[o + idx], ys[o + idx]);
      let band = 0;
      for (let j = 1; j < n; j++) {
        const prev = (idx - 1 + TAIL) % TAIL;
        const b = Math.floor(j / BAND);
        if (b !== band) {
          band = b;
          p = slot(c, band, strong);
          path = paths[p];
          used[p] = 1;
          path.moveTo(xs[o + idx], ys[o + idx]);
        }
        path.lineTo(xs[o + prev], ys[o + prev]);
        idx = prev;
      }
    }
    ctx.lineWidth = 1;
    for (let c = 0; c < RGB.length; c++) {
      for (let b = 0; b < BANDS; b++) {
        const tail = 1 - b / BANDS;
        for (let s = 0; s < 2; s++) {
          const p = slot(c, b, s);
          if (!used[p]) continue;
          ctx.strokeStyle = `rgba(${RGB[c]}, ${((s ? 0.62 : 0.3) * tail).toFixed(3)})`;
          ctx.stroke(paths[p]);
        }
      }
    }
  }

  return {
    resize,
    advance,
    draw,
    get count() {
      return count;
    },
    // One strand, for tests.
    strand: (i) => ({ x: px[i], y: py[i], tail: filled[i], hue: hue[i] }),
  };
}

// `watch`: the screens the background is meant for (see loop.js).
export function start(canvas, watch) {
  const field = makeField();
  runCanvas(canvas, {
    fps: 60,
    // Drawn at 1 canvas pixel per CSS pixel: on high-density screens a full-resolution canvas
    // is four times the work for the GPU, and thin moving strands look the same.
    maxDpr: 1,
    watch,
    setup(ctx, W, H) {
      field.resize(W, H);
    },
    frame(ctx, t, W, H, dpr, still, pointer) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      field.advance(still ? 20 : t, W, H, still ? null : pointer);
      field.draw(ctx, W, H);
    },
  });
}
