// Pure No-Limit Texas Hold'em hand state machine.
// applyAction / advance return a new Hand; nothing here does I/O or uses randomness —
// the shuffled deck is injected by the caller.

import { Card } from './cards';
import { evaluate } from './evaluator';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface HandPlayer {
  id: string;
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in over the whole hand. */
  committed: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last full raise (controls whether they may re-raise). */
  acted: boolean;
}

export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number };

export interface LoggedAction {
  id: string;
  street: Street;
  type: 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  amount: number;
}

export interface PotResult {
  amount: number;
  winners: string[];
  eligible: string[];
  handName: string | null;
}

export interface HandResult {
  pots: PotResult[];
  /** Total chips won per player id. */
  won: Record<string, number>;
  /** Hole cards turned face up at showdown. */
  shown: Record<string, Card[]>;
  handNames: Record<string, string>;
  /** Cards making the winning hand(s), for highlighting. */
  winningCards: Card[];
  byFold: boolean;
}

export interface Hand {
  no: number;
  players: HandPlayer[];
  dealer: number;
  sbIdx: number;
  bbIdx: number;
  sb: number;
  bb: number;
  deck: Card[];
  deckPos: number;
  board: Card[];
  street: Street;
  /** Index of the player to act, or -1 when the betting round is closed. */
  toAct: number;
  currentBet: number;
  /** Size of the last full bet/raise on this street — the minimum raise increment. */
  minRaise: number;
  /** Chips collected from previous streets. */
  pot: number;
  done: boolean;
  result: HandResult | null;
  log: LoggedAction[];
}

export interface Legal {
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
}

const clone = (h: Hand): Hand => structuredClone(h);

function draw(h: Hand): Card {
  if (h.deckPos >= h.deck.length) throw new Error('deck exhausted');
  return h.deck[h.deckPos++];
}

