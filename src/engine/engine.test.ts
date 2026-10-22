import { describe, expect, it } from 'vitest';
import { Card, freshDeck, parseCards } from './cards';
import { evaluate } from './evaluator';
import { Action, Hand, advance, applyAction, buildPots, legalActions, needsAdvance, startHand } from './holdem';
import { ChaChaRng, chachaBlock, commitOf, deckFromSeed, fromHex, handSeed, sha256, shuffle, toHex } from './rng';

const enc = (s: string) => new TextEncoder().encode(s);

describe('rng', () => {
  it('sha256 matches FIPS 180-4 vectors', () => {
    expect(toHex(sha256(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(toHex(sha256(new Uint8Array(1000).fill(0x61)))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('chacha20 block matches RFC 8439 §2.3.2', () => {
    const key = new Uint32Array(new Uint8Array(Array.from({ length: 32 }, (_, i) => i)).buffer);
    const nonce = new Uint32Array(fromHex('000000090000004a00000000').buffer);
    const out = chachaBlock(key, 1, nonce);
    expect(out[0].toString(16)).toBe('e4e7f110');
    expect(out[1].toString(16)).toBe('15593bd1');
    expect(out[15].toString(16)).toBe('4e3c50a2');
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = deckFromSeed(sha256(enc('a')));
    expect(deckFromSeed(sha256(enc('a')))).toEqual(a);
    expect(deckFromSeed(sha256(enc('b')))).not.toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(freshDeck());
  });

  it('int() is unbiased (chi-square)', () => {
    const rng = new ChaChaRng(sha256(enc('chi')));
    const buckets = new Array(7).fill(0);
    const N = 70000;
    for (let i = 0; i < N; i++) buckets[rng.int(7)]++;
    const exp = N / 7;
    const chi = buckets.reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
    expect(chi).toBeLessThan(22.46); // p = 0.001, 6 dof
  });

  it('shuffle puts every card in every position evenly', () => {
    const rng = new ChaChaRng(sha256(enc('pos')));
    const counts = new Array(52).fill(0);
    const N = 20000;
    for (let i = 0; i < N; i++) counts[shuffle(freshDeck(), rng)[0]]++;
    const exp = N / 52;
    const chi = counts.reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
    expect(chi).toBeLessThan(90.57); // p = 0.001, 51 dof
  });

  it('commit/reveal round-trips', () => {
    const seed = handSeed(sha256(enc('host')), sha256(enc('pool')), 7);
    expect(commitOf(seed)).toBe(toHex(sha256(seed)));
  });
});

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('ranks every category in order', () => {
    const hands = [
      'As Kd 9c 7h 3s 2d 4c', // high card
      'As Ad 9c 7h 3s 2d 5c', // pair
      'As Ad 9c 9h 3s 2d 5c', // two pair
      'As Ad Ac 9h 3s 2d 5c', // trips
      '5s 6d 7c 8h 9s 2d Kc', // straight
      '2h 6h 9h Jh Kh 3c 4d', // flush
      'Ks Kd Kh 7c 7d 2s 3h', // full house
      'Ks Kd Kh Kc 7d 2s 3h', // quads
      '5h 6h 7h 8h 9h 2d Kc', // straight flush
    ].map(ev);
    hands.forEach((h, i) => expect(h.category).toBe(i));
    for (let i = 1; i < hands.length; i++) expect(hands[i].score).toBeGreaterThan(hands[i - 1].score);
  });

  it('names hands like the design', () => {
    expect(ev('Kh 7c Ks 7h Kd 2c 9s').name).toBe('Full house, kings full of sevens');
    expect(ev('Ah Kh Qh Jh Th 2c 3d').name).toBe('Royal flush');
    expect(ev('Ah 2d 3c 4s 5h 9c Kd').name).toBe('Straight, five high');
    expect(ev('Kh 7c').name).toBe('King high');
    expect(ev('Kh Kc').name).toBe('Pair of kings');
  });

  it('handles the wheel below a six-high straight', () => {
    expect(ev('Ah 2d 3c 4s 5h Kc Kd').score).toBeLessThan(ev('6h 2d 3c 4s 5h Kc Kd').score);
  });

  it('uses kickers', () => {
    expect(ev('As Ad Kc 9h 3s 2d 5c').score).toBeGreaterThan(ev('Ah Ac Qc 9d 3s 2d 5c').score);
    expect(ev('Ks Kd 9c 9h As 2d 5c').score).toBeGreaterThan(ev('Kh Kc 9s 9d Qs 2d 5c').score);
    expect(ev('2h 6h 9h Jh Kh').score).toBeGreaterThan(ev('2c 6c 8c Jc Kc').score);
  });

  it('ties identical boards', () => {
    expect(ev('2c 3d As Ks Qs Js Ts').score).toBe(ev('4c 5d As Ks Qs Js Ts').score);
  });

  it('picks the best two pair out of three pairs', () => {
    expect(ev('As Ad Kc Kh 3s 3d 5c').name).toBe('Two pair, aces and kings');
  });
});

/** Build a deck where players get the given hole cards (dealt round-robin from left of the button) then the board. */
function rigDeck(holes: string[], board: string, dealer = 0): Card[] {
  const n = holes.length;
  const hc = holes.map(parseCards);
  const top: Card[] = [];
  for (let r = 0; r < 2; r++) for (let i = 1; i <= n; i++) top.push(hc[(dealer + i) % n][r]);
  const b = parseCards(board);
  const used = new Set([...top, ...b]);
  const rest = freshDeck().filter((c) => !used.has(c));
  const burn = () => rest.shift()!;
  const deck = [...top, burn(), b[0], b[1], b[2], burn(), b[3], burn(), b[4], ...rest];
  return deck;
}

function play(h: Hand, ...acts: [string, Action][]): Hand {
  for (const [id, a] of acts) {
    while (needsAdvance(h)) h = advance(h);
    h = applyAction(h, id, a);
  }
  return h;
}

const runOut = (h: Hand) => {
  while (needsAdvance(h)) h = advance(h);
  return h;
};

const stacks = (h: Hand) => Object.fromEntries(h.players.map((p) => [p.id, p.stack]));
const total = (h: Hand) => h.players.reduce((s, p) => s + p.stack + p.bet, 0) + h.pot;

describe('holdem', () => {
  const three = (st = [500, 500, 500]) => [
    { id: 'A', stack: st[0] },
    { id: 'B', stack: st[1] },
    { id: 'C', stack: st[2] },
  ];

  it('posts blinds and acts UTG first (3-handed: button)', () => {
    const h = startHand({ no: 1, players: three(), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    expect(h.players[1].bet).toBe(5);
    expect(h.players[2].bet).toBe(10);
    expect(h.toAct).toBe(0);
    expect(h.players.every((p) => p.hole.length === 2)).toBe(true);
  });

  it('heads-up: button posts SB, acts first preflop and last postflop', () => {
    let h = startHand({ no: 1, players: three().slice(0, 2), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    expect(h.players[0].bet).toBe(5);
    expect(h.players[1].bet).toBe(10);
    expect(h.toAct).toBe(0);
    h = play(h, ['A', { type: 'call' }], ['B', { type: 'check' }]);
    h = advance(h);
    expect(h.street).toBe('flop');
    expect(h.players[h.toAct].id).toBe('B');
  });

  it('gives the big blind the option when limped to', () => {
    let h = startHand({ no: 1, players: three(), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    h = play(h, ['A', { type: 'call' }], ['B', { type: 'call' }]);
    expect(h.players[h.toAct].id).toBe('C');
    expect(legalActions(h, h.toAct).canCheck).toBe(true);
    expect(legalActions(h, h.toAct).canRaise).toBe(true);
  });

  it('everyone folds to the big blind', () => {
    let h = startHand({ no: 1, players: three(), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    h = play(h, ['A', { type: 'fold' }], ['B', { type: 'fold' }]);
    expect(h.done).toBe(true);
    expect(h.result!.byFold).toBe(true);
    expect(stacks(h)).toEqual({ A: 500, B: 495, C: 505 });
  });

  it('enforces the min-raise (last full raise size)', () => {
    let h = startHand({ no: 1, players: three(), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    expect(legalActions(h, 0).minTo).toBe(20);
    expect(() => applyAction(h, 'A', { type: 'raise', to: 15 })).toThrow();
    h = play(h, ['A', { type: 'raise', to: 40 }]); // raise of 30
    expect(legalActions(h, h.toAct).minTo).toBe(70);
    h = play(h, ['B', { type: 'raise', to: 70 }]);
    expect(legalActions(h, h.toAct).minTo).toBe(100);
  });

  it('incomplete all-in raise does not reopen betting', () => {
    let h = startHand({ no: 1, players: three([500, 500, 115]), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    // A raises to 100, B calls, C (BB) shoves 115 — only 15 more, less than a full raise of 90.
    h = play(h, ['A', { type: 'raise', to: 100 }], ['B', { type: 'call' }], ['C', { type: 'raise', to: 115 }]);
    expect(h.currentBet).toBe(115);
    const legalA = legalActions(h, h.toAct);
    expect(h.players[h.toAct].id).toBe('A');
    expect(legalA.callAmount).toBe(15);
    expect(legalA.canRaise).toBe(false);
  });

  it('full all-in raise reopens betting', () => {
    let h = startHand({ no: 1, players: three([500, 500, 300]), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    h = play(h, ['A', { type: 'raise', to: 100 }], ['B', { type: 'call' }], ['C', { type: 'raise', to: 300 }]);
    expect(legalActions(h, h.toAct).canRaise).toBe(true);
  });

  it('builds 3-way side pots and pays them to the right players', () => {
    // A (short) has the best hand, B second best, C worst.
    const deck = rigDeck(['As Ad', 'Ks Kd', 'Qs Qd'], '2c 5h 8d 9c Jh');
    let h = startHand({ no: 1, players: three([100, 300, 500]), dealer: 0, sb: 5, bb: 10, deck });
    h = play(h, ['A', { type: 'raise', to: 100 }], ['B', { type: 'raise', to: 300 }], ['C', { type: 'call' }]);
    h = runOut(h);
    expect(h.done).toBe(true);
    expect(h.result!.pots.map((p) => p.amount)).toEqual([300, 400]);
    expect(stacks(h)).toEqual({ A: 300, B: 400, C: 200 });
    expect(total(h)).toBe(900);
  });

  it('builds 4-way side pots with a folder contributing dead money', () => {
    const players = ['A', 'B', 'C', 'D'].map((id, i) => ({ id, stack: [50, 150, 400, 400][i] }));
    const deck = rigDeck(['As Ad', 'Ks Kd', 'Qs Qd', '7c 2d'], '3c 4h 8d 9c Jh');
    let h = startHand({ no: 1, players, dealer: 3, sb: 5, bb: 10, deck });
    // dealer D(3): SB A, BB B, UTG C
    h = play(h, ['C', { type: 'raise', to: 40 }], ['D', { type: 'call' }], ['A', { type: 'raise', to: 50 }], ['B', { type: 'raise', to: 150 }]);
    h = play(h, ['C', { type: 'call' }], ['D', { type: 'fold' }]);
    h = runOut(h);
    // A: 50 from A,B,C + D's 40 = 190. B: 100 from B,C = 200. C gets nothing back beyond.
    expect(h.result!.pots.map((p) => p.amount)).toEqual([190, 200]);
    expect(stacks(h)).toEqual({ A: 190, B: 200, C: 250, D: 360 });
    expect(total(h)).toBe(1000);
  });

  it('splits pots and gives the odd chip left of the button', () => {
    const players = ['A', 'B', 'C'].map((id) => ({ id, stack: 500 }));
    const deck = rigDeck(['2c 3d', '2d 3c', '4h 4s'], 'As Ks Qs Js Ts');
    let h = startHand({ no: 1, players, dealer: 0, sb: 5, bb: 10, deck });
    // SB B, BB C. A calls, B completes, C checks; pot 30 split 3 ways (board royal)
    h = play(h, ['A', { type: 'call' }], ['B', { type: 'call' }], ['C', { type: 'check' }]);
    for (const s of ['flop', 'turn', 'river']) {
      h = advance(h);
      expect(h.street).toBe(s);
      h = play(h, ['B', { type: 'check' }], ['C', { type: 'check' }], ['A', { type: 'check' }]);
    }
    h = runOut(h);
    expect(h.result!.pots[0].winners.length).toBe(3);
    expect(stacks(h)).toEqual({ A: 500, B: 500, C: 500 });
  });

  it('odd chip goes to the first winner left of the button', () => {
    const pots = buildPots([
      { id: 'A', committed: 5, folded: true },
      { id: 'B', committed: 10, folded: false },
      { id: 'C', committed: 10, folded: false },
    ]);
    expect(pots).toEqual([{ amount: 25, eligible: ['B', 'C'] }]);
    // Button C folds nothing; SB A folds 5 dead chips; B and C chop 25 → B (first left of button) gets 13.
    const deck = rigDeck(['7c 2d', '2c 3d', '2h 3c'], 'As Ks Qs Js Ts', 2);
    let h = startHand({ no: 1, players: three([500, 500, 500]), dealer: 2, sb: 5, bb: 10, deck });
    h = play(h, ['C', { type: 'call' }], ['A', { type: 'fold' }], ['B', { type: 'check' }]);
    for (let i = 0; i < 3; i++) h = play(h, ['B', { type: 'check' }], ['C', { type: 'check' }]);
    h = runOut(h);
    expect(h.result!.won).toEqual({ B: 13, C: 12 });
    expect(stacks(h)).toEqual({ A: 495, B: 503, C: 502 });
  });

  it('returns the uncalled part of a bet', () => {
    let h = startHand({ no: 1, players: three([500, 500, 60]), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    h = play(h, ['A', { type: 'raise', to: 200 }], ['B', { type: 'fold' }], ['C', { type: 'call' }]);
    h = runOut(h);
    expect(total(h)).toBe(1060);
    expect(h.players[0].committed).toBe(60);
    expect(h.result!.pots.reduce((s, p) => s + p.amount, 0)).toBe(125);
  });

  it('runs it out when everyone is all-in', () => {
    let h = startHand({ no: 1, players: three([100, 100, 100]), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    h = play(h, ['A', { type: 'raise', to: 100 }], ['B', { type: 'call' }], ['C', { type: 'call' }]);
    expect(h.toAct).toBe(-1);
    h = runOut(h);
    expect(h.board.length).toBe(5);
    expect(h.done).toBe(true);
    expect(total(h)).toBe(300);
  });

  it('short blind all-in still plays', () => {
    let h = startHand({ no: 1, players: three([500, 3, 500]), dealer: 0, sb: 5, bb: 10, deck: freshDeck() });
    expect(h.players[1].allIn).toBe(true);
    h = play(h, ['A', { type: 'call' }], ['C', { type: 'check' }]);
    h = runOut(h.toAct < 0 ? h : h);
    expect(h.street).not.toBe('preflop');
  });

  it('survives thousands of random hands conserving chips', () => {
    const rng = new ChaChaRng(sha256(enc('fuzz')));
    for (let t = 0; t < 1500; t++) {
      const n = 2 + rng.int(8);
      const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, stack: 1 + rng.int(1000) }));
      const start = players.reduce((s, p) => s + p.stack, 0);
      let h = startHand({ no: t, players, dealer: rng.int(n), sb: 5, bb: 10, deck: shuffle(freshDeck(), rng) });
      let guard = 0;
      while (!h.done) {
        if (++guard > 500) throw new Error('stuck');
        if (needsAdvance(h)) {
          h = advance(h);
          continue;
        }
        const l = legalActions(h, h.toAct);
        const id = h.players[h.toAct].id;
        const r = rng.int(10);
        let a: Action;
        if (r < 2) a = { type: 'fold' };
        else if (r < 4 && l.canRaise) a = { type: 'raise', to: l.minTo + rng.int(l.maxTo - l.minTo + 1) };
        else a = l.canCheck ? { type: 'check' } : { type: 'call' };
        h = applyAction(h, id, a);
        expect(total(h)).toBe(start);
      }
      expect(h.players.reduce((s, p) => s + p.stack, 0)).toBe(start);
      expect(h.players.every((p) => p.stack >= 0)).toBe(true);
    }
  });
});
