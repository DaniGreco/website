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

describe('the map with a keyboard', () => {
  const key = (el, name) => act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
  const maps = (el) => [...el.querySelectorAll('svg[role="group"]')];

  it('is a single tab stop', () => {
    const el = mount();
    expect(maps(el)).toHaveLength(2);
    for (const svg of maps(el)) expect(svg.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('moves between its parts with the arrow keys', () => {
    const [svg] = maps(mount());
    const first = svg.querySelector('[tabindex="0"]');
    act(() => first.focus());
    key(first, 'ArrowDown');
    const next = document.activeElement;
    expect(next.getAttribute('aria-label')).toBe('You');
    expect(next.getAttribute('tabindex')).toBe('0');
    expect(first.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus into the card opened with Enter, and back when Escape closes it', () => {
    const [svg] = maps(mount());
    const server = svg.querySelector('[data-key="node:w1"]');
    act(() => server.focus());
    key(server, 'Enter');
    const card = document.activeElement.closest('[role="region"]');
    expect(card.getAttribute('aria-label')).toBe('Worker 1');
    expect(card.querySelector('button:not([aria-label])').textContent).toContain('Switch off');
    key(document.activeElement, 'Escape');
    expect(document.activeElement.getAttribute('data-key')).toBe('node:w1');
  });
});
