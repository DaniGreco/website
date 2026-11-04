import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  KIND, NODES, RELEASED, SERVICES, ZONE_NODES,
  initialState, isUp, newPod, nextSpare, podsOn, quorum, restorePaas, scheduleK8s, scheduleOnprem,
  startRelease, switchOffNode, switchOnNode, workersUp,
} from './model.js';
import { TALL, WIDE } from './layouts.js';
import { STRINGS } from './strings.js';
import { labelsIn, offLine, releaseLine } from './lines.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOG_LINES = 30;
const INITIAL_SEQ = initialState().seq;

// Groups that heal themselves: after 5 seconds with at least `min` machines off, one comes back.
// Their log lines live in strings.js, under `repair`.
// Kubernetes workers come back even alone, like a managed cluster's node auto-repair.
const REPAIR = {
  workers: { ids: ['w1', 'w2', 'w3', 'w4', 'w5'], min: 1 },
  control: { ids: ['cp1', 'cp2', 'cp3'], min: 2 },
  paas: { ids: ZONE_NODES.paas, min: 2 },
  onprem: { ids: ZONE_NODES.onprem, min: 2 },
};

// ---------- geometry ----------

function podBoxes(L, s) {
  const out = new Map();
  const byNode = {};
  // Stopping pods get no box: they fade out where they were while the others close the gap.
  for (const p of s.pods) if (p.node && !p.gpu && p.status !== 'stop') (byNode[p.node] ||= []).push(p);
  for (const [node, list] of Object.entries(byNode)) {
    const t = L.tiles[node];
    const zone = NODES[node].zone;
    const c = zone === 'onprem' ? L.slots.cpu : L.slots[zone];
    list.sort((a, b) => a.seq - b.seq).forEach((p, i) => {
      const col = i % c.cols;
      const row = Math.floor(i / c.cols);
      out.set(p.id, { x: t.x + c.left + col * (c.w + c.gx), y: t.y + c.top + row * (c.h + c.gy), w: c.w, h: c.h });
    });
  }
  for (const p of s.pods) {
    if (!p.node || !p.gpu || p.status === 'stop') continue;
    const t = L.tiles[p.node];
    const [g, start] = p.gpu;
    const n = SERVICES[p.svc].gpu;
    out.set(p.id, { x: t.x + L.gpu.left + start * L.gpu.cellW + 2, y: t.y + L.gpu.rows[g] + 2, w: n * L.gpu.cellW - 4, h: L.gpu.cellH - 4 });
  }
  for (const zone of ['k8s', 'onprem']) {
    const tray = L.pending[zone];
    let x = tray.x;
    let y = tray.y;
    const waiting = s.pods.filter((p) => p.zone === zone && !p.node).sort((a, b) => a.seq - b.seq);
    for (const p of waiting) {
      const n = SERVICES[p.svc].gpu;
      const slot = zone === 'k8s' ? L.slots.k8s : L.slots.cpu;
      const w = n ? n * L.gpu.cellW - 4 : slot.w;
      const h = n ? L.gpu.cellH - 4 : slot.h;
      if (x + w > tray.x + tray.maxW) { x = tray.x; y += h + 4; }
      out.set(p.id, { x, y, w, h });
      x += w + 4;
    }
  }
  return out;
}

function hopPoints(L, hop, boxes) {
  if (hop.pt) return [L.stations[hop.pt].at];
  if (hop.path) return hop.reverse ? [...L.paths[hop.path]].reverse() : L.paths[hop.path];
  const b = boxes.get(hop.pod);
  return b ? [[b.x + b.w / 2, b.y + b.h / 2]] : [];
}

const pointsAttr = (pts) => pts.map((p) => p.join(',')).join(' ');

// ---------- map ----------

const ZONE_FILL = {
  edge: 'fill-traffic/[0.06] stroke-traffic/20',
  paas: 'fill-ink/[0.035] stroke-ink/10',
  k8s: 'fill-ink/[0.035] stroke-ink/10',
  onprem: 'fill-gpu/[0.07] stroke-gpu/20',
  site: 'fill-gpu/[0.04] stroke-gpu/15',
  offsite: 'fill-data/[0.09] stroke-data/25',
};

const ROUTE_CLASS = {
  traffic: 'stroke-traffic',
  gpu: 'stroke-gpu',
  data: 'stroke-data',
  ink: 'stroke-ink/35',
};

function press(fn) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    },
  };
}

