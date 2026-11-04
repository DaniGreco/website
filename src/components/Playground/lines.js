// Log lines that depend on the state of the map. Which line to write is chosen here, away from the
// animations in Playground.jsx, so it can be tested. The texts themselves live in strings.js.
import { NODES, SERVICES, behind, quorum } from './model.js';

export const labelsIn = (T, pods) => T.list(pods.map((p) => SERVICES[p.svc].label));

const CONTROL = Object.keys(NODES).filter((id) => NODES[id].role === 'control');

// A server has just been switched off: `s` is the state after it, `on` what was running on it.
export function offLine(T, s, id, on) {
  const node = NODES[id];
  const name = T.nodes[id];
  if (node.role === 'control') {
    const up = CONTROL.filter((c) => s.nodes[c] === 'up').length;
    return quorum(s) ? { text: T.log.cpDown(name, up), tone: 'warn' } : { text: T.log.cpQuorum(name, up), tone: 'alarm' };
  }
  if (node.role === 'worker') return { text: T.log.workerDown(name), tone: 'alarm' };
  // Container fleet and GPU servers: what stops with it, if anything ran there.
  return { text: on.length ? T.log.down(name, labelsIn(T, on)) : T.log.downEmpty(name), tone: 'alarm' };
}

// The end of a release: live only if every pod it updates runs the new version.
export function releaseLine(T, s, ver) {
  const left = behind(s, ver).length;
  return left ? { text: T.log.releaseBehind(ver, left), tone: 'warn' } : { text: T.log.live(ver), tone: 'ok' };
}