function put(p: HandPlayer, amount: number) {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.bet += a;
  p.committed += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

export interface StartOptions {
  no: number;
  players: { id: string; stack: number }[];
  dealer: number;
  sb: number;
  bb: number;
  deck: Card[];
}

export function startHand(o: StartOptions): Hand {
  const n = o.players.length;
  if (n < 2) throw new Error('need at least two players');
  if (n * 2 + 8 > o.deck.length) throw new Error('too many players for one deck');
  const players: HandPlayer[] = o.players.map((p) => ({
    id: p.id,
    stack: p.stack,
    bet: 0,
    committed: 0,
    hole: [],
    folded: false,
    allIn: false,
    acted: false,
  }));
  const dealer = o.dealer % n;
  // Heads-up: the button posts the small blind and acts first preflop (Robert's Rules, heads-up section).
  const sbIdx = n === 2 ? dealer : (dealer + 1) % n;
  const bbIdx = (sbIdx + 1) % n;
  const h: Hand = {
    no: o.no,
    players,
    dealer,
    sbIdx,
    bbIdx,
    sb: o.sb,
    bb: o.bb,
    deck: o.deck.slice(),
    deckPos: 0,
    board: [],
    street: 'preflop',
    toAct: -1,
    currentBet: o.bb,
    minRaise: o.bb,
    pot: 0,
    done: false,
    result: null,
    log: [],
  };
  h.log.push({ id: players[sbIdx].id, street: 'preflop', type: 'sb', amount: put(players[sbIdx], o.sb) });
  h.log.push({ id: players[bbIdx].id, street: 'preflop', type: 'bb', amount: put(players[bbIdx], o.bb) });
  // Deal one card at a time, starting left of the button.
  for (let r = 0; r < 2; r++) for (let i = 1; i <= n; i++) players[(dealer + i) % n].hole.push(draw(h));
  settle(h, bbIdx);
  return h;
}

export function legalActions(h: Hand, idx: number): Legal {
  const p = h.players[idx];
  const owe = Math.max(0, h.currentBet - p.bet);
  const othersCanAct = h.players.some((q, j) => j !== idx && !q.folded && !q.allIn);
  const maxTo = p.bet + p.stack;
  let minTo = h.currentBet + h.minRaise;
  if (maxTo < minTo) minTo = maxTo; // can only go all-in for less
  // A player who already acted may not re-raise when only facing an incomplete all-in raise.
  const canRaise = p.stack > owe && !p.acted && othersCanAct;
  return { canCheck: owe === 0, callAmount: Math.min(owe, p.stack), canRaise, minTo, maxTo };
}

export function applyAction(prev: Hand, playerId: string, action: Action): Hand {
  if (prev.done || prev.toAct < 0) throw new Error('no action expected');
  const idx = prev.toAct;
  if (prev.players[idx].id !== playerId) throw new Error('not your turn');
  const legal = legalActions(prev, idx);
  const h = clone(prev);
  const p = h.players[idx];
  const log = (type: LoggedAction['type'], amount: number) => h.log.push({ id: p.id, street: h.street, type, amount });

  switch (action.type) {
    case 'fold':
      p.folded = true;
      log('fold', 0);
      break;
    case 'check':
      if (!legal.canCheck) throw new Error('cannot check');
      log('check', 0);
      break;
    case 'call': {
      if (legal.callAmount <= 0) throw new Error('nothing to call');
      const a = put(p, legal.callAmount);
      log(p.allIn ? 'allin' : 'call', a);
      break;
    }
    case 'raise': {
      if (!legal.canRaise) throw new Error('cannot raise');
      const to = Math.floor(action.to);
      if (to < legal.minTo || to > legal.maxTo) throw new Error(`raise must be between ${legal.minTo} and ${legal.maxTo}`);
      const wasBet = h.currentBet === 0;
      const size = to - h.currentBet;
      put(p, to - p.bet);
      if (size >= h.minRaise) {
        // Full raise: reopens betting for everyone else.
        h.minRaise = size;
        for (const q of h.players) if (q !== p) q.acted = false;
      }
      // An incomplete all-in raise (size < minRaise) raises the price but does not reopen
      // betting for players who already acted (TDA Rule 41 / Robert's Rules).
      h.currentBet = to;
      log(p.allIn ? 'allin' : wasBet ? 'bet' : 'raise', to);
      break;
    }
  }
  p.acted = true;
  settle(h, idx);
  return h;
}

/** Find the next player who must act, or close the round. */
function settle(h: Hand, fromIdx: number) {
  const n = h.players.length;
  const live = h.players.filter((p) => !p.folded);
  if (live.length === 1) {
    awardByFold(h, live[0]);
    return;
  }
  const canAct = live.filter((p) => !p.allIn);
  const needs = (p: HandPlayer) => !p.folded && !p.allIn && (!p.acted || p.bet < h.currentBet);
  const someoneNeeds = canAct.some(needs);
  // A lone player with chips who already matches the bet has nobody left to bet against.
  const lone = canAct.length === 1 && canAct[0].bet >= h.currentBet;
  if (someoneNeeds && !lone) {
    for (let i = 1; i <= n; i++) {
      const j = (fromIdx + i) % n;
      if (needs(h.players[j])) {
        h.toAct = j;
        return;
      }
    }
  }
  h.toAct = -1;
  endRound(h);
}

function returnUncalled(h: Hand) {
  const sorted = h.players.map((p, i) => [p.bet, i]).sort((a, b) => b[0] - a[0]);
  const [topBet, topIdx] = sorted[0];
  const second = sorted[1]?.[0] ?? 0;
  if (topBet > second) {
    const p = h.players[topIdx];
    const back = topBet - second;
    p.bet -= back;
    p.committed -= back;
    p.stack += back;
    if (p.stack > 0) p.allIn = false;
  }
}

function collectBets(h: Hand) {
  for (const p of h.players) {
    h.pot += p.bet;
    p.bet = 0;
  }
}

function endRound(h: Hand) {
  returnUncalled(h);
  collectBets(h);
  for (const p of h.players) p.acted = false;
  h.currentBet = 0;
  h.minRaise = h.bb;
}

/** True when betting is closed but more cards must be dealt or the showdown resolved. */
export const needsAdvance = (h: Hand) => !h.done && h.toAct < 0;

/** Deal the next street (or resolve the showdown) once a betting round has closed. */
export function advance(prev: Hand): Hand {
  if (!needsAdvance(prev)) throw new Error('nothing to advance');
  const h = clone(prev);
  if (h.street === 'river') {
    showdown(h);
    return h;
  }
  draw(h); // burn
  if (h.street === 'preflop') {
    h.board.push(draw(h), draw(h), draw(h));
    h.street = 'flop';
  } else if (h.street === 'flop') {
    h.board.push(draw(h));
    h.street = 'turn';
  } else {
    h.board.push(draw(h));
    h.street = 'river';
  }
  const canAct = h.players.filter((p) => !p.folded && !p.allIn);
  if (canAct.length >= 2) {
    // Post-flop action starts with the first live player left of the button.
    settle(h, h.dealer);
  } else h.toAct = -1; // everyone is all-in: run it out
  return h;
}

function awardByFold(h: Hand, winner: HandPlayer) {
  returnUncalled(h);
  collectBets(h);
  winner.stack += h.pot;
  h.result = {
    pots: [{ amount: h.pot, winners: [winner.id], eligible: [winner.id], handName: null }],
    won: { [winner.id]: h.pot },
    shown: {},
    handNames: {},
    winningCards: [],
    byFold: true,
  };
  h.pot = 0;
  h.toAct = -1;
  h.done = true;
}

/** Split committed chips into main and side pots. */
export function buildPots(players: Pick<HandPlayer, 'id' | 'committed' | 'folded'>[]): { amount: number; eligible: string[] }[] {
  const live = players.filter((p) => !p.folded);
  const levels = [...new Set(live.map((p) => p.committed))].filter((l) => l > 0).sort((a, b) => a - b);
  const pots: { amount: number; eligible: string[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.committed, level) - prev);
    const eligible = live.filter((p) => p.committed >= level).map((p) => p.id);
    const last = pots[pots.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else pots.push({ amount, eligible });
    prev = level;
  }
  // Dead money from folded players above the top live level goes to the last pot.
  const extra = players.reduce((s, p) => s + Math.max(0, p.committed - prev), 0);
  if (extra && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

function showdown(h: Hand) {
  h.street = 'showdown';
  const n = h.players.length;
  const live = h.players.filter((p) => !p.folded);
  const values = new Map(live.map((p) => [p.id, evaluate([...p.hole, ...h.board])]));
  const pots = buildPots(h.players);
  const won: Record<string, number> = {};
  const results: PotResult[] = [];
  const winning = new Set<Card>();
  // Seat order starting left of the button, for odd-chip distribution.
  const order = Array.from({ length: n }, (_, i) => h.players[(h.dealer + 1 + i) % n].id);
  for (const pot of pots) {
    const best = Math.max(...pot.eligible.map((id) => values.get(id)!.score));
    const winners = order.filter((id) => pot.eligible.includes(id) && values.get(id)!.score === best);
    const share = Math.floor(pot.amount / winners.length);
    // Odd chips go one at a time to winners starting left of the button.
    let odd = pot.amount - share * winners.length;
    for (const id of winners) {
      const amt = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      won[id] = (won[id] ?? 0) + amt;
      h.players.find((p) => p.id === id)!.stack += amt;
    }
    for (const c of values.get(winners[0])!.best) winning.add(c);
    results.push({ amount: pot.amount, winners, eligible: pot.eligible, handName: values.get(winners[0])!.name });
  }
  h.result = {
    pots: results,
    won,
    shown: Object.fromEntries(live.map((p) => [p.id, p.hole])),
    handNames: Object.fromEntries([...values].map(([id, v]) => [id, v.name])),
    winningCards: [...winning],
    byFold: false,
  };
  h.pot = 0;
  h.toAct = -1;
  h.done = true;
}

/** Total chips in play for this hand: collected pot plus live bets. */
export const totalPot = (h: Hand) => h.pot + h.players.reduce((s, p) => s + p.bet, 0);