function Packet({ L, packet, boxes, reduce }) {
  const keyframes = useMemo(() => {
    const prevHop = packet.hops[Math.max(0, packet.step - 1)];
    const prev = hopPoints(L, prevHop, boxes);
    const from = packet.step === 0 ? prev[0] : prev[prev.length - 1];
    const seq = [from, ...hopPoints(L, packet.hops[packet.step], boxes)].filter(Boolean);
    const lengths = seq.map((p, i) => (i ? Math.hypot(p[0] - seq[i - 1][0], p[1] - seq[i - 1][1]) : 0));
    const total = lengths.reduce((a, b) => a + b, 0);
    let run = 0;
    const times = lengths.map((d, i) => {
      run += d;
      return total ? run / total : i / Math.max(1, seq.length - 1);
    });
    return { seq, times };
    // Points are computed when a hop starts; later moves of a pod do not bend a packet already flying.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packet.id, packet.step, L.id]);

  const { seq, times } = keyframes;
  if (!seq.length) return null;
  const color = packet.kind === 'ink' ? 'fill-ink' : KIND[packet.kind].fill;
  return (
    <motion.circle
      r={7}
      className={`${color} stroke-white`}
      strokeWidth={3}
      initial={{ cx: seq[0][0], cy: seq[0][1] }}
      animate={{ cx: seq.map((p) => p[0]), cy: seq.map((p) => p[1]) }}
      transition={{ duration: reduce ? 0 : packet.dur / 1000, times: seq.length > 1 ? times : undefined, ease: 'linear' }}
    />
  );
}

function Pod({ T, fs, pod, box, reduce, selected, onSelect }) {
  const svc = SERVICES[pod.svc];
  const kind = KIND[svc.kind];
  const solid = Boolean(svc.gpu);
  const dashed = pod.status === 'pending' || pod.status === 'start';
  const down = pod.status === 'down';
  let rect = solid ? `${kind.fill} ${kind.stroke}` : `fill-white ${kind.stroke}`;
  let text = solid ? 'fill-white' : kind.fill;
  if (dashed) { rect = `fill-white ${kind.stroke}`; text = kind.fill; }
  if (down) { rect = 'fill-alarm/10 stroke-alarm'; text = 'fill-alarm'; }
  if (pod.status === 'pending') text = 'fill-muted';
  const tag = pod.zone === 'k8s' ? (pod.svc === 'sql' ? (pod.role === 'primary' ? 'P' : 'R') : `v${pod.ver}`) : null;
  const anim = { x: box.x, y: box.y, opacity: pod.status === 'stop' ? 0 : 1 };
  const size = box.w < 44 ? fs.podSmall : fs.pod;
  return (
    <motion.g
      initial={pod.seq > INITIAL_SEQ ? { ...anim, opacity: 0 } : false}
      animate={anim}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.6, ease: [0.3, 0, 0.2, 1] }}
      className="hit cursor-pointer"
      aria-label={`${T.services[pod.svc].name}${pod.status === 'down' ? T.ui.podStopped : pod.status === 'pending' ? T.ui.podWaiting : ''}`}
      {...press(() => onSelect({ type: 'pod', id: pod.id }))}
    >
      <rect
        width={box.w}
        height={box.h}
        rx={Math.min(box.h / 2, 8)}
        className={rect}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={dashed ? '4 3' : undefined}
      />
      <text
        x={tag ? 7 : box.w / 2}
        y={box.h / 2 + size * 0.36}
        textAnchor={tag ? 'start' : 'middle'}
        className={`${text} font-bold`}
        style={{ fontSize: size, textDecoration: down ? 'line-through' : undefined }}
      >
        {svc.label}
      </text>
      {tag && (
        <text x={box.w - 6} y={box.h / 2 + fs.tag * 0.39} textAnchor="end" className={`${text} font-semibold`} style={{ fontSize: fs.tag }}>
          {tag}
        </text>
      )}
      <rect className="focus-ring" x={-3} y={-3} width={box.w + 6} height={box.h + 6} rx={10} />
    </motion.g>
  );
}

function Tile({ T, fs, id, t, s, selected, onSelect }) {
  const node = NODES[id];
  const status = s.nodes[id];
  const sel = selected?.type === 'node' && selected.id === id;
  const pick = () => onSelect({ type: 'node', id });
  if (status === 'absent' || status === 'creating') {
    const creating = status === 'creating';
    return (
      <g className="hit cursor-pointer" aria-label={creating ? T.ui.tileCreating(T.nodes[id]) : T.ui.tileFree} {...press(pick)}>
        <rect
          x={t.x} y={t.y} width={t.w} height={t.h} rx={10}
          className={creating ? 'fill-traffic/[0.06] stroke-traffic creating' : 'fill-transparent stroke-ink/25'}
          strokeWidth={sel ? 2.5 : 1.5}
          strokeDasharray="5 4"
        />
        <text x={t.x + t.w / 2} y={t.y + t.h / 2 - 2} textAnchor="middle" className="fill-muted font-light" style={{ fontSize: fs.plus }}>
          {creating ? '' : '+'}
        </text>
        <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 16} textAnchor="middle" className="fill-muted font-semibold" style={{ fontSize: fs.slot }}>
          {creating ? T.ui.creating : T.ui.freeSlot}
        </text>
        <rect className="focus-ring" x={t.x - 3} y={t.y - 3} width={t.w + 6} height={t.h + 6} rx={13} />
      </g>
    );
  }
  const up = status === 'up';
  const small = node.role === 'control';
  return (
    <g className="hit cursor-pointer" aria-label={T.ui.tileState(T.nodes[id], up)} {...press(pick)}>
      <rect
        x={t.x} y={t.y} width={t.w} height={t.h} rx={small ? 8 : 10}
        className={up ? `fill-white ${sel ? 'stroke-traffic' : 'stroke-ink/15'}` : 'fill-alarm/[0.07] stroke-alarm'}
        strokeWidth={sel ? 2.5 : 1.25}
      />
      <text x={t.x + 9} y={(small ? t.y + t.h / 2 : t.y + 14) + fs.tile * 0.36} className={`${up ? 'fill-ink' : 'fill-alarm'} font-bold`} style={{ fontSize: fs.tile }}>
        {T.nodes[id]}
      </text>
      {t.w >= 76 && <circle cx={t.x + t.w - 11} cy={small ? t.y + t.h / 2 : t.y + 14} r={4} className={up ? 'fill-mesh' : 'fill-alarm'} />}
      {!up && !small && (
        <text x={t.x + t.w / 2} y={t.y + t.h / 2 + fs.off * 0.4} textAnchor="middle" className="fill-alarm font-extrabold" style={{ fontSize: fs.off }}>
          {T.ui.off}
        </text>
      )}
      <rect className="focus-ring" x={t.x - 3} y={t.y - 3} width={t.w + 6} height={t.h + 6} rx={13} />
    </g>
  );
}

