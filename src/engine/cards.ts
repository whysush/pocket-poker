// Card encoding: 0..51, rank = c >> 2 (0 = two … 12 = ace), suit = c & 3.
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
// U+FE0E forces text (not emoji) glyphs so suits take the card colour on Android/iOS.
export const SUIT_SYMBOLS = ['♠\uFE0E', '♥\uFE0E', '♦\uFE0E', '♣\uFE0E'];

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const isRed = (c: Card) => suitOf(c) === 1 || suitOf(c) === 2;

export function rankLabel(c: Card): string {
  const ch = RANK_CHARS[rankOf(c)];
  return ch === 'T' ? '10' : ch;
}

export function cardCode(c: Card): string {
  return RANK_CHARS[rankOf(c)] + 'shdc'[suitOf(c)];
}

export function parseCard(s: string): Card {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = 'shdc'.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error('bad card ' + s);
  return (r << 2) | su;
}

export const parseCards = (s: string) => s.trim().split(/\s+/).map(parseCard);

export function freshDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
