import { describe, expect, it } from 'vitest';
import {
  CPU_SLOTS, GPU_CELLS, PAAS_SLOTS, SERVICES, WORKER_SLOTS,
  behind, initialState, podsOn, quorum, restorePaas, scheduleK8s, scheduleOnprem, startRelease,
  switchOffNode, switchOnNode,
} from './model.js';

const off = (s, ...ids) => ids.reduce((st, id) => switchOffNode(st, id).s, s);
const on = (s, ...ids) => ids.reduce((st, id) => switchOnNode(st, id).s, s);
const pod = (s, svc, extra = () => true) => s.pods.find((p) => p.svc === svc && extra(p));
const pods = (s, svc) => s.pods.filter((p) => p.svc === svc);
const waiting = (s, zone) => s.pods.filter((p) => p.zone === zone && !p.node);
const usedCells = (s, node, g) => s.pods
  .filter((p) => p.node === node && p.gpu?.[0] === g)
  .reduce((n, p) => n + SERVICES[p.svc].gpu, 0);
const cpuPods = (s, node) => podsOn(s, node).filter((p) => !p.gpu).length;

describe('the starting map', () => {
  it('has the control plane in quorum and every pod running', () => {
    const s = initialState();
    expect(quorum(s)).toBe(true);
    expect(s.pods.every((p) => p.status === 'run' && p.node)).toBe(true);
  });
});

describe('switching a server off and on', () => {
  it('stops the apps of a container fleet server where they are', () => {
    const before = initialState();
    const { s, on: was } = switchOffNode(before, 's1');
    expect(s.nodes.s1).toBe('down');
    expect(was.map((p) => p.svc)).toEqual(['web', 'auth', 'flows', 'logs']);
    expect(podsOn(s, 's1').every((p) => p.status === 'down')).toBe(true);
  });

  it('sends the pods of a Kubernetes worker back to the queue', () => {
    const { s, on: was } = switchOffNode(initialState(), 'w3');
    expect(was).toHaveLength(3);
    expect(podsOn(s, 'w3')).toEqual([]);
    expect(waiting(s, 'k8s').map((p) => p.svc)).toEqual(['web', 'api', 'jobs']);
    expect(waiting(s, 'k8s').every((p) => p.status === 'pending')).toBe(true);
  });

  it('promotes the database replica when the primary goes', () => {
    const { s, promoted } = switchOffNode(initialState(), 'w1');
    expect(promoted).toBe(true);
    expect(pod(s, 'sql', (p) => p.role === 'primary').node).toBe('w2');
    expect(pod(s, 'sql', (p) => p.role === 'replica').node).toBe(null);
  });

  it('does not promote anything when the replica goes', () => {
    const { s, promoted } = switchOffNode(initialState(), 'w2');
    expect(promoted).toBe(false);
    expect(pod(s, 'sql', (p) => p.role === 'primary').node).toBe('w1');
  });

  it('frees the GPUs of a GPU server', () => {
    const { s } = switchOffNode(initialState(), 'ga');
    expect(waiting(s, 'onprem').map((p) => p.svc)).toEqual(['llmXL', 'embed', 'rerank', 'rag', 'index']);
    expect(waiting(s, 'onprem').every((p) => !p.gpu)).toBe(true);
  });

  it('starts again the apps that stopped on a container fleet server', () => {
    const { s, back } = switchOnNode(off(initialState(), 's3'), 's3');
    expect(s.nodes.s3).toBe('up');
    expect(back.map((p) => p.svc)).toEqual(['docdb', 'maps', 'api']);
    expect(podsOn(s, 's3').every((p) => p.status === 'run')).toBe(true);
  });
});