function GpuRows({ L, t }) {
  return L.gpu.rows.map((top, g) => (
    <g key={g} aria-hidden="true">
      <text
        x={t.x + (L.gpu.labelAbove ? L.gpu.left : 10)}
        y={L.gpu.labelAbove ? t.y + top - 4 : t.y + top + L.gpu.cellH / 2 + L.text.gpu * 0.4}
        className="fill-muted font-semibold"
        style={{ fontSize: L.text.gpu }}
      >
        GPU {g + 1}
      </text>
      {[0, 1, 2, 3].map((c) => (
        <rect
          key={c}
          x={t.x + L.gpu.left + c * L.gpu.cellW}
          y={t.y + top}
          width={L.gpu.cellW}
          height={L.gpu.cellH}
          className="fill-paper stroke-ink/10"
        />
      ))}
    </g>
  ));
}

function MapSvg({ T, L, s, reduce, selected, onSelect }) {
  const boxes = podBoxes(L, s);
  const zoneSel = (id) => selected?.type === 'zone' && selected.id === id;
  return (
    <svg viewBox={`0 0 ${L.width} ${L.height}`} className="block h-auto w-full select-none font-sans" role="group" aria-label={T.ui.mapLabel}>
      <rect width={L.width} height={L.height} className="fill-transparent" onClick={() => onSelect(null)} aria-hidden="true" />
      {Object.entries(L.zones).map(([id, z]) => (
        <g key={id} className="hit cursor-pointer" aria-label={T.zones[id].name} {...press(() => onSelect({ type: 'zone', id }))}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={18} className={ZONE_FILL[id]} strokeWidth={zoneSel(id) ? 2.5 : 1} />
          <text x={z.x + 16} y={z.y + 15 + L.text.zone * 0.72} className="fill-ink font-extrabold" style={{ fontSize: L.text.zone }}>
            {T.zones[id].name}
            {L.subtitles && T.zones[id].note && (
              <tspan dx={10} className="fill-muted font-medium" style={{ fontSize: L.text.note }}>{T.zones[id].note}</tspan>
            )}
          </text>
          <rect className="focus-ring" x={z.x - 3} y={z.y - 3} width={z.w + 6} height={z.h + 6} rx={21} />
        </g>
      ))}

      <g className="hit cursor-pointer" aria-label={T.zones.mesh.name} {...press(() => onSelect({ type: 'zone', id: 'mesh' }))}>
        {L.mesh.map((pts, i) => (
          <g key={i}>
            <polyline points={pointsAttr(pts)} className="fill-none stroke-transparent" strokeWidth={14} />
            <polyline points={pointsAttr(pts)} className="fill-none stroke-mesh" strokeWidth={3} strokeDasharray="1 7" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {L.routes.map((r, i) => (
        <polyline
          key={i}
          points={pointsAttr(r.points)}
          className={`fill-none ${ROUTE_CLASS[r.kind]}`}
          strokeWidth={r.kind === 'data' ? 4 : r.kind === 'ink' ? 2 : 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        />
      ))}

      {Object.entries(L.stations).map(([id, st]) => {
        const [x, y] = st.at;
        const [lx, ly, anchor] = st.label;
        const sel = selected?.type === 'station' && selected.id === id;
        return (
          <g key={id} className="hit cursor-pointer" aria-label={T.stations[id].name} {...press(() => onSelect({ type: 'station', id }))}>
            <circle cx={x} cy={y} r={st.big ? 10 : 7} className={st.big ? 'fill-ink stroke-white' : `fill-white ${sel ? 'stroke-traffic' : 'stroke-ink'}`} strokeWidth={st.big ? 3 : 3} />
            <text x={lx} y={ly} textAnchor={anchor} className="fill-ink font-semibold" style={{ fontSize: L.text.station }}>
              {T.stations[id].name}
            </text>
            <circle className="focus-ring" cx={x} cy={y} r={14} />
          </g>
        );
      })}

      {Object.entries(L.tiles).map(([id, t]) => (
        <g key={id}>
          <Tile T={T} fs={L.text} id={id} t={t} s={s} selected={selected} onSelect={onSelect} />
          {NODES[id].zone === 'onprem' && <GpuRows L={L} t={t} />}
        </g>
      ))}

      <AnimatePresence>
        {s.pods.map((p) => {
          const box = boxes.get(p.id);
          if (!box) return null;
          return (
            <Pod key={p.id} T={T} fs={L.text} pod={p} box={box} reduce={reduce} selected={selected?.type === 'pod' && selected.id === p.id} onSelect={onSelect} />
          );
        })}
      </AnimatePresence>

      {s.packets.map((p) => (
        <Packet key={p.id} L={L} packet={p} boxes={boxes} reduce={reduce} />
      ))}
    </svg>
  );
}

// ---------- detail card ----------

function anchorOf(L, s, sel) {
  if (sel.type === 'zone') {
    if (sel.id === 'mesh') {
      const [[x1, y1], [x2]] = L.mesh[0];
      return { x: (x1 + x2) / 2 - 10, y: y1 + 50, w: 20, h: 20 };
    }
    const z = L.zones[sel.id];
    return { x: z.x, y: z.y, w: z.w, h: 36 };
  }
  if (sel.type === 'station') {
    const [x, y] = L.stations[sel.id].at;
    return { x: x - 12, y: y - 12, w: 24, h: 24 };
  }
  if (sel.type === 'node') return L.tiles[sel.id];
  if (sel.type === 'pod') return podBoxes(L, s).get(sel.id) || null;
  return null;
}

// The card opens next to what was clicked: below it in the top half of the map, above it in the bottom half.
function DetailCard({ T, L, a, info, onClose, actions, addDisabled }) {
  const cx = ((a.x + a.w / 2) / L.width) * 100;
  const below = a.y + a.h / 2 < L.height / 2;
  const style = {
    left: `clamp(8px, calc(${cx}% - 150px), calc(100% - 308px))`,
    ...(below
      ? { top: `calc(${((a.y + a.h) / L.height) * 100}% + 10px)` }
      : { bottom: `calc(${100 - (a.y / L.height) * 100}% + 10px)` }),
  };
  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={info.title}
      style={style}
      className="absolute z-20 w-[300px] max-w-[calc(100%-16px)] rounded-[18px] border border-ink/10 bg-white p-4 shadow-[0_18px_40px_-18px_rgba(20,24,46,0.45)]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[17px] leading-tight font-extrabold">{info.title}</h3>
        <button type="button" onClick={onClose} aria-label={T.ui.close} className="-mt-1 -mr-1 size-7 shrink-0 rounded-full text-[20px] leading-none text-muted hover:bg-paper hover:text-ink">
          ×
        </button>
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink/80">{info.body}</p>
      {info.status && <p className="mt-1.5 text-[14px] leading-relaxed font-semibold">{info.status}</p>}
      {info.action === 'off' && <div className="mt-3"><Action dot="text-alarm" onClick={actions.off}>{T.ui.switchOff}</Action></div>}
      {info.action === 'on' && <div className="mt-3"><Action dot="text-mesh" onClick={actions.on}>{T.ui.switchOn}</Action></div>}
      {info.action === 'add' && (
        <div className="mt-3"><Action dot="text-mesh" onClick={actions.add} disabled={addDisabled}>{T.ui.addServer}</Action></div>
      )}
    </div>
  );
}

function MapBox({ T, L, s, reduce, selected, onSelect, info, actions, addDisabled }) {
  const a = selected && info ? anchorOf(L, s, selected) : null;
  return (
    <div className="relative">
      <MapSvg T={T} L={L} s={s} reduce={reduce} selected={selected} onSelect={onSelect} />
      {a && <DetailCard T={T} L={L} a={a} info={info} onClose={() => onSelect(null)} actions={actions} addDisabled={addDisabled} />}
    </div>
  );
}

// ---------- side panels ----------

function describe(sel, s, T) {
  if (!sel) return null;
  const D = T.describe;
  if (sel.type === 'station') return { title: T.stations[sel.id].name, body: T.stations[sel.id].about };
  if (sel.type === 'zone') {
    const z = T.zones[sel.id];
    let status = '';
    const zonePods = (zone) => s.pods.filter((p) => p.zone === zone && p.status !== 'stop');
    if (sel.id === 'paas') {
      const up = ZONE_NODES.paas.filter((id) => isUp(s, id)).length;
      const down = zonePods('paas').filter((p) => p.status === 'down').length;
      status = D.paas(up, zonePods('paas').length - down, down);
    }
    if (sel.id === 'k8s') {
      const cp = ['cp1', 'cp2', 'cp3'].filter((id) => isUp(s, id)).length;
      const waiting = zonePods('k8s').filter((p) => !p.node).length;
      status = D.k8s(cp, workersUp(s).length, zonePods('k8s').length - waiting, waiting);
    }
    if (sel.id === 'onprem') status = D.onprem(ZONE_NODES.onprem.filter((id) => isUp(s, id)).length);
    return { title: z.name, body: z.about, status };
  }
  if (sel.type === 'node') {
    const node = NODES[sel.id];
    const state = s.nodes[sel.id];
    const about = D.nodeAbout[node.role || node.zone];
    if (state === 'absent') return { title: D.freeTitle, body: D.freeBody, action: 'add' };
    if (state === 'creating') return { title: T.nodes[sel.id], body: about, status: D.creating };
    const on = podsOn(s, sel.id);
    const runs = on.length ? D.runs(labelsIn(T, on)) : D.nothing;
    return {
      title: T.nodes[sel.id],
      body: about,
      status: state === 'up' ? (node.role === 'control' ? D.running : `${D.running} ${runs}`) : D.switchedOff,
      action: state === 'up' ? 'off' : 'on',
      node: sel.id,
    };
  }
  if (sel.type === 'pod') {
    const p = s.pods.find((q) => q.id === sel.id);
    if (!p) return null;
    const svc = T.services[p.svc];
    let where = p.node ? D.podOn(T.nodes[p.node]) : D.podWaiting;
    if (p.status === 'down') where = D.podStopped(T.nodes[p.node]);
    if (p.zone === 'k8s' && p.svc !== 'sql') where += D.version(p.ver);
    if (p.svc === 'sql') where += p.role === 'primary' ? D.primary : D.replica;
    return { title: svc.name, body: svc.about, status: where };
  }
  return null;
}

const TONE = {
  info: 'bg-white/40',
  ok: 'bg-mesh',
  warn: 'bg-data',
  alarm: 'bg-alarm',
};

// The dot of an event button lights up each time that event fires; `fired` counts the firings,
// and a new count remounts the dot so its light-up animation plays again.
function Dot({ color, fired }) {
  return <span aria-hidden="true" className={`event-dot ${color} ${fired ? 'fire' : ''}`} />;
}

function Action({ dot, fired = 0, children, ...props }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3.5 py-1.5 text-[14px] font-semibold text-ink transition-colors hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-40 md:gap-2.5 md:px-4 md:py-2 md:text-[15px]"
      {...props}
    >
      <Dot key={fired} color={dot} fired={fired} />
      {children}
    </button>
  );
}

// ---------- the playground ----------

export default function Playground({ lang = 'en' }) {
  const T = STRINGS[lang] || STRINGS.en;
  const msg = T.log;
  const labels = (pods) => labelsIn(T, pods);
  const nodeNames = (ids) => T.list(ids.map((id) => T.nodes[id]));
  const nodeName = (id) => T.nodes[id];
  const sim = useRef(null);
  if (!sim.current) sim.current = initialState();
  const [, render] = useReducer((n) => n + 1, 0);
  const [selected, setSelected] = useState(null);
  const gen = useRef(0);
  const ids = useRef(0);
  const started = useRef(0);
  const logRef = useRef(null);
  const repairs = useRef({});
  const reduce = useReducedMotion();
  const speed = reduce ? 0.3 : 1;

  useEffect(() => {
    started.current = Date.now();
    return () => { gen.current += 1; };
  }, []);

  const s = sim.current;
  const commit = (next) => { sim.current = next; render(); };
  const update = (fn) => commit(fn(sim.current));
  const wait = (ms) => sleep(ms * speed);
  const log = (text, tone = 'info') => {
    ids.current += 1;
    const t = Math.max(0, Math.round((Date.now() - started.current) / 1000));
    // The log keeps the newest LOG_LINES lines: the oldest go as new ones arrive.
    update((st) => ({ ...st, log: [...st.log.slice(-(LOG_LINES - 1)), { id: ids.current, t, text, tone }] }));
  };
  const setPods = (fn) => update((st) => ({ ...st, pods: fn(st.pods) }));
  const markRunning = (placed) => {
    const set = new Set(placed.map((p) => p.id));
    setPods((pods) => pods.map((p) => (set.has(p.id) && p.status === 'start' ? { ...p, status: 'run' } : p)));
  };
  const setBusy = (key, value) => update((st) => ({ ...st, busy: { ...st.busy, [key]: value } }));

  function begin() {
    const g = gen.current;
    return () => g === gen.current;
  }

  // A packet travels hop by hop; each hop can write a line in the log when it arrives.
  function packet(kind, start, alive) {
    ids.current += 1;
    const id = `k${ids.current}`;
    update((st) => ({ ...st, packets: [...st.packets, { id, kind, hops: [start], step: 0, dur: 0 }] }));
    return {
      async hop(h, ms, text, tone) {
        if (!alive()) return false;
        update((st) => ({
          ...st,
          packets: st.packets.map((p) => (p.id === id ? { ...p, hops: [...p.hops, h], step: p.hops.length, dur: ms * speed } : p)),
        }));
        await wait(ms);
        if (!alive()) return false;
        if (text) log(text, tone);
        return true;
      },
      done() {
        update((st) => ({ ...st, packets: st.packets.filter((p) => p.id !== id) }));
      },
    };
  }

  const running = (svc, filter = () => true) =>
    sim.current.pods.filter((p) => p.svc === svc && p.status === 'run' && p.node && isUp(sim.current, p.node) && filter(p));
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

  async function openPage() {
    const alive = begin();
    const fleet = sim.current.lastWeb === 'paas' ? 'k8s' : 'paas';
    update((st) => ({ ...st, lastWeb: fleet }));
    const path = fleet === 'k8s' ? 'edgeK8s' : 'edgePaas';
    const k = packet('traffic', { pt: 'visitor' }, alive);
    const ms = 40 + Math.round(Math.random() * 60);
    try {
      if (!(await k.hop({ pt: 'dns' }, 450, msg.dns))) return;
      if (!(await k.hop({ pt: 'fw' }, 380, msg.fw))) return;
      if (!(await k.hop({ pt: 'cache' }, 380, msg.cache))) return;
      if (!(await k.hop({ pt: 'tunnel' }, 380, msg.tunnel))) return;
      if (!(await k.hop({ path }, 450))) return;
      const web = pickOne(running('web', (p) => p.zone === fleet));
      if (!web) {
        log(msg.noWeb(fleet), 'alarm');
      } else {
        const where = nodeName(web.node);
        const first = fleet === 'k8s'
          ? msg.ingress(where)
          : msg.proxy(where);
        if (!(await k.hop({ pod: web.id }, 420, first))) return;
        if (fleet === 'k8s') {
          const api = pickOne(running('api', (p) => p.zone === 'k8s'));
          if (api && !(await k.hop({ pod: api.id }, 360, msg.webApi(nodeName(api.node))))) return;
          const db = running('sql', (p) => p.role === 'primary')[0];
          if (api && db) {
            if (!(await k.hop({ pod: db.id }, 360, msg.apiDb(nodeName(db.node))))) return;
            if (!(await k.hop({ pod: api.id }, 260))) return;
          } else if (api) {
            log(msg.dbMoving, 'warn');
          }
        } else {
          const shards = running('docdb', (p) => p.zone === 'paas');
          const missing = sim.current.pods.filter((p) => p.svc === 'docdb' && p.status !== 'run').length;
          for (const shard of shards) {
            if (!(await k.hop({ pod: shard.id }, 340, msg.shard(nodeName(shard.node))))) return;
          }
          if (missing) log(msg.shardDown, 'warn');
        }
        if (!(await k.hop({ pod: web.id }, 260))) return;
      }
      if (!(await k.hop({ path, reverse: true }, 380))) return;
      if (!(await k.hop({ pt: 'visitor' }, 650, web ? msg.pageDone(ms) : null, 'ok'))) return;
    } finally {
      k.done();
    }
  }

  async function askAssistant() {
    const alive = begin();
    const k = packet('gpu', { pt: 'operator' }, alive);
    try {
      if (!(await k.hop({ pt: 'vpn' }, 450, msg.vpn))) return;
      if (!(await k.hop({ path: 'vpnOnprem' }, 380))) return;
      const rag = pickOne(running('rag'));
      if (!rag) {
        log(msg.noRag, 'alarm');
      } else {
        if (!(await k.hop({ pod: rag.id }, 420, msg.rag(nodeName(rag.node))))) return;
        const embed = running('embed')[0];
        if (embed) {
          if (!(await k.hop({ pod: embed.id }, 360, msg.embed))) return;
        } else log(msg.noEmbed, 'warn');
        const index = running('index')[0];
        if (index) {
          if (!(await k.hop({ pod: index.id }, 360, msg.index))) return;
        } else log(msg.noIndex, 'warn');
        const rerank = running('rerank')[0];
        if (rerank) {
          if (!(await k.hop({ pod: rerank.id }, 360, msg.rerank))) return;
        } else log(msg.noRerank, 'warn');
        const xl = running('llmXL')[0];
        const small = running('llmS')[0];
        if (xl) {
          if (!(await k.hop({ pod: xl.id }, 560, msg.xl))) return;
        } else if (small) {
          if (!(await k.hop({ pod: small.id }, 460, msg.small, 'warn'))) return;
        } else {
          log(msg.noLlm, 'alarm');
        }
        if (!(await k.hop({ pod: rag.id }, 300))) return;
      }
      if (!(await k.hop({ path: 'vpnOnprem', reverse: true }, 360))) return;
      const secs = (1.6 + Math.random() * 1.2).toFixed(1);
      if (!(await k.hop({ pt: 'operator' }, 380, rag ? msg.answer(secs) : null, 'ok'))) return;
    } finally {
      k.done();
    }
  }

  async function switchOff(id) {
    const alive = begin();
    const node = NODES[id];
    if (!isUp(sim.current, id)) return;
    const { s: next, on, promoted } = switchOffNode(sim.current, id);
    commit(next);
    const line = offLine(T, next, id, on);
    log(line.text, line.tone);

    if (node.zone === 'paas') {
      if (!on.length) return;
      await wait(1400);
      if (!alive()) return;
      log(msg.paging, 'warn');
      await wait(1300);
      if (!alive()) return;
      const plan = restorePaas(sim.current).placed;
      if (plan.length) {
        log(msg.restoring(labels(plan), nodeNames(plan.map((p) => p.node))));
        const k = packet('data', { pt: 'backups' }, alive);
        const ok = await k.hop({ path: 'backupsPaas' }, 900);
        k.done();
        if (!ok) return;
        const { s: restored, placed } = restorePaas(sim.current);
        commit(restored);
        await wait(900);
        if (!alive()) return;
        markRunning(placed);
        log(msg.restored, 'ok');
      }
      const left = sim.current.pods.filter((p) => p.zone === 'paas' && p.status === 'down');
      if (left.length) log(msg.noRoom(labels(left)), 'alarm');
      return;
    }

    if (node.role === 'control') return;

    if (node.role === 'worker') {
      await wait(1200);
      if (!alive()) return;
      log(on.length ? msg.workerMoving(nodeName(id), on.length) : msg.workerEmpty(nodeName(id)), 'warn');
      if (promoted) log(msg.promoted, 'warn');
      await wait(700);
      if (!alive()) return;
      await placeWaiting(alive);
      return;
    }

    // GPU server: with nothing on it, nothing has to move.
    if (!on.length) return;
    await wait(1200);
    if (!alive()) return;
    await placeModels(alive);
  }

  async function placeWaiting(alive, quietIfNone = false) {
    if (!quorum(sim.current)) {
      const waiting = sim.current.pods.filter((p) => p.zone === 'k8s' && !p.node).length;
      if (waiting) log(msg.noQuorum, 'alarm');
      return [];
    }
    const { s: next, placed } = scheduleK8s(sim.current);
    commit(next);
    await wait(900);
    if (!alive()) return placed;
    markRunning(placed);
    const waiting = sim.current.pods.filter((p) => p.zone === 'k8s' && !p.node).length;
    if (waiting) log(msg.podsWaiting(waiting), 'warn');
    else if (placed.length) log(msg.podsBack(nodeNames([...new Set(placed.map((p) => p.node))])), 'ok');
    else if (!quietIfNone) log(msg.nothingWaiting);
    return placed;
  }

  async function placeModels(alive) {
    const { s: next, placed } = scheduleOnprem(sim.current);
    commit(next);
    const xl = placed.find((p) => p.svc === 'llmXL');
    if (xl) log(msg.xlMoves(xl.gpu[0] + 1, nodeName(xl.node)));
    const rest = placed.filter((p) => p.svc !== 'llmXL');
    if (rest.length) log(msg.modelsMove(labels(rest), nodeNames([...new Set(rest.map((p) => p.node))])));
    await wait(1200);
    if (!alive()) return;
    markRunning(placed);
    const waiting = sim.current.pods.filter((p) => p.zone === 'onprem' && !p.node);
    if (waiting.length) log(msg.modelsWait(labels(waiting)), 'warn');
    else if (placed.length) log(msg.modelsBack, 'ok');
  }

  async function switchOn(id) {
    const alive = begin();
    const node = NODES[id];
    if (sim.current.nodes[id] !== 'down') return;
    const { s: next, back } = switchOnNode(sim.current, id);
    commit(next);
    if (node.zone === 'paas') {
      log(back.length ? msg.paasBack(nodeName(id), labels(back)) : msg.paasBackEmpty(nodeName(id)), 'ok');
      return;
    }
    if (node.zone === 'onprem') {
      log(msg.gpuBack(nodeName(id)), 'ok');
      await wait(500);
      if (alive()) await placeModels(alive);
      return;
    }
    log(node.role === 'control' ? msg.cpBack(nodeName(id)) : msg.workerBack(nodeName(id)), 'ok');
    await wait(500);
    if (alive()) await placeWaiting(alive, true);
  }

  async function shipRelease() {
    if (sim.current.busy.release) return;
    const alive = begin();
    if (!quorum(sim.current)) {
      log(msg.releaseWait, 'alarm');
      return;
    }
    setBusy('release', true);
    try {
      const ver = sim.current.release + 1;
      log(msg.merged);
      await wait(800);
      if (!alive()) return;
      log(msg.image(ver));
      const k = packet('ink', { pt: 'registry' }, alive);
      const ok = await k.hop({ path: 'registryK8s' }, 900);
      k.done();
      if (!ok) return;
      update((st) => startRelease(st, ver));
      for (const svc of RELEASED) {
        log(msg.rolling(svc));
        const olds = running(svc, (p) => p.zone === 'k8s' && p.ver < ver).map((p) => p.id);
        for (const oldId of olds) {
          if (!alive()) return;
          // Without quorum nothing can be scheduled: the rollout waits for a control node to come back.
          if (!quorum(sim.current)) {
            log(msg.rolloutWaits, 'alarm');
            while (!quorum(sim.current)) {
              await wait(300);
              if (!alive()) return;
            }
            log(msg.rolloutResumes, 'ok');
          }
          // A pod whose worker died meanwhile is waiting, and will start from the new version.
          const old = sim.current.pods.find((p) => p.id === oldId);
          if (!old || old.status !== 'run') continue;
          const made = newPod(sim.current, { svc, zone: 'k8s', ver });
          let res = scheduleK8s({ ...made.s, pods: [...made.s.pods, made.pod] });
          if (!res.placed.some((p) => p.id === made.pod.id)) {
            // No room for an extra pod: replace the old one where it is.
            const pods = res.s.pods.map((p) => {
              if (p.id === old.id) return { ...p, status: 'stop' };
              if (p.id === made.pod.id) return { ...p, node: old.node, status: 'start' };
              return p;
            });
            res = { s: { ...res.s, pods }, placed: res.placed };
          }
          commit(res.s);
          await wait(800);
          if (!alive()) return;
          // The scheduler may also have placed pods that were waiting: they start together.
          const ready = new Set([made.pod.id, ...res.placed.map((p) => p.id)]);
          setPods((pods) => pods.map((p) => {
            if (ready.has(p.id) && p.status === 'start') return { ...p, status: 'run' };
            if (p.id === old.id) return { ...p, status: 'stop' };
            return p;
          }));
          await wait(450);
          if (!alive()) return;
          setPods((pods) => pods.filter((p) => p.id !== old.id));
        }
      }
      const end = releaseLine(T, sim.current, ver);
      log(end.text, end.tone);
    } finally {
      if (alive()) setBusy('release', false);
    }
  }

  async function addServer() {
    const id = nextSpare(sim.current);
    if (!id || sim.current.busy.add) return;
    const alive = begin();
    setBusy('add', true);
    try {
      log(msg.plan);
      await wait(700);
      if (!alive()) return;
      update((st) => ({ ...st, nodes: { ...st.nodes, [id]: 'creating' } }));
      log(msg.apply(nodeName(id)));
      await wait(1800);
      if (!alive()) return;
      update((st) => ({ ...st, nodes: { ...st.nodes, [id]: 'up' } }));
      log(msg.joins(nodeName(id)), 'ok');
      const placed = await placeWaiting(alive, true);
      if (alive() && !placed.length) log(msg.landHere);
    } finally {
      if (alive()) setBusy('add', false);
    }
  }

  function switchOffRandom() {
    const candidates = Object.keys(NODES).filter((id) => isUp(sim.current, id));
    if (candidates.length) switchOff(pickOne(candidates));
  }

  function reset() {
    gen.current += 1;
    Object.values(repairs.current).forEach(clearTimeout);
    repairs.current = {};
    commit(initialState());
    setSelected(null);
    log(msg.reset);
  }

  // ---------- self-repair ----------
  // When enough machines of a group stay down for 5 seconds, one comes back.
  useEffect(() => {
    const st = sim.current;
    for (const [key, group] of Object.entries(REPAIR)) {
      const down = group.ids.filter((id) => st.nodes[id] === 'down');
      if (down.length < group.min || repairs.current[key]) continue;
      const g = gen.current;
      repairs.current[key] = setTimeout(() => {
        repairs.current[key] = 0;
        if (g !== gen.current) return;
        const still = group.ids.filter((id) => sim.current.nodes[id] === 'down');
        if (still.length < group.min) return;
        const id = pickOne(still);
        log(T.repair[key](still.length, nodeName(id)), 'warn');
        switchOn(id);
      }, 5000);
    }
  });
  useEffect(() => () => Object.values(repairs.current).forEach(clearTimeout), []);

  // ---------- events ----------
  // Buttons and autoplay go through the same entry points, so each event lights its dot.
  const [fired, setFired] = useState({});
  const fire = (key) => setFired((f) => ({ ...f, [key]: (f[key] || 0) + 1 }));
  const run = {
    page: () => { fire('page'); openPage(); },
    ask: () => { fire('ask'); askAssistant(); },
    off: () => { fire('off'); switchOffRandom(); },
    release: () => {
      if (sim.current.busy.release) return;
      fire('release');
      shipRelease();
    },
    add: () => {
      if (!nextSpare(sim.current) || sim.current.busy.add) return;
      fire('add');
      addServer();
    },
  };

  // ---------- autoplay ----------
  // While the demo is on screen, something happens every few seconds. A click or a key press
  // inside the demo hands it to the visitor for 20 seconds; the pause button stops it.
  // With reduced motion there is no autoplay, and no button to start it.
  const [autoplay, setAutoplay] = useState(true);
  // The reduced motion setting is known only in the browser: it changes the markup after the first
  // render, so the page hydrates with the same markup the server wrote.
  const [still, setStill] = useState(false);
  const playing = autoplay && !still;
  const rootRef = useRef(null);
  const inView = useRef(false);
  const handsOn = useRef(0);
  const autoplayOn = useRef(true);
  const latest = useRef({});
  latest.current = { openPage: run.page, askAssistant: run.ask, switchOffRandom: run.off, switchOn, shipRelease: run.release, addServer: run.add };
  autoplayOn.current = autoplay && !reduce;

  const autoStep = () => {
    if (!autoplayOn.current || !inView.current || document.visibilityState !== 'visible' || Date.now() < handsOn.current) return;
    const st = sim.current;
    const a = latest.current;
    const down = Object.keys(NODES).filter((id) => st.nodes[id] === 'down');
    const options = [
      [a.openPage, 3],
      [a.askAssistant, 2.5],
      [a.switchOffRandom, down.length < 3 ? 1.6 : 0],
      [() => a.switchOn(pickOne(down)), down.length ? 1.4 : 0],
      [a.shipRelease, st.busy.release ? 0 : 0.9],
      [a.addServer, nextSpare(st) && !st.busy.add ? 0.5 : 0],
    ];
    let r = Math.random() * options.reduce((n, [, w]) => n + w, 0);
    for (const [fn, w] of options) {
      r -= w;
      if (r <= 0) {
        fn();
        return;
      }
    }
  };
  const autoRef = useRef(autoStep);
  autoRef.current = autoStep;

  useEffect(() => {
    setStill(Boolean(reduce));
    if (reduce) setAutoplay(false);
  }, [reduce]);

  useEffect(() => {
    if (!autoplay || reduce) return undefined;
    let timer = 0;
    const tick = () => {
      timer = setTimeout(() => {
        autoRef.current();
        tick();
      }, 1000 + Math.random() * 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [autoplay, reduce]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    let first = 0;
    const io = new IntersectionObserver(([entry]) => {
      const was = inView.current;
      inView.current = entry.isIntersecting;
      // Arriving on the demo: start right away instead of waiting for the next tick.
      if (!was && inView.current) {
        clearTimeout(first);
        first = setTimeout(() => autoRef.current(), 800);
      }
    }, { rootMargin: '-40% 0px -40% 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(first);
    };
  }, []);

  const takeOver = () => {
    handsOn.current = Date.now() + 20000;
  };
  const toggleAutoplay = () => {
    if (reduce) return;
    handsOn.current = 0;
    setAutoplay((on) => !on);
  };

  const info = describe(selected, s, T);
  const spare = nextSpare(s);
  const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const cardActions = {
    off: () => {
      if (!info) return;
      fire('off');
      switchOff(info.node);
    },
    on: () => info && switchOn(info.node),
    add: addServer,
  };

  // The log always shows its newest lines, also when the panel changes size.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.log.at(-1)?.id]);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => { el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (e) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const box = (layout) => (
    <MapBox
      T={T} L={layout} s={s} reduce={reduce} selected={selected} onSelect={setSelected}
      info={info} actions={cardActions} addDisabled={s.busy.add}
    />
  );

  return (
    <div ref={rootRef} className="playground" onPointerDown={takeOver} onKeyDown={takeOver}>
      <div className="flex flex-wrap gap-2 [grid-area:actions] lg:flex-col lg:items-stretch">
        <div className="glass flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-2">
          <button type="button" onClick={reset} className="rounded-full px-2 py-1.5 text-left text-[14px] font-semibold text-ink/75 underline decoration-ink/20 underline-offset-4 hover:text-ink">
            {T.ui.reset}
          </button>
          {/* Hidden by CSS too, so it does not show up before the page hydrates. */}
          {!still && (
            <button
              type="button"
              onClick={toggleAutoplay}
              aria-label={playing ? T.ui.pause : T.ui.play}
              title={playing ? T.ui.pause : T.ui.play}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink/15 bg-white text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white motion-reduce:hidden"
            >
              {playing ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                </svg>
              )}
            </button>
          )}
        </div>
        <Action dot="text-traffic" fired={fired.page} onClick={run.page}>{T.ui.buttons.page}</Action>
        <Action dot="text-gpu" fired={fired.ask} onClick={run.ask}>{T.ui.buttons.ask}</Action>
        <Action dot="text-alarm" fired={fired.off} onClick={run.off}>{T.ui.buttons.off}</Action>
        <Action dot="text-ink" fired={fired.release} onClick={run.release} disabled={s.busy.release}>{T.ui.buttons.release}</Action>
        <Action dot="text-mesh" fired={fired.add} onClick={run.add} disabled={!spare || s.busy.add} title={spare ? undefined : T.ui.maxWorkers}>
          {T.ui.buttons.add}
        </Action>
      </div>

      {/* On phones the log stays pinned at the bottom of the screen while the map scrolls by. */}
      <div className="map-log">
        <div className="min-w-0 [grid-area:map]">
          <div className="overflow-visible rounded-[22px] border border-ink/10 bg-white">
            <div className="hidden md:block">{box(WIDE)}</div>
            <div className="md:hidden">{box(TALL)}</div>
          </div>
        </div>

        <section aria-label={T.ui.logLabel} className="sticky bottom-3 z-10 h-[8.5rem] rounded-[22px] bg-ink text-white shadow-[0_14px_36px_-12px_rgba(20,24,46,0.55)] [grid-area:log] lg:relative lg:bottom-auto lg:h-auto lg:min-h-[8rem] lg:shadow-none">
          <div ref={logRef} className="absolute inset-0 overflow-y-auto p-4 lg:p-5">
            {/* Autoplay writes a line every few seconds: read aloud only the lines the visitor starts. */}
            <ol aria-live={playing ? 'off' : 'polite'} className="space-y-2 text-[14px] leading-snug">
              {s.log.length === 0 && <li className="text-white/60">{T.ui.waiting}</li>}
              {s.log.map((l) => (
                <li key={l.id} className="flex gap-3">
                  <span className="shrink-0 pt-px text-[12px] tabular-nums text-white/45">{fmt(l.t)}</span>
                  <span className={`mt-[6px] size-2 shrink-0 rounded-full ${TONE[l.tone]}`} aria-hidden="true" />
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <p className="glass glass-blue px-4 py-3 text-[14px] leading-snug text-ink/80 [grid-area:hint]">
        {T.ui.hint}
      </p>

      <p className="[grid-area:note]"><span className="glass inline-block px-3.5 py-1.5 text-[13px] text-muted">{T.ui.note}</span></p>
    </div>
  );
}
