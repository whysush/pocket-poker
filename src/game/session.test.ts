import { describe, expect, it } from 'vitest';
import { ChaChaRng, sha256 } from '../engine/rng';
import { Env, createSession, handleClient, handleHost, ledger, project, tick, verifyHistory } from './session';

function harness(seed: string) {
  const rng = new ChaChaRng(sha256(new TextEncoder().encode(seed)));
  let now = 1_000_000;
  const env = (): Env => ({ now, random32: () => Uint8Array.from({ length: 32 }, () => rng.int(256)) });
  const advanceTime = (ms: number) => (now += ms);
  return { rng, env, advanceTime };
}

describe('session', () => {
  it('plays a long night with loans, joins, leaves and votes; ledger nets to zero', () => {
    const { rng, env, advanceTime } = harness('night');
    const s = createSession('ABCDEF', 'host', 'Sush', env());
    for (const n of ['Mira', 'Rook', 'Dev']) handleClient(s, n, { type: 'join', name: n }, env());
    handleHost(s, { type: 'start' }, env());
    expect(s.phase).toBe('playing');
    expect(s.hand).not.toBeNull();

    let hands = 0;
    for (let step = 0; step < 20000 && hands < 120; step++) {
      // Keep everyone "connected".
      for (const p of s.players) if (!p.isHost) handleClient(s, p.id, { type: 'ping' }, env());
      const v = project(s, 'host', env().now);
      expect(v.ledger!.reduce((a, r) => a + r.net, 0)).toBeLessThanOrEqual(0);
      const h = s.hand;
      if (h && !h.done && h.toAct >= 0 && !s.players.find((p) => p.id === h.players[h.toAct].id)!.left) {
        const id = h.players[h.toAct].id;
        const pv = project(s, id, env().now);
        const l = pv.legal!;
        expect(l).not.toBeNull();
        const r = rng.int(10);
        const a =
          r < 2
            ? { action: 'fold' as const }
            : r < 4 && l.canRaise
              ? { action: 'raise' as const, to: l.minTo + rng.int(l.maxTo - l.minTo + 1) }
              : { action: l.canCheck ? ('check' as const) : ('call' as const) };
        handleClient(s, id, { type: 'action', handNo: h.no, ...a }, env());
      } else {
        advanceTime(1000);
        const wasDone = h?.done;
        tick(s, env());
        if (wasDone && s.hand !== h) hands++;
      }
      // Busted players ask for loans; the host approves.
      for (const p of s.players) {
        if (p.stack === 0 && !p.pendingChips && !p.left && !s.loans.some((l) => l.playerId === p.id)) {
          handleClient(s, p.id, { type: 'loan', amount: 500 }, env());
        }
      }
      for (const l of [...s.loans]) handleHost(s, { type: 'resolveLoan', id: l.id, approve: true }, env());
      if (hands === 30 && !s.players.some((p) => p.id === 'Theo')) handleClient(s, 'Theo', { type: 'join', name: 'Theo' }, env());
      if (hands === 60 && !s.players.find((p) => p.id === 'Dev')!.left) handleClient(s, 'Dev', { type: 'leave' }, env());
    }
    expect(hands).toBeGreaterThanOrEqual(100);
    expect(s.players.some((p) => p.loans > 0)).toBe(true);

    for (const p of s.players) handleClient(s, p.id, { type: 'vote', value: true }, env());
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
      const h = s.hand;
      if (h && !h.done && h.toAct >= 0) {
        const id = h.players[h.toAct].id;
        handleClient(s, id, { type: 'action', action: 'fold', handNo: h.no }, env());
      } else {
        advanceTime(1000);
        tick(s, env());
      }
    }
    expect(s.phase).toBe('over');
    const rows = ledger(s);
    expect(rows.reduce((a, r) => a + r.net, 0)).toBe(0);
    expect(rows.every((r) => r.net === r.out - r.buyIn - r.loans)).toBe(true);

    const hist = project(s, 'Mira', env().now).history;
    expect(hist.length).toBeGreaterThan(0);
    for (const e of hist) expect(verifyHistory(e)).toBe(true);
    expect(verifyHistory({ ...hist[0], seed: hist[1].seed })).toBe(false);
  });

  it('never leaks other players hole cards before showdown', () => {
    const { env } = harness('leak');
    const s = createSession('ABCDEF', 'host', 'Sush', env());
    handleClient(s, 'p2', { type: 'join', name: 'Two' }, env());
    handleClient(s, 'p3', { type: 'join', name: 'Three' }, env());
    handleHost(s, { type: 'start' }, env());
    const v = project(s, 'p2', env().now);
    const json = JSON.stringify(v);
    for (const hp of s.hand!.players) {
      const pv = v.players.find((p) => p.id === hp.id)!;
      if (hp.id === 'p2') expect(pv.cards).toEqual(hp.hole);
      else expect(pv.cards).toBeNull();
    }
    expect(json).not.toContain('deck');
    expect(json).not.toContain(s.meta!.seedHex);
  });

  it('auto-folds on timeout and marks a player away after two', () => {
    const { env, advanceTime } = harness('timeout');
    const s = createSession('ABCDEF', 'host', 'Sush', env());
    handleClient(s, 'p2', { type: 'join', name: 'Two' }, env());
    handleHost(s, { type: 'start' }, env());
    const first = s.hand!.players[s.hand!.toAct].id;
    advanceTime(31000);
    if (first !== 'host') handleClient(s, 'p2', { type: 'ping' }, env());
    tick(s, env());
    expect(s.hand!.done).toBe(true);
  });

  it('requires every player to vote before ending', () => {
    const { env } = harness('vote');
    const s = createSession('ABCDEF', 'host', 'Sush', env());
    handleClient(s, 'p2', { type: 'join', name: 'Two' }, env());
    handleHost(s, { type: 'start' }, env());
    handleClient(s, 'host', { type: 'vote', value: true }, env());
    expect(s.endAfterHand).toBe(false);
    handleClient(s, 'p2', { type: 'vote', value: true }, env());
    expect(s.endAfterHand).toBe(true);
    handleClient(s, 'p2', { type: 'vote', value: false }, env());
    expect(s.endAfterHand).toBe(false);
  });
});
