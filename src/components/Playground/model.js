// What the map shows: a simplified model of the infrastructure, not a copy of it.
// Only structure lives here; every text people read is in strings.js.

// Class names are written out in full so Tailwind can find them.
export const KIND = {
  traffic: { stroke: 'stroke-traffic', fill: 'fill-traffic' },
  mesh: { stroke: 'stroke-mesh', fill: 'fill-mesh' },
  data: { stroke: 'stroke-data', fill: 'fill-data' },
  gpu: { stroke: 'stroke-gpu', fill: 'fill-gpu' },
};

export const SERVICES = {
  web: { label: 'web', kind: 'traffic' },
  api: { label: 'api', kind: 'traffic' },
  auth: { label: 'sso', kind: 'mesh' },
  flows: { label: 'flows', kind: 'mesh' },
  logs: { label: 'logs', kind: 'mesh' },
  docdb: { label: 'docdb', kind: 'data' },
  maps: { label: 'maps', kind: 'traffic' },
  jobs: { label: 'jobs', kind: 'mesh' },
  sql: { label: 'sql', kind: 'data' },
  rag: { label: 'rag', kind: 'gpu' },
  index: { label: 'index', kind: 'data' },
  llmXL: { label: 'llm-xl', kind: 'gpu', gpu: 4 },
  llmS: { label: 'llm-s', kind: 'gpu', gpu: 1 },
  embed: { label: 'embed', kind: 'gpu', gpu: 1 },
  rerank: { label: 'rerank', kind: 'gpu', gpu: 1 },
};

export const NODES = {
  s1: { zone: 'paas' },
  s2: { zone: 'paas' },
  s3: { zone: 'paas' },
  cp1: { zone: 'k8s', role: 'control' },
  cp2: { zone: 'k8s', role: 'control' },
  cp3: { zone: 'k8s', role: 'control' },
  w1: { zone: 'k8s', role: 'worker' },
  w2: { zone: 'k8s', role: 'worker' },
  w3: { zone: 'k8s', role: 'worker' },
  w4: { zone: 'k8s', role: 'worker', spare: true },
  w5: { zone: 'k8s', role: 'worker', spare: true },
  ga: { zone: 'onprem' },
  gb: { zone: 'onprem' },
};

export const ZONE_NODES = {
  paas: ['s1', 's2', 's3'],
  k8s: ['cp1', 'cp2', 'cp3', 'w1', 'w2', 'w3', 'w4', 'w5'],
  onprem: ['ga', 'gb'],
};

export const PAAS_SLOTS = 6;
export const WORKER_SLOTS = 5;
export const CPU_SLOTS = 3;
export const GPU_CELLS = 4;

const WORKERS = ZONE_NODES.k8s.filter((id) => NODES[id].role === 'worker');
const CONTROL = ZONE_NODES.k8s.filter((id) => NODES[id].role === 'control');

export function initialState() {
  const s = { seq: 0, nodes: {}, pods: [], log: [], packets: [], release: 1, busy: {}, lastWeb: 'paas' };
  for (const id of Object.keys(NODES)) s.nodes[id] = NODES[id].spare ? 'absent' : 'up';
  const add = (svc, node, extra = {}) => {
    s.seq += 1;
    s.pods.push({ id: `p${s.seq}`, seq: s.seq, svc, zone: NODES[node].zone, node, status: 'run', ver: 1, ...extra });
  };
  add('web', 's1'); add('auth', 's1'); add('flows', 's1'); add('logs', 's1');
  add('api', 's2'); add('docdb', 's2'); add('web', 's2');
  add('docdb', 's3'); add('maps', 's3'); add('api', 's3');

  add('web', 'w1'); add('api', 'w1'); add('jobs', 'w1'); add('sql', 'w1', { role: 'primary' });
  add('web', 'w2'); add('api', 'w2'); add('sql', 'w2', { role: 'replica' });
  add('web', 'w3'); add('api', 'w3'); add('jobs', 'w3');

  add('llmXL', 'ga', { gpu: [0, 0] }); add('embed', 'ga', { gpu: [1, 0] }); add('rerank', 'ga', { gpu: [1, 1] });
  add('rag', 'ga'); add('index', 'ga');
  add('llmS', 'gb', { gpu: [0, 0] }); add('rag', 'gb');
  return s;
}

export const isUp = (s, id) => s.nodes[id] === 'up';
const live = (p) => p.status !== 'stop';
export const podsOn = (s, node) => s.pods.filter((p) => p.node === node && live(p));
export const quorum = (s) => CONTROL.filter((id) => isUp(s, id)).length >= 2;
export const workersUp = (s) => WORKERS.filter((id) => isUp(s, id));
export const nextSpare = (s) => WORKERS.find((id) => s.nodes[id] === 'absent');

// The Kubernetes services a release updates: everything but the database.
export const RELEASED = ['web', 'api', 'jobs'];
const released = (p) => p.zone === 'k8s' && RELEASED.includes(p.svc) && live(p);

// A release starts: pods still waiting for a worker will start from the new image, as with a Deployment.
export function startRelease(s, ver) {
  return { ...s, release: ver, pods: s.pods.map((p) => (released(p) && !p.node ? { ...p, ver } : p)) };
}

// The pods a release has not reached yet.
export const behind = (s, ver) => s.pods.filter((p) => released(p) && p.ver < ver);

