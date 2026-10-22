// Pocket Poker's own random number generator.
//
// - SHA-256 (FIPS 180-4) mixes entropy and produces the per-hand commitment.
// - ChaCha20 (RFC 8439 block function) turns a 32-byte seed into a keystream.
// - Unbiased integers by rejection sampling; Fisher–Yates for the shuffle.
//
// Each hand's seed = SHA-256(host secret ‖ entropy pool ‖ hand number). The pool
// absorbs random bytes sent by every player's device, so no single phone controls
// the shuffle. SHA-256(seed) is published before the deal and the seed is revealed
// after, so anyone can re-derive the deck and verify it (commit–reveal).

import { Card, freshDeck } from './cards';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/** RFC 8439 ChaCha20 block function: 16 output words for (key, counter, nonce). */
export function chachaBlock(key: Uint32Array, counter: number, nonce: Uint32Array): Uint32Array {
  const s = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, counter >>> 0, ...nonce]);
  const x = new Uint32Array(s);
  const qr = (a: number, b: number, c: number, d: number) => {
    x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 16);
    x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 12);
    x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 8);
    x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) x[i] += s[i];
  return x;
}

const wordsLE = (b: Uint8Array) => {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return new Uint32Array(Array.from({ length: b.length / 4 }, (_, i) => dv.getUint32(i * 4, true)));
};

/** Deterministic CSPRNG: ChaCha20 keystream keyed by a 32-byte seed. */
export class ChaChaRng {
  private key: Uint32Array;
  private nonce: Uint32Array;
  private counter = 0;
  private buf = new Uint32Array(0);
  private pos = 0;

  constructor(seed: Uint8Array, nonce = new Uint8Array(12)) {
    if (seed.length !== 32) throw new Error('seed must be 32 bytes');
    this.key = wordsLE(seed);
    this.nonce = wordsLE(nonce);
  }

  nextU32(): number {
    if (this.pos >= this.buf.length) {
      this.buf = chachaBlock(this.key, this.counter++, this.nonce);
      this.pos = 0;
    }
    return this.buf[this.pos++];
  }

  /** Uniform integer in [0, n) with no modulo bias. */
  int(n: number): number {
    if (n <= 0 || n > 2 ** 32) throw new Error('bad range');
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % n;
    }
  }
}

export function shuffle<T>(items: T[], rng: { int(n: number): number }): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const deckFromSeed = (seed: Uint8Array): Card[] => shuffle(freshDeck(), new ChaChaRng(seed));

const u32be = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
};

export const handSeed = (hostSecret: Uint8Array, pool: Uint8Array, handNo: number) => sha256(concatBytes(hostSecret, pool, u32be(handNo)));
export const commitOf = (seed: Uint8Array) => toHex(sha256(seed));
export const mixPool = (pool: Uint8Array, entropy: Uint8Array) => sha256(concatBytes(pool, entropy));
