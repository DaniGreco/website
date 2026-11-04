// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The visitor's reduced motion setting, as motion reports it.
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => ({ ...(await importOriginal()), useReducedMotion: () => motion.reduce }));

const { default: Playground } = await import('./Playground.jsx');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= Observer;
globalThis.IntersectionObserver ??= Observer;

let root;
let host;
function mount({ reduce = false } = {}) {
  motion.reduce = reduce;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Playground, { lang: 'en' })));
  return host;
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const autoplayButton = (el) => el.querySelector('button[aria-label="Pause autoplay"], button[aria-label="Start autoplay"]');
const logList = (el) => el.querySelector('section[aria-label="What is happening"] ol');

describe('autoplay', () => {
  it('runs by default, with a button to pause it and the log not read aloud', () => {
    const el = mount();
    expect(autoplayButton(el).getAttribute('aria-label')).toBe('Pause autoplay');
    expect(logList(el).getAttribute('aria-live')).toBe('off');
  });

  it('has no play button with reduced motion, and the log is read aloud', () => {
    const el = mount({ reduce: true });
    expect(autoplayButton(el)).toBe(null);
    expect(logList(el).getAttribute('aria-live')).toBe('polite');
  });
});
