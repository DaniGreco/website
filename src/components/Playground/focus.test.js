import { describe, expect, it } from 'vitest';
import { focusOrder, moveFocus } from './focus.js';
import { TALL, WIDE } from './layouts.js';
import { initialState, switchOffNode } from './model.js';

describe('the keyboard order of the map', () => {
  const order = focusOrder(WIDE, initialState());

  it('holds every part of the map once', () => {
    const s = initialState();
    const parts = [
      ...Object.keys(WIDE.zones).map((id) => `zone:${id}`), 'zone:mesh',
      ...Object.keys(WIDE.stations).map((id) => `station:${id}`),
      ...Object.keys(WIDE.tiles).map((id) => `node:${id}`),
      ...s.pods.map((p) => `pod:${p.id}`),
    ];
    expect([...order].sort()).toEqual([...parts].sort());
  });

  it('reads each zone, then its stations, then each server followed by its pods', () => {
    expect(order.slice(0, 6)).toEqual(['zone:edge', 'station:visitor', 'station:dns', 'station:fw', 'station:cache', 'station:tunnel']);
    const w1 = order.indexOf('node:w1');
    expect(order.slice(w1, w1 + 5)).toEqual(['node:w1', 'pod:p11', 'pod:p12', 'pod:p13', 'pod:p14']);
    expect(order.at(-1)).toBe('zone:mesh');
  });

  it('follows the zones in the order each map draws them', () => {
    const zones = (L) => focusOrder(L, initialState()).filter((k) => k.startsWith('zone:'));
    expect(zones(WIDE)).toEqual(['zone:edge', 'zone:site', 'zone:paas', 'zone:k8s', 'zone:onprem', 'zone:offsite', 'zone:mesh']);
    expect(zones(TALL)).toEqual(['zone:edge', 'zone:paas', 'zone:k8s', 'zone:site', 'zone:onprem', 'zone:offsite', 'zone:mesh']);
  });

  it('puts the pods waiting for a worker after the servers of their zone', () => {
    const s = switchOffNode(initialState(), 'w3').s;
    const keys = focusOrder(WIDE, s);
    const after = keys.slice(keys.indexOf('node:w5') + 1, keys.indexOf('zone:onprem'));
    expect(after).toEqual(['pod:p18', 'pod:p19', 'pod:p20']);
  });
});

describe('moving with the arrow keys', () => {
  const order = ['a', 'b', 'c'];

  it('moves forward and back, and stops at the ends', () => {
    expect(moveFocus(order, 'a', 'ArrowRight')).toBe('b');
    expect(moveFocus(order, 'b', 'ArrowDown')).toBe('c');
    expect(moveFocus(order, 'c', 'ArrowDown')).toBe('c');
    expect(moveFocus(order, 'b', 'ArrowLeft')).toBe('a');
    expect(moveFocus(order, 'a', 'ArrowUp')).toBe('a');
  });

  it('jumps to the first and the last part', () => {
    expect(moveFocus(order, 'b', 'Home')).toBe('a');
    expect(moveFocus(order, 'a', 'End')).toBe('c');
  });

  it('ignores the other keys', () => {
    expect(moveFocus(order, 'a', 'Tab')).toBe(null);
  });
});
