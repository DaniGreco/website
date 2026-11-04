import { describe, expect, it } from 'vitest';
import { initialState, scheduleOnprem, startRelease, switchOffNode, switchOnNode } from './model.js';
import { offLine, releaseLine } from './lines.js';
import { STRINGS } from './strings.js';

const { en, it: itT } = STRINGS;
const off = (s, ...ids) => ids.reduce((st, id) => switchOffNode(st, id).s, s);
const on = (s, ...ids) => ids.reduce((st, id) => switchOnNode(st, id).s, s);
// The line the log writes when `id` is switched off in state `s`.
const lineOff = (T, s, id) => {
  const res = switchOffNode(s, id);
  return offLine(T, res.s, id, res.on);
};

// Both GPU servers off, then both back: every model fits on the first, so the second comes back empty.
function emptyGpuServer() {
  let s = on(off(initialState(), 'ga', 'gb'), 'ga');
  s = scheduleOnprem(s).s;
  return on(s, 'gb');
}

describe('the line for a server switched off', () => {
  it('lists the models that stop on a GPU server', () => {
    expect(lineOff(en, initialState(), 'ga')).toEqual({
      text: 'GPU server A is down. llm-xl, embed, rerank, rag and index stop.',
      tone: 'alarm',
    });
  });

  it('says when nothing was running on a GPU server', () => {
    const s = emptyGpuServer();
    expect(lineOff(en, s, 'gb').text).toBe('GPU server B is down. Nothing was running on it.');
    expect(lineOff(itT, s, 'gb').text).toBe('Server GPU B è giù. Non ci girava niente.');
  });

  it('lists the apps that stop on a container fleet server, or says it was empty', () => {
    expect(lineOff(en, initialState(), 's3').text).toBe('Server 3 is down. docdb, maps and api stop.');
    const empty = { ...initialState(), pods: initialState().pods.filter((p) => p.node !== 's3') };
    expect(lineOff(en, empty, 's3').text).toBe('Server 3 is down. Nothing was running on it.');
  });

  it('warns while the control plane keeps quorum, and alarms when it loses it', () => {
    expect(lineOff(en, initialState(), 'cp1')).toEqual({
      text: 'Control 1 is down. 2 of 3 control nodes still agree, so the cluster keeps working.',
      tone: 'warn',
    });
    expect(lineOff(en, off(initialState(), 'cp1'), 'cp2').tone).toBe('alarm');
  });

  it('says a worker stops answering', () => {
    expect(lineOff(en, initialState(), 'w2')).toEqual({ text: 'Worker 2 stops answering.', tone: 'alarm' });
  });
});

describe('the line at the end of a release', () => {
  const allAt = (s, ver) => ({ ...s, pods: s.pods.map((p) => (p.zone === 'k8s' && p.svc !== 'sql' ? { ...p, ver } : p)) });

  it('says the release is live when every pod runs it', () => {
    const s = allAt(startRelease(initialState(), 2), 2);
    expect(releaseLine(en, s, 2)).toEqual({ text: 'Release v2 is live. No visitor saw an error.', tone: 'ok' });
  });

  it('does not say the release is live when some pods still run the old version', () => {
    const s = startRelease(initialState(), 2);
    const one = { ...allAt(s, 2), pods: allAt(s, 2).pods.map((p) => (p.id === 'p11' ? { ...p, ver: 1 } : p)) };
    expect(releaseLine(en, one, 2)).toEqual({ text: 'Release v2 is not complete: 1 pod still runs an older version.', tone: 'warn' });
    expect(releaseLine(en, s, 2).text).toBe('Release v2 is not complete: 8 pods still run an older version.');
    expect(releaseLine(itT, s, 2).text).toBe('Il rilascio v2 non è completo: 8 pod girano ancora una versione precedente.');
  });
});