describe('Kubernetes scheduling', () => {
  it('spreads the pods of a dead worker over the others', () => {
    const { s, placed } = scheduleK8s(off(initialState(), 'w3'));
    expect(placed).toHaveLength(3);
    expect(waiting(s, 'k8s')).toEqual([]);
    for (const id of ['w1', 'w2']) expect(podsOn(s, id).length).toBeLessThanOrEqual(WORKER_SLOTS);
  });

  it('never puts the two database pods on the same worker', () => {
    // Worker 1 has room for one more pod, and it is the only worker left.
    const { s } = scheduleK8s(off(initialState(), 'w2', 'w3'));
    const [a, b] = pods(s, 'sql');
    expect(a.node).not.toBe(b.node);
    expect(pod(s, 'sql', (p) => p.role === 'replica').node).toBe(null);
  });

  it('places the database replica on a new worker', () => {
    let s = off(initialState(), 'w2', 'w3');
    s = { ...s, nodes: { ...s.nodes, w4: 'up' } };
    s = scheduleK8s(s).s;
    expect(pod(s, 'sql', (p) => p.role === 'replica').node).toBe('w4');
  });

  it('leaves the pods waiting without quorum', () => {
    const s = off(initialState(), 'cp1', 'cp2', 'w3');
    expect(quorum(s)).toBe(false);
    const res = scheduleK8s(s);
    expect(res.placed).toEqual([]);
    expect(waiting(res.s, 'k8s')).toHaveLength(3);
  });
});

describe('GPU scheduling', () => {
  it('gives llm-xl a whole free GPU', () => {
    const { s } = scheduleOnprem(off(initialState(), 'ga'));
    const xl = pod(s, 'llmXL');
    expect(xl.node).toBe('gb');
    expect(xl.gpu).toEqual([1, 0]);
    expect(usedCells(s, 'gb', 1)).toBe(GPU_CELLS);
  });

  it('fits every model on one server when both were off and one comes back', () => {
    const s = on(off(initialState(), 'ga', 'gb'), 'ga');
    const res = scheduleOnprem(s);
    expect(waiting(res.s, 'onprem')).toEqual([]);
    expect(res.placed).toHaveLength(7);
    expect(usedCells(res.s, 'ga', 0) + usedCells(res.s, 'ga', 1)).toBe(7);
    expect(cpuPods(res.s, 'ga')).toBe(CPU_SLOTS);
    // The second server then comes back empty.
    const back = scheduleOnprem(on(res.s, 'gb'));
    expect(back.placed).toEqual([]);
    expect(podsOn(back.s, 'gb')).toEqual([]);
  });

  it('never puts two models on the same GPU memory', () => {
    const { s } = scheduleOnprem(off(initialState(), 'gb'));
    for (const g of [0, 1]) expect(usedCells(s, 'ga', g)).toBeLessThanOrEqual(GPU_CELLS);
  });
});

describe('restoring the container fleet', () => {
  it('restores the apps of a dead server on the emptiest live servers', () => {
    const { s, placed } = restorePaas(off(initialState(), 's1'));
    expect(placed.map((p) => p.svc)).toEqual(['web', 'auth', 'flows', 'logs']);
    expect(placed.map((p) => p.node)).toEqual(['s2', 's3', 's2', 's3']);
    for (const id of ['s2', 's3']) expect(podsOn(s, id).length).toBeLessThanOrEqual(PAAS_SLOTS);
  });

  it('leaves down the apps that do not fit', () => {
    const { s, placed } = restorePaas(off(initialState(), 's1', 's2'));
    expect(placed).toHaveLength(3);
    expect(podsOn(s, 's3')).toHaveLength(PAAS_SLOTS);
    expect(s.pods.filter((p) => p.zone === 'paas' && p.status === 'down')).toHaveLength(4);
  });
});

describe('releases', () => {
  const versions = (s, filter) => s.pods.filter((p) => p.zone === 'k8s' && p.svc !== 'sql' && filter(p)).map((p) => p.ver);

  it('gives the new version to the pods still waiting when a release starts', () => {
    const s = startRelease(off(initialState(), 'w3'), 2);
    expect(s.release).toBe(2);
    expect(versions(s, (p) => !p.node)).toEqual([2, 2, 2]);
    expect(versions(s, (p) => p.node).every((v) => v === 1)).toBe(true);
    expect(pods(s, 'sql').every((p) => p.ver === 1)).toBe(true);
  });

  it('starts from the current release the pods of a worker that dies during a release', () => {
    const s = off(startRelease(initialState(), 2), 'w1');
    expect(versions(s, (p) => !p.node)).toEqual([2, 2, 2]);
    expect(pod(s, 'sql', (p) => !p.node).ver).toBe(1);
  });

  it('lists the pods a release has not reached yet', () => {
    const s = startRelease(initialState(), 2);
    expect(behind(s, 2)).toHaveLength(8);
    const done = { ...s, pods: s.pods.map((p) => (p.zone === 'k8s' && p.svc !== 'sql' ? { ...p, ver: 2 } : p)) };
    expect(behind(done, 2)).toEqual([]);
  });
});
