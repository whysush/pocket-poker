// The host's authoritative game session: seats, buy-ins, loans, voting, timers and
// per-player projections. Pure data + functions; time and randomness are injected.

import { deckFromSeed, commitOf, fromHex, handSeed, mixPool, toHex } from '../engine/rng';
import { evaluate } from '../engine/evaluator';
import { Action, Hand, advance, applyAction, legalActions, needsAdvance, startHand } from '../engine/holdem';
import { BUY_IN, ClientIntent, HistoryEntry, HostIntent, LedgerRow, PlayerView, Settings, View } from './types';
import type { Card } from '../engine/cards';

export const STREET_DELAY = 900;
export const RESULT_PAUSE = 5000;
export const FOLD_PAUSE = 2600;
export const DISCONNECT_AFTER = 15000;
/** 2 hole cards each + 5 board + 3 burns must fit in 52 cards. */
export const MAX_IN_HAND = 22;

export interface SPlayer {
  id: string;
  name: string;
  stack: number;
  loans: number;
  isHost: boolean;
  lastSeen: number;
  connected: boolean;
  sittingOut: boolean;
  left: boolean;
  voteEnd: boolean;
  timeouts: number;
  /** Loan chips approved mid-hand, added when the hand ends. */
  pendingChips: number;
}

interface HandMeta {
  seedHex: string;
  commit: string;
  turnDeadline: number | null;
  nextAt: number | null;
}

interface StoredHistory {
  no: number;
  board: Card[];
  winners: { id: string; amount: number; handName: string | null }[];
  holes: Record<string, Card[]>;
  seats: string[];
  dealer: number;
  commit: string;
  seed: string;
}

export interface Session {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  players: SPlayer[];
  dealerId: string | null;
  handNo: number;
  hand: Hand | null;
  meta: HandMeta | null;
  /** When a waiting table should try to deal again. */
  nextHandAt: number | null;
  pool: string;
  loans: { id: string; playerId: string; amount: number }[];
  endAfterHand: boolean;
  /** Host chose to end the night regardless of votes. */
  forced?: boolean;
  history: StoredHistory[];
  feed: { seq: number; text: string; to?: string }[];
  feedSeq: number;
}

export interface Env {
  now: number;
  random32: () => Uint8Array;
}

export const DEFAULT_SETTINGS: Settings = { sb: 5, bb: 10, turnSecs: 30 };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

// eslint-disable-next-line no-control-regex
const cleanName = (n: string) => n.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';

export function createSession(code: string, hostId: string, hostName: string, env: Env): Session {
  const s: Session = {
    code,
    hostId,
    phase: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    players: [],
    dealerId: null,
    handNo: 0,
    hand: null,
    meta: null,
    nextHandAt: null,
    pool: toHex(env.random32()),
    loans: [],
    endAfterHand: false,
    history: [],
    feed: [],
    feedSeq: 0,
  };
  addPlayer(s, hostId, hostName, env.now);
  s.players[0].isHost = true;
  return s;
}

function say(s: Session, text: string, to?: string) {
  s.feed.push({ seq: ++s.feedSeq, text, to });
  if (s.feed.length > 30) s.feed.splice(0, s.feed.length - 30);
}

const find = (s: Session, id: string) => s.players.find((p) => p.id === id);

export function addPlayer(s: Session, id: string, name: string, now: number): SPlayer {
  const existing = find(s, id);
  if (existing) {
    existing.name = cleanName(name);
    existing.lastSeen = now;
    if (!existing.connected) say(s, `${existing.name} is back`);
    existing.connected = true;
    return existing;
  }
  const p: SPlayer = {
    id,
    name: cleanName(name),
    stack: BUY_IN,
    loans: 0,
    isHost: false,
    lastSeen: now,
    connected: true,
    sittingOut: false,
    left: false,
    voteEnd: false,
    timeouts: 0,
    pendingChips: 0,
  };
  s.players.push(p);
  if (s.players.length > 1) say(s, `${p.name} joined`);
  return p;
}

export function absorbEntropy(s: Session, hex: string) {
  if (/^[0-9a-f]{16,128}$/.test(hex)) s.pool = toHex(mixPool(fromHex(s.pool), fromHex(hex)));
}

const handIdx = (s: Session, id: string) => s.hand?.players.findIndex((p) => p.id === id) ?? -1;
const handActive = (s: Session) => !!s.hand && !s.hand.done;