// Switching a server off. Container fleet: its apps stop where they are, until someone restores them.
// Kubernetes worker: its pods go back to the queue, and the database replica takes over if the primary
// was there, and the pods will start again from the current release. GPU server: its models go back to
// the queue. `on` is what was running on the server.
export function switchOffNode(s, id) {
  const node = NODES[id];
  const on = podsOn(s, id);
  const nodes = { ...s.nodes, [id]: 'down' };
  const here = (p) => p.node === id && live(p);
  if (node.zone === 'paas') {
    return { s: { ...s, nodes, pods: s.pods.map((p) => (here(p) ? { ...p, status: 'down' } : p)) }, on, promoted: false };
  }
  if (node.role === 'control') return { s: { ...s, nodes }, on, promoted: false };
  if (node.role === 'worker') {
    let pods = s.pods.map((p) => {
      if (!here(p)) return p;
      return { ...p, node: null, status: 'pending', ...(released(p) && { ver: s.release }) };
    });
    const lost = pods.find((p) => p.svc === 'sql' && p.role === 'primary' && p.status === 'pending');
    const replica = pods.find((p) => p.svc === 'sql' && p.role === 'replica' && p.status === 'run');
    const promoted = Boolean(lost && replica);
    if (promoted) {
      pods = pods.map((p) => (p.id === lost.id ? { ...p, role: 'replica' } : p.id === replica.id ? { ...p, role: 'primary' } : p));
    }
    return { s: { ...s, nodes, pods }, on, promoted };
  }
  return { s: { ...s, nodes, pods: s.pods.map((p) => (here(p) ? { ...p, node: null, gpu: null, status: 'pending' } : p)) }, on, promoted: false };
}

// Switching a server back on: what stopped on it starts again. `back` is what restarts.
export function switchOnNode(s, id) {
  const back = podsOn(s, id).filter((p) => p.status === 'down');
  return {
    s: {
      ...s,
      nodes: { ...s.nodes, [id]: 'up' },
      pods: s.pods.map((p) => (p.node === id && p.status === 'down' ? { ...p, status: 'run' } : p)),
    },
    back,
  };
}

export function newPod(s, fields) {
  const seq = s.seq + 1;
  return { s: { ...s, seq }, pod: { id: `p${seq}`, seq, status: 'pending', ver: 1, node: null, ...fields } };
}

// Kubernetes: place pending pods on the worker with the fewest copies of the same service,
// then the fewest pods. The two database pods never share a server.
export function scheduleK8s(s) {
  if (!quorum(s)) return { s, placed: [] };
  const pods = s.pods.map((p) => ({ ...p }));
  const placed = [];
  for (const p of pods) {
    if (p.zone !== 'k8s' || p.node || !live(p)) continue;
    const options = workersUp(s)
      .map((id) => ({ id, on: pods.filter((q) => q.node === id && live(q)) }))
      .filter((o) => o.on.length < WORKER_SLOTS)
      .filter((o) => p.svc !== 'sql' || !o.on.some((q) => q.svc === 'sql'));
    if (!options.length) continue;
    const same = (o) => o.on.filter((q) => q.svc === p.svc).length;
    options.sort((a, b) => same(a) - same(b) || a.on.length - b.on.length);
    p.node = options[0].id;
    p.status = 'start';
    placed.push(p);
  }
  return { s: { ...s, pods }, placed };
}

function usedCells(pods, node, g) {
  const used = new Array(GPU_CELLS).fill(false);
  for (const q of pods) {
    if (q.node !== node || !q.gpu || q.gpu[0] !== g || !live(q)) continue;
    for (let i = 0; i < SERVICES[q.svc].gpu; i++) used[q.gpu[1] + i] = true;
  }
  return used;
}

// GPU servers: biggest models first, each on the GPU with the least free room that still fits it.
export function scheduleOnprem(s) {
  const pods = s.pods.map((p) => ({ ...p }));
  const placed = [];
  const servers = ZONE_NODES.onprem.filter((id) => isUp(s, id));
  const pending = pods
    .filter((p) => p.zone === 'onprem' && !p.node && live(p))
    .sort((a, b) => (SERVICES[b.svc].gpu || 0) - (SERVICES[a.svc].gpu || 0));
  for (const p of pending) {
    const need = SERVICES[p.svc].gpu;
    if (need) {
      let best = null;
      for (const id of servers) {
        for (let g = 0; g < 2; g++) {
          const used = usedCells(pods, id, g);
          let start = -1;
          for (let i = 0; i + need <= GPU_CELLS; i++) if (used.slice(i, i + need).every((u) => !u)) { start = i; break; }
          if (start < 0) continue;
          const free = used.filter((u) => !u).length;
          if (!best || free < best.free) best = { id, g, start, free };
        }
      }
      if (!best) continue;
      p.node = best.id;
      p.gpu = [best.g, best.start];
    } else {
      const options = servers
        .map((id) => ({ id, n: pods.filter((q) => q.node === id && !q.gpu && live(q)).length }))
        .filter((o) => o.n < CPU_SLOTS)
        .sort((a, b) => a.n - b.n);
      if (!options.length) continue;
      p.node = options[0].id;
    }
    p.status = 'start';
    placed.push(p);
  }
  return { s: { ...s, pods }, placed };
}

// Container fleet: apps on a dead server come back from backup on the emptiest live server.
export function restorePaas(s) {
  const pods = s.pods.map((p) => ({ ...p }));
  const placed = [];
  for (const p of pods) {
    if (p.zone !== 'paas' || p.status !== 'down') continue;
    const options = ZONE_NODES.paas
      .filter((id) => isUp(s, id))
      .map((id) => ({ id, n: pods.filter((q) => q.node === id && live(q) && q.status !== 'down').length }))
      .filter((o) => o.n < PAAS_SLOTS)
      .sort((a, b) => a.n - b.n);
    if (!options.length) continue;
    p.node = options[0].id;
    p.status = 'start';
    placed.push(p);
  }
  return { s: { ...s, pods }, placed };
}
