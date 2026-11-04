// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { scrollsInside } from './wheel.js';

// A box like the demo log: it scrolls, and holds more lines than it shows.
function box({ overflow = 'auto', height = 200, content = 600, top = 0 } = {}) {
  const el = document.createElement('div');
  el.style.overflowY = overflow;
  Object.defineProperty(el, 'clientHeight', { value: height });
  Object.defineProperty(el, 'scrollHeight', { value: content });
  el.scrollTop = top;
  const line = document.createElement('span');
  el.append(line);
  document.body.append(el);
  return { el, line };
}

const UP = -100;
const DOWN = 100;

beforeEach(() => {
  document.body.replaceChildren();
});

describe('a wheel over a box that scrolls', () => {
  it('scrolls the box up while it is not at its top', () => {
    const { line } = box({ top: 120 });
    expect(scrollsInside(line, UP)).toBe(true);
  });

  it('leaves the page to the wheel once the box is at its top', () => {
    const { line } = box({ top: 0 });
    expect(scrollsInside(line, UP)).toBe(false);
  });

  it('scrolls the box down until its end', () => {
    expect(scrollsInside(box({ top: 0 }).line, DOWN)).toBe(true);
    expect(scrollsInside(box({ top: 400 }).line, DOWN)).toBe(false);
  });

  it('ignores boxes that do not scroll or whose content fits', () => {
    expect(scrollsInside(box({ overflow: 'visible', top: 120 }).line, UP)).toBe(false);
    expect(scrollsInside(box({ content: 200, top: 0 }).line, DOWN)).toBe(false);
  });

  it('stops at the given element', () => {
    const { el, line } = box({ top: 120 });
    expect(scrollsInside(line, UP, el)).toBe(false);
  });
});
