// End-to-end encryption between the host and each player (ECDH P-256 → AES-GCM),
// so the public relay — and other players listening on it — never see hole cards.

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('This browser needs a secure (https) connection to play.');
  return globalThis.crypto.subtle;
};

export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface KeyPair {
  privateKey: CryptoKey;
  pub: string;
  privJwk: JsonWebKey;
}

const ALG = { name: 'ECDH', namedCurve: 'P-256' } as const;

export async function generateKeys(): Promise<KeyPair> {
  const kp = await subtle().generateKey(ALG, true, ['deriveKey']);
  return {
    privateKey: kp.privateKey,
    pub: b64(await subtle().exportKey('raw', kp.publicKey)),
    privJwk: await subtle().exportKey('jwk', kp.privateKey),
  };
}

export async function restoreKeys(privJwk: JsonWebKey, pub: string): Promise<KeyPair> {
  const privateKey = await subtle().importKey('jwk', privJwk, ALG, true, ['deriveKey']);
  return { privateKey, pub, privJwk };
}

export async function sharedKey(own: KeyPair, otherPub: string): Promise<CryptoKey> {
  const pub = await subtle().importKey('raw', unb64(otherPub), ALG, false, []);
  return subtle().deriveKey({ name: 'ECDH', public: pub }, own.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, data: unknown): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function open<T>(key: CryptoKey, box: { iv: string; ct: string }): Promise<T> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export const randomHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
