// Keyboard access to the map. The whole map is one tab stop; the arrow keys move between its parts
// in reading order: each zone in the order the map draws them, then its stations, then each server
// followed by its pods, then the pods waiting for room. Tab leaves the map.
import { NODES } from './model.js';

// The zone each station sits in, the same on both maps.
const STATION_ZONE = {
  visitor: 'edge', dns: 'edge', fw: 'edge', cache: 'edge', tunnel: 'edge',
  operator: 'site', vpn: 'site',
  backups: 'offsite', registry: 'offsite',
};

// A part of the map, as the selection names it, e.g. `node:w1`.
export const keyOf = (sel) => `${sel.type}:${sel.id}`;

export function focusOrder(L, s) {
  const pods = s.pods.filter((p) => p.status !== 'stop').sort((a, b) => a.seq - b.seq);
  const keys = [];
  for (const zone of Object.keys(L.zones)) {
    keys.push(`zone:${zone}`);
    for (const id of Object.keys(L.stations)) if (STATION_ZONE[id] === zone) keys.push(`station:${id}`);
    for (const id of Object.keys(L.tiles)) {
      if (NODES[id].zone !== zone) continue;
      keys.push(`node:${id}`);
      for (const p of pods) if (p.node === id) keys.push(`pod:${p.id}`);
    }
    for (const p of pods) if (p.zone === zone && !p.node) keys.push(`pod:${p.id}`);
  }
  keys.push('zone:mesh');
  return keys;
}

// Where a key press moves the focus from `key`, or null if the key does not move it.
export function moveFocus(order, key, name) {
  const i = Math.max(0, order.indexOf(key));
  if (name === 'ArrowRight' || name === 'ArrowDown') return order[Math.min(order.length - 1, i + 1)];
  if (name === 'ArrowLeft' || name === 'ArrowUp') return order[Math.max(0, i - 1)];
  if (name === 'Home') return order[0];
  if (name === 'End') return order.at(-1);
  return null;
}