function eligible(s: Session) {
  return s.players.filter((p) => !p.left && !p.sittingOut && p.stack > 0);
}

function tryStartHand(s: Session, env: Env) {
  if (s.phase !== 'playing') return;
  const elig = eligible(s);
  if (elig.length < 2) {
    s.hand = null;
    s.meta = null;
    s.nextHandAt = null;
    return;
  }
  // Move the button to the next eligible player after the previous button (in seat order).
  const order = s.players;
  let start = s.dealerId ? order.findIndex((p) => p.id === s.dealerId) : -1;
  let dealerP: SPlayer | undefined;
  for (let i = 1; i <= order.length; i++) {
    const p = order[(start + i + order.length) % order.length];
    if (elig.includes(p)) {
      dealerP = p;
      break;
    }
  }
  start = elig.indexOf(dealerP!);
  // With more than MAX_IN_HAND seated, deal the players starting from the button.
  const rotated = [...elig.slice(start), ...elig.slice(0, start)].slice(0, MAX_IN_HAND);
  const dealt = elig.filter((p) => rotated.includes(p));
  s.dealerId = dealerP!.id;
  s.handNo += 1;
  const seed = handSeed(env.random32(), fromHex(s.pool), s.handNo);
  s.hand = startHand({
    no: s.handNo,
    players: dealt.map((p) => ({ id: p.id, stack: p.stack })),
    dealer: dealt.indexOf(dealerP!),
    sb: s.settings.sb,
    bb: s.settings.bb,
    deck: deckFromSeed(seed),
  });
  s.meta = { seedHex: toHex(seed), commit: commitOf(seed), turnDeadline: null, nextAt: null };
  s.nextHandAt = null;
  syncHand(s, env);
}

/** Copy hand stacks to seats, arm timers and finish the hand when it is over. */
function syncHand(s: Session, env: Env) {
  const h = s.hand;
  if (!h || !s.meta) return;
  for (const hp of h.players) find(s, hp.id)!.stack = hp.stack;
  if (h.done) {
    if (s.meta.nextAt === null) finishHand(s, env);
    return;
  }
  if (needsAdvance(h)) {
    s.meta.turnDeadline = null;
    s.meta.nextAt ??= env.now + STREET_DELAY;
    return;
  }
  s.meta.nextAt = null;
  const p = find(s, h.players[h.toAct].id)!;
  const quick = p.left || p.sittingOut;
  s.meta.turnDeadline = quick ? env.now + 1200 : s.settings.turnSecs > 0 ? env.now + s.settings.turnSecs * 1000 : null;
}

function finishHand(s: Session, env: Env) {
  const h = s.hand!;
  const r = h.result!;
  for (const p of s.players) {
    if (p.pendingChips) {
      p.stack += p.pendingChips;
      p.pendingChips = 0;
    }
  }
  s.history.unshift({
    no: h.no,
    board: h.board,
    winners: Object.entries(r.won).map(([id, amount]) => ({ id, amount, handName: r.byFold ? null : r.handNames[id] ?? null })),
    holes: Object.fromEntries(h.players.map((p) => [p.id, p.hole])),
    seats: h.players.map((p) => p.id),
    dealer: h.dealer,
    commit: s.meta!.commit,
    seed: s.meta!.seedHex,
  });
  if (s.history.length > 25) s.history.length = 25;
  s.meta!.turnDeadline = null;
  s.meta!.nextAt = env.now + (r.byFold ? FOLD_PAUSE : RESULT_PAUSE);
  for (const p of s.players) if (p.stack === 0 && !p.left && p.pendingChips === 0) say(s, 'Out of chips — ask the host for a loan', p.id);
}

function endGame(s: Session) {
  if (handActive(s)) return;
  s.phase = 'over';
  s.hand = null;
  s.meta = null;
  s.nextHandAt = null;
  s.loans = [];
  say(s, 'Game over');
}

function checkVotes(s: Session) {
  const active = s.players.filter((p) => !p.left);
  const all = active.length > 0 && active.every((p) => p.voteEnd);
  if (s.phase !== 'playing') return;
  if (!all && !s.forced) {
    s.endAfterHand = false;
    return;
  }
  if (handActive(s)) {
    if (!s.endAfterHand) say(s, 'Everyone voted — game ends after this hand');
    s.endAfterHand = true;
  } else endGame(s);
}

