// Shared canvas loop for the hero backgrounds: sizing, frame cap, pause when off screen,
// a single still frame when the visitor asks for reduced motion, and a smoothed pointer.
// `watch` are the elements the background is meant for: the loop draws while one of them is in view,
// and pauses on the last frame when none is. A fixed canvas is always on screen, so it cannot tell.
// `setup` runs at the start and on every resize.
// The pointer's `active` goes from 0 to 1 while it moves over the canvas and back to 0
// a couple of seconds after it stops or leaves, so effects fade in and out.

const IDLE_MS = 2500;

export function runCanvas(canvas, { context = '2d', fps = 60, scale = 1, maxDpr = 2, watch = [canvas], setup, frame }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext(context, context === 'webgl' ? { antialias: false } : undefined);
  if (!ctx) return;
  const born = performance.now();
  const pointer = { x: 0, y: 0, active: 0 };
  const raw = { x: 0, y: 0, inside: false, moved: -1e9 };
  let W = 0;
  let H = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let visible = true;
  const inView = new Set(watch);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * scale;
    W = rect.width;
    H = rect.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    setup(ctx, W, H, dpr);
    if (reduce) frame(ctx, 20, W, H, dpr, true, pointer);
  }

  function tick(now) {
    raf = 0;
    if (now - last >= 1000 / fps - 2) {
      last = now;
      const target = raw.inside && now - raw.moved < IDLE_MS ? 1 : 0;
      if (pointer.active < 0.01) {
        pointer.x = raw.x;
        pointer.y = raw.y;
      }
      pointer.x += (raw.x - pointer.x) * 0.2;
      pointer.y += (raw.y - pointer.y) * 0.2;
      pointer.active += (target - pointer.active) * (target ? 0.12 : 0.04);
      frame(ctx, (now - born) / 1000, W, H, dpr, false, pointer);
    }
    schedule();
  }

  function schedule() {
    if (!reduce && !raf && visible) raf = requestAnimationFrame(tick);
  }

  resize();
  schedule();
  if (!reduce) {
    window.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      raw.x = e.clientX - rect.left;
      raw.y = e.clientY - rect.top;
      raw.inside = raw.x >= 0 && raw.y >= 0 && raw.x <= rect.width && raw.y <= rect.height;
      raw.moved = performance.now();
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
      raw.inside = false;
    });
  }
  new ResizeObserver(() => {
    resize();
    schedule();
  }).observe(canvas);
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) inView.add(entry.target);
      else inView.delete(entry.target);
    }
    visible = inView.size > 0;
    schedule();
  });
  for (const el of watch) io.observe(el);
}
