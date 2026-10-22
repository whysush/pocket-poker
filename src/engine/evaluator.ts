import { Card, rankOf, suitOf } from './cards';

export const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

const SINGULAR = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
const PLURAL = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];

export interface HandValue {
  /** Comparable score: higher wins, equal ties. */
  score: number;
  category: number;
  /** Best five cards (or fewer, when fewer than five are known). */
  best: Card[];
  name: string;
}

interface Five {
  score: number;
  category: number;
  kickers: number[];
}

function scoreOf(category: number, kickers: number[]): number {
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 16 + (kickers[i] ?? 0);
  return s;
}

/** Group ranks by multiplicity, ordered by count desc then rank desc. */
function groups(cards: Card[]): [number, number][] {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

function straightHigh(ranksDesc: number[]): number {
  const u = [...new Set(ranksDesc)];
  if (u.length !== 5) return -1;
  if (u[0] - u[4] === 4) return u[0];
  // Wheel: A-5-4-3-2 plays as five-high.
  if (u[0] === 12 && u[1] === 3 && u[4] === 0) return 3;
  return -1;
}

function eval5(cards: Card[]): Five {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const sh = straightHigh(ranks);
  const g = groups(cards);
  const byGroup = g.map(([r]) => r);
  let category: number;
  let kickers: number[];
  if (sh >= 0 && flush) [category, kickers] = [8, [sh]];
  else if (g[0][1] === 4) [category, kickers] = [7, byGroup];
  else if (g[0][1] === 3 && g[1][1] === 2) [category, kickers] = [6, byGroup];
  else if (flush) [category, kickers] = [5, ranks];
  else if (sh >= 0) [category, kickers] = [4, [sh]];
  else if (g[0][1] === 3) [category, kickers] = [3, byGroup];
  else if (g[0][1] === 2 && g[1][1] === 2) [category, kickers] = [2, byGroup];
  else if (g[0][1] === 2) [category, kickers] = [1, byGroup];
  else [category, kickers] = [0, ranks];
  return { score: scoreOf(category, kickers), category, kickers };
}

function nameOf(category: number, kickers: number[]): string {
  const [a, b] = kickers;
  switch (category) {
    case 8:
      return a === 12 ? 'Royal flush' : `Straight flush, ${SINGULAR[a]} high`;
    case 7:
      return `Four of a kind, ${PLURAL[a]}`;
    case 6:
      return `Full house, ${PLURAL[a]} full of ${PLURAL[b]}`;
    case 5:
      return `Flush, ${SINGULAR[a]} high`;
    case 4:
      return `Straight, ${SINGULAR[a]} high`;
    case 3:
      return `Three of a kind, ${PLURAL[a]}`;
    case 2:
      return `Two pair, ${PLURAL[a]} and ${PLURAL[b]}`;
    case 1:
      return `Pair of ${PLURAL[a]}`;
    default:
      return `High card, ${SINGULAR[a]}`;
  }
}

/** Short label shown under the hero's cards ("Full house", "Pair of kings"). */
export function shortName(v: HandValue): string {
  if (v.category === 1 || v.category === 8) return v.name;
  return CATEGORY_NAMES[v.category];
}

/** Evaluate the best hand from 1–7 cards. With fewer than 5 only pairs/trips/quads count. */
export function evaluate(cards: Card[]): HandValue {
  if (cards.length >= 5) {
    let best: Five | null = null;
    let bestCards: Card[] = [];
    const n = cards.length;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++)
          for (let d = c + 1; d < n; d++)
            for (let e = d + 1; e < n; e++) {
              const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              const v = eval5(five);
              if (!best || v.score > best.score) {
                best = v;
                bestCards = five;
              }
            }
    return { score: best!.score, category: best!.category, best: bestCards, name: nameOf(best!.category, best!.kickers) };
  }
  const g = groups(cards);
  const byGroup = g.map(([r]) => r);
  let category = 0;
  if (g[0]?.[1] === 4) category = 7;
  else if (g[0]?.[1] === 3) category = 3;
  else if (g[0]?.[1] === 2 && g[1]?.[1] === 2) category = 2;
  else if (g[0]?.[1] === 2) category = 1;
  const name = category === 0 ? `${cap(SINGULAR[byGroup[0]])} high` : nameOf(category, byGroup);
  const used = category === 0 ? cards.filter((c) => rankOf(c) === byGroup[0]) : cards.filter((c) => g.some(([r, k]) => k >= 2 && r === rankOf(c)));
  return { score: scoreOf(category, byGroup), category, best: used, name };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