export function ledger(s: Session): LedgerRow[] {
  return s.players
    .map((p) => {
      const inHand = s.hand && !s.hand.done ? s.hand.players.find((h) => h.id === p.id) : null;
      const out = p.stack + p.pendingChips + (inHand ? inHand.bet : 0);
      const loans = p.loans;
      return { id: p.id, name: p.name, buyIn: BUY_IN, loans, out, net: out - BUY_IN - loans, left: p.left };
    })
    .sort((a, b) => b.net - a.net);
}

function grantLoan(s: Session, p: SPlayer, amount: number) {
  p.loans += amount;
  // Seats in a live hand take their stack from the hand, so park the chips until it ends.
  if (handActive(s) && handIdx(s, p.id) >= 0) p.pendingChips += amount;
  else p.stack += amount;
  if (p.sittingOut && p.stack > 0) p.sittingOut = false;
  say(s, `${p.name} got a ${amount.toLocaleString('en-US')} loan`);
  if (s.phase === 'playing' && !s.hand) s.nextHandAt = 0;
}

function act(s: Session, id: string, action: Action, env: Env) {
  if (!s.hand || s.hand.done || s.hand.toAct < 0) return;
  if (s.hand.players[s.hand.toAct].id !== id) return;
  s.hand = applyAction(s.hand, id, action);
  syncHand(s, env);
}

function removeFromGame(s: Session, p: SPlayer, env: Env) {
  p.left = true;
  p.voteEnd = false;
  s.loans = s.loans.filter((l) => l.playerId !== p.id);
  if (s.phase === 'lobby') {
    s.players = s.players.filter((q) => q !== p);
  } else if (handActive(s) && s.hand!.toAct >= 0 && s.hand!.players[s.hand!.toAct].id === p.id) {
    act(s, p.id, { type: 'fold' }, env);
  }
  checkVotes(s);
}

export function handleClient(s: Session, id: string, msg: ClientIntent, env: Env) {
  const p = find(s, id);
  if (msg.type === 'join') {
    if (s.phase === 'over' && !p) return;
    const q = addPlayer(s, id, msg.name, env.now);
    if (q.left && s.phase !== 'over') {
      q.left = false;
      say(s, `${q.name} rejoined`);
    }
    if (s.phase === 'playing' && !s.hand) s.nextHandAt = 0;
    return;
  }
  if (!p) return;
  p.lastSeen = env.now;
  if (!p.connected) {
    p.connected = true;
    say(s, `${p.name} reconnected`);
  }
  if (p.left) return;
  switch (msg.type) {
    case 'ping':
      return;
    case 'action': {
      if (!s.hand || s.hand.no !== msg.handNo) return;
      if (msg.turnId !== undefined && msg.turnId !== turnIdOf(s.hand)) return;
      p.timeouts = 0;
      const a: Action = msg.action === 'raise' ? { type: 'raise', to: Number(msg.to) } : { type: msg.action };
      try {
        act(s, id, a, env);
      } catch {
        /* illegal action from a stale client — ignore */
      }
      return;
    }
    case 'loan': {
      const amount = Math.max(1, Math.min(100000, Math.floor(msg.amount) || BUY_IN));
      if (p.isHost) {
        grantLoan(s, p, amount);
        return;
      }
      s.loans = s.loans.filter((l) => l.playerId !== id);
      s.loans.push({ id: `${id}:${env.now}`, playerId: id, amount });
      say(s, `${p.name} asks for a ${amount.toLocaleString('en-US')} loan`, s.hostId);
      return;
    }
    case 'cancelLoan':
      s.loans = s.loans.filter((l) => l.playerId !== id);
      return;
    case 'vote':
      p.voteEnd = msg.value;
      if (msg.value) say(s, `${p.name} voted to end the game`);
      checkVotes(s);
      return;
    case 'sitOut':
      p.sittingOut = msg.value;
      p.timeouts = 0;
      if (!msg.value && s.phase === 'playing' && !s.hand) s.nextHandAt = 0;
      if (handActive(s)) syncHand(s, env);
      return;
    case 'leave':
      say(s, `${p.name} left the table`);
      removeFromGame(s, p, env);
      return;
  }
}

