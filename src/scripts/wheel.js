// Whether a wheel turn over `target` should scroll a box inside the page rather than the page:
// true when an element from `target` up to `stop` (excluded) scrolls, and can still move that way.
export function scrollsInside(target, deltaY, stop = document.documentElement) {
  for (let el = target; el && el !== stop; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    const room = el.scrollHeight - el.clientHeight;
    if (room <= 1) continue;
    if (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop < room - 1) return true;
  }
  return false;
}