export function handleHost(s: Session, msg: HostIntent, env: Env) {
  switch (msg.type) {
    case 'start':
      if (s.phase !== 'lobby' || s.players.filter((p) => !p.left).length < 2) return;
      s.phase = 'playing';
      tryStartHand(s, env);
      return;
    case 'settings': {
      const bb = Math.max(2, Math.min(BUY_IN, Math.floor(msg.settings.bb)));
      const sb = Math.max(1, Math.min(bb, Math.floor(msg.settings.sb)));
      s.settings = { sb, bb, turnSecs: Math.max(0, Math.min(300, Math.floor(msg.settings.turnSecs))) };
      if (s.phase === 'playing') say(s, `Blinds now ${sb}/${bb} from next hand`);
      return;
    }
    case 'resolveLoan': {
      const req = s.loans.find((l) => l.id === msg.id);
      if (!req) return;
      s.loans = s.loans.filter((l) => l !== req);
      const p = find(s, req.playerId);
      if (!p) return;
      if (msg.approve) grantLoan(s, p, Math.max(1, Math.floor(msg.amount ?? req.amount)));
      else say(s, 'The host declined your loan', p.id);
      return;
    }
    case 'giveLoan': {
      const p = find(s, msg.playerId);
      if (p && !p.left && s.phase !== 'over') grantLoan(s, p, Math.max(1, Math.floor(msg.amount)));
      return;
    }
    case 'kick': {
      const p = find(s, msg.playerId);
      if (!p || p.isHost) return;
      say(s, `${p.name} was removed by the host`);
      removeFromGame(s, p, env);
      return;
    }
    case 'forceEnd':
      if (s.phase === 'lobby') return;
      s.forced = true;
      say(s, 'The host is ending the game');
      checkVotes(s);
      return;
    case 'playAgain': {
      if (s.phase !== 'over') return;
      s.players = s.players.filter((p) => !p.left);
      for (const p of s.players) Object.assign(p, { stack: BUY_IN, loans: 0, voteEnd: false, sittingOut: false, timeouts: 0, pendingChips: 0 });
      Object.assign(s, { phase: 'lobby', handNo: 0, dealerId: null, history: [], endAfterHand: false, forced: false, loans: [] });
      return;
    }
  }
}

/** Advance clocks. Returns true when anything changed. */
export function tick(s: Session, env: Env): boolean {
  let changed = false;
  for (const p of s.players) {
    if (!p.isHost && p.connected && env.now - p.lastSeen > DISCONNECT_AFTER) {
      p.connected = false;
      changed = true;
    }
  }
  if (s.phase !== 'playing') return changed;
  const h = s.hand;
  const m = s.meta;
  if (!h || !m) {
    if (s.nextHandAt !== null && env.now >= s.nextHandAt) {
      tryStartHand(s, env);
      return true;
    }
    return changed;
  }
  if (h.done) {
    if (m.nextAt !== null && env.now >= m.nextAt) {
      if (s.endAfterHand) {
        s.hand = null;
        endGame(s);
      } else tryStartHand(s, env);
      return true;
    }
    return changed;
  }
  if (needsAdvance(h)) {
    if (m.nextAt !== null && env.now >= m.nextAt) {
      s.hand = advance(h);
      m.nextAt = null;
      syncHand(s, env);
      return true;
    }
    return changed;
  }
  if (m.turnDeadline !== null && env.now >= m.turnDeadline) {
    const hp = h.players[h.toAct];
    const p = find(s, hp.id)!;
    const legal = legalActions(h, h.toAct);
    if (!p.left && !p.sittingOut) {
      p.timeouts += 1;
      if (p.timeouts >= 2) {
        p.sittingOut = true;
        say(s, `${p.name} is away`);
      }
    }
    act(s, hp.id, legal.canCheck ? { type: 'check' } : { type: 'fold' }, env);
    return true;
  }
  return changed;
}

const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];
export const turnIdOf = (h: Hand) => h.log.length * 8 + STREETS.indexOf(h.street);

function lastActionLabel(h: Hand, id: string): string | null {
  const last = [...h.log].reverse().find((a) => a.id === id && a.street === h.street);
  if (!last) return null;
  return { sb: 'SB', bb: 'BB', fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All-in' }[last.type];
}

export function project(s: Session, you: string, now: number): View {
  const h = s.hand;
  const r = h?.result ?? null;
  const players: PlayerView[] = s.players.map((p) => {
    const i = h ? h.players.findIndex((q) => q.id === p.id) : -1;
    const hp = i >= 0 ? h!.players[i] : null;
    let cards: Card[] | null = null;
    if (hp && p.id === you) cards = hp.hole;
    else if (hp && r && r.shown[p.id]) cards = r.shown[p.id];
    return {
      id: p.id,
      name: p.name,
      initials: initials(p.name),
      stack: hp ? hp.stack : p.stack,
      loans: p.loans,
      bet: hp?.bet ?? 0,
      isHost: p.isHost,
      connected: p.connected,
      sittingOut: p.sittingOut,
      left: p.left,
      inHand: !!hp,
      folded: hp?.folded ?? false,
      allIn: hp?.allIn ?? false,
      cards,
      isDealer: !!h && h.players[h.dealer]?.id === p.id,
      voted: p.voteEnd,
      lastAction: h && hp ? lastActionLabel(h, p.id) : null,
      won: r?.won[p.id] ?? 0,
      handName: r && !r.byFold ? r.handNames[p.id] ?? null : null,
    };
  });
  const youIdx = h ? handIdx(s, you) : -1;
  const myTurn = !!h && !h.done && h.toAct >= 0 && h.toAct === youIdx;
  const active = s.players.filter((p) => !p.left);
  let waitingReason: string | null = null;
  if (s.phase === 'playing' && !h) {
    const elig = eligible(s).length;
    waitingReason = elig < 2 ? 'Waiting for players with chips' : 'Dealing…';
  }
  const winners = r ? Object.entries(r.won).map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount) : [];
  return {
    code: s.code,
    you,
    hostId: s.hostId,
    phase: s.phase,
    settings: s.settings,
    buyIn: BUY_IN,
    players,
    hand: h
      ? {
          no: h.no,
          street: h.street,
          board: h.board,
          pot: h.pot,
          toActId: !h.done && h.toAct >= 0 ? h.players[h.toAct].id : null,
          turnLeftMs: s.meta?.turnDeadline ? Math.max(0, s.meta.turnDeadline - now) : null,
          turnTotalMs: s.settings.turnSecs * 1000,
          currentBet: h.currentBet,
          minRaise: h.minRaise,
          turnId: turnIdOf(h),
          commit: s.meta?.commit ?? '',
          done: h.done,
          result: r
            ? {
                byFold: r.byFold,
                winners,
                handName: r.byFold ? null : r.pots[0]?.handName ?? null,
                winningCards: r.winningCards,
              }
            : null,
          nextHandInMs: h.done && s.meta?.nextAt ? Math.max(0, s.meta.nextAt - now) : null,
        }
      : null,
    legal: myTurn ? legalActions(h!, youIdx) : null,
    handsPlayed: s.history.length ? s.history[0].no : 0,
    waitingReason,
    loanRequests:
      you === s.hostId ? s.loans.map((l) => ({ id: l.id, playerId: l.playerId, name: find(s, l.playerId)?.name ?? '?', amount: l.amount })) : [],
    myPendingLoan: s.loans.find((l) => l.playerId === you)?.amount ?? null,
    votesNeeded: active.length,
    votes: active.filter((p) => p.voteEnd).length,
    endAfterHand: s.endAfterHand,
    ledger: s.phase === 'over' || s.phase === 'playing' ? ledger(s) : null,
    history: s.history.slice(0, 15).map(
      (e): HistoryEntry => ({
        no: e.no,
        board: e.board,
        winners: e.winners.map((w) => ({ name: find(s, w.id)?.name ?? '?', amount: w.amount, handName: w.handName })),
        yourCards: e.holes[you] ?? null,
        commit: e.commit,
        seed: e.seed,
        n: e.seats.length,
        dealer: e.dealer,
        seat: e.seats.indexOf(you),
      }),
    ),
    feed: s.feed.filter((f) => !f.to || f.to === you).slice(-8),
  };
}

/** Re-derive a past hand's deck from its revealed seed and check it against what was dealt. */
export function verifyHistory(e: HistoryEntry): boolean {
  const seed = fromHex(e.seed);
  if (commitOf(seed) !== e.commit) return false;
  const deck = deckFromSeed(seed);
  const n = e.n;
  if (e.seat >= 0 && e.yourCards) {
    const k = (e.seat - e.dealer - 1 + n) % n;
    if (deck[k] !== e.yourCards[0] || deck[n + k] !== e.yourCards[1]) return false;
  }
  const boardPos = [2 * n + 1, 2 * n + 2, 2 * n + 3, 2 * n + 5, 2 * n + 7];
  return e.board.every((c, i) => deck[boardPos[i]] === c);
}

/** Live hand label for the hero ("Full house", "Pair of kings"). */
export function heroHandName(cards: Card[] | null, board: Card[]): string | null {
  if (!cards || cards.length < 2) return null;
  return evaluate([...cards, ...board]).name;
}
