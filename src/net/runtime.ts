import type { ClientIntent, HostIntent, View } from '../game/types';
import { Session, Env, createSession, handleClient, handleHost, project, tick, absorbEntropy } from '../game/session';
import { KeyPair, generateKeys, open, randomHex, restoreKeys, seal, sharedKey } from './crypto';
import { Relay, TOPIC_ROOT } from './relay';

export type NetStatus = 'connecting' | 'searching' | 'live' | 'notfound' | 'hostAway' | 'closed';

export interface NetState {
  status: NetStatus;
  relays: number;
  view: View | null;
  /** performance.now() when the view arrived — for turn clocks. */
  viewAt: number;
}

export interface Runtime {
  role: 'host' | 'client';
  code: string;
  send(i: ClientIntent): void;
  host(i: HostIntent): void;
  leave(): Promise<void>;
  wake(): void;
}

type Listener = (s: NetState) => void;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newRoomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
export const normalizeCode = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[O]/g, '0')
    .replace(/[I]/g, '1')
    .slice(0, 6);

const topics = (code: string) => ({
  info: `${TOPIC_ROOT}/${code}/info`,
  up: `${TOPIC_ROOT}/${code}/up`,
  down: (pid: string) => `${TOPIC_ROOT}/${code}/d/${pid}`,
});

const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage full or blocked */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const HOST_KEY = 'pkp.host';
const CLIENT_KEY = 'pkp.client';

interface SavedHost {
  session: Session;
  priv: JsonWebKey;
  pub: string;
  peers: Record<string, { pub: string; lastId: number }>;
}

interface SavedClient {
  code: string;
  pid: string;
  name: string;
  priv: JsonWebKey;
  pub: string;
}

export const savedRoom = (): { role: 'host' | 'client'; code: string } | null => {
  const h = store.get<SavedHost>(HOST_KEY);
  if (h?.session && h.session.phase !== 'over') return { role: 'host', code: h.session.code };
  const c = store.get<SavedClient>(CLIENT_KEY);
  if (c?.code) return { role: 'client', code: c.code };
  return null;
};

export const forgetRooms = () => {
  store.del(HOST_KEY);
  store.del(CLIENT_KEY);
};

const random32 = () => crypto.getRandomValues(new Uint8Array(32));

// ───────────────────────────── Host ─────────────────────────────

export class HostRuntime implements Runtime {
  role = 'host' as const;
  private relay: Relay;
  private peers = new Map<string, { pub: string; key: Promise<CryptoKey>; lastId: number }>();
  private seq = Date.now();
  private timer: ReturnType<typeof setInterval>;
  private heartbeat: ReturnType<typeof setInterval>;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private state: NetState = { status: 'connecting', relays: 0, view: null, viewAt: 0 };
  private t: ReturnType<typeof topics>;

  private constructor(
    private s: Session,
    private keys: KeyPair,
    private listener: Listener,
    peers: SavedHost['peers'] = {},
  ) {
    this.t = topics(s.code);
    for (const [pid, p] of Object.entries(peers)) this.peers.set(pid, { pub: p.pub, key: sharedKey(keys, p.pub), lastId: p.lastId });
    this.relay = new Relay(
      (topic, payload) => topic === this.t.up && this.onUp(payload),
      (n) => {
        this.state = { ...this.state, relays: n, status: n > 0 ? 'live' : 'connecting' };
        this.emitLocal();
        if (n > 0) this.flush();
      },
    );
    this.relay.subscribe(this.t.up);
    this.publishInfo();
    this.timer = setInterval(() => {
      if (tick(this.s, this.env())) this.changed();
    }, 200);
    this.heartbeat = setInterval(() => this.flush(), 2500);
    this.changed();
  }

  get code() {
    return this.s.code;
  }

  static async create(name: string, listener: Listener): Promise<HostRuntime> {
    const keys = await generateKeys();
    const hostId = randomHex(8);
    const s = createSession(newRoomCode(), hostId, name, { now: Date.now(), random32 });
    store.del(CLIENT_KEY);
    return new HostRuntime(s, keys, listener);
  }

  static async resume(listener: Listener): Promise<HostRuntime | null> {
    const saved = store.get<SavedHost>(HOST_KEY);
    if (!saved) return null;
    const keys = await restoreKeys(saved.priv, saved.pub);
    // Clocks restart from now so nobody is timed out by the reload itself.
    const s = saved.session;
    if (s.meta?.turnDeadline) s.meta.turnDeadline = Date.now() + s.settings.turnSecs * 1000;
    for (const p of s.players) p.lastSeen = Date.now();
    return new HostRuntime(s, keys, listener, saved.peers);
  }

  private env(): Env {
    return { now: Date.now(), random32 };
  }

  private publishInfo() {
    this.relay.publishWhenReady(this.t.info, JSON.stringify({ v: 1, pub: this.keys.pub, at: Date.now() }), true);
  }

  private async onUp(payload: string) {
    let msg: { pid: string; pub?: string; iv: string; ct: string };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof msg.pid !== 'string' || msg.pid.length > 40) return;
    let peer = this.peers.get(msg.pid);
    if (!peer || (msg.pub && msg.pub !== peer.pub)) {
      if (!msg.pub) return;
      // A known player id may only re-key while not seated (stops seat hijacking).
      if (peer && this.s.players.some((p) => p.id === msg.pid && !p.left && p.connected)) return;
      peer = { pub: msg.pub, key: sharedKey(this.keys, msg.pub), lastId: 0 };
      this.peers.set(msg.pid, peer);
    }
    let body: { id: number; intent: ClientIntent; ent?: string };
    try {
      body = await open(await peer.key, msg);
    } catch {
      return;
    }
    if (typeof body.id !== 'number' || body.id <= peer.lastId) return; // duplicate via another broker, or replay
    peer.lastId = body.id;
    if (body.ent) absorbEntropy(this.s, body.ent);
    if (body.intent?.type === 'join' && this.s.phase === 'over' && !this.s.players.some((p) => p.id === msg.pid)) {
      this.sendTo(msg.pid, { closed: true });
      return;
    }
    handleClient(this.s, msg.pid, body.intent, this.env());
    this.changed();
  }

  private changed() {
    this.emitLocal();
    if (!this.pending) this.pending = setTimeout(() => this.flush(), 40);
    if (!this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 400);
  }

  private save() {
    const peers: SavedHost['peers'] = {};
    for (const [pid, p] of this.peers) peers[pid] = { pub: p.pub, lastId: p.lastId };
    store.set(HOST_KEY, { session: this.s, priv: this.keys.privJwk, pub: this.keys.pub, peers } satisfies SavedHost);
  }

  private emitLocal() {
    this.state = { ...this.state, view: project(this.s, this.s.hostId, Date.now()), viewAt: performance.now() };
    this.listener(this.state);
  }

  private async sendTo(pid: string, data: unknown) {
    const peer = this.peers.get(pid);
    if (!peer) return;
    const box = await seal(await peer.key, { seq: ++this.seq, ...(data as object) });
    this.relay.publish(this.t.down(pid), JSON.stringify(box));
  }

  private flush() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    const now = Date.now();
    for (const p of this.s.players) {
      if (p.id === this.s.hostId || !this.peers.has(p.id)) continue;
      if (p.left && now - p.lastSeen > 60000) continue;
      this.sendTo(p.id, { view: project(this.s, p.id, now) });
    }
  }

  send(i: ClientIntent) {
    absorbEntropy(this.s, randomHex(16));
    handleClient(this.s, this.s.hostId, i, this.env());
    this.changed();
  }

  host(i: HostIntent) {
    handleHost(this.s, i, this.env());
    this.changed();
  }

  wake() {
    this.relay.nudge();
    this.publishInfo();
    this.flush();
  }

  async leave() {
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    for (const p of this.s.players) if (p.id !== this.s.hostId) await this.sendTo(p.id, { closed: true });
    store.del(HOST_KEY);
    await this.relay.clearAndEnd(this.t.info);
    this.state = { ...this.state, status: 'closed' };
  }
}

// ──────────────────────────── Client ────────────────────────────

export class ClientRuntime implements Runtime {
  role = 'client' as const;
  private relay: Relay;
  private hostKey: Promise<CryptoKey> | null = null;
  private hostPub: string | null = null;
  private lastSeq = 0;
  private msgId = Date.now() * 100;
  private state: NetState = { status: 'connecting', relays: 0, view: null, viewAt: 0 };
  private lastDown = 0;
  private pinger: ReturnType<typeof setInterval>;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private t: ReturnType<typeof topics>;

  private constructor(
    readonly code: string,
    private pid: string,
    private name: string,
    private keys: KeyPair,
    private listener: Listener,
  ) {
    this.t = topics(code);
    this.relay = new Relay(
      (topic, payload) => this.onDown(topic, payload),
      (n) => {
        this.set({ relays: n });
        if (n > 0 && this.state.status === 'connecting') {
          this.set({ status: 'searching' });
          this.searchTimer ??= setTimeout(() => {
            if (!this.hostPub) this.set({ status: 'notfound' });
          }, 9000);
        }
      },
    );
    this.relay.subscribe(this.t.info);
    this.relay.subscribe(this.t.down(pid));
    this.pinger = setInterval(() => {
      if (!this.hostKey) return;
      this.send({ type: this.state.view ? 'ping' : 'join', name: this.name } as ClientIntent);
      if (this.state.view && this.lastDown && Date.now() - this.lastDown > 9000 && this.state.status === 'live') this.set({ status: 'hostAway' });
    }, 3000);
  }

  static async join(code: string, name: string, listener: Listener): Promise<ClientRuntime> {
    const saved = store.get<SavedClient>(CLIENT_KEY);
    let pid: string;
    let keys: KeyPair;
    if (saved && saved.code === code) {
      pid = saved.pid;
      keys = await restoreKeys(saved.priv, saved.pub);
    } else {
      pid = randomHex(8);
      keys = await generateKeys();
    }
    store.set(CLIENT_KEY, { code, pid, name, priv: keys.privJwk, pub: keys.pub } satisfies SavedClient);
    store.del(HOST_KEY);
    return new ClientRuntime(code, pid, name, keys, listener);
  }

  static async resume(listener: Listener): Promise<ClientRuntime | null> {
    const saved = store.get<SavedClient>(CLIENT_KEY);
    if (!saved) return null;
    return ClientRuntime.join(saved.code, saved.name, listener);
  }

  private set(p: Partial<NetState>) {
    this.state = { ...this.state, ...p };
    this.listener(this.state);
  }

  private async onDown(topic: string, payload: string) {
    if (topic === this.t.info) {
      if (!payload) {
        if (!this.state.view) this.set({ status: 'notfound' });
        return;
      }
      try {
        const info = JSON.parse(payload) as { pub: string };
        if (info.pub && info.pub !== this.hostPub) {
          this.hostPub = info.pub;
          this.hostKey = sharedKey(this.keys, info.pub);
          this.send({ type: 'join', name: this.name });
        }
      } catch {
        /* ignore */
      }
      return;
    }
    if (!this.hostKey) return;
    let body: { seq: number; view?: View; closed?: boolean };
    try {
      body = await open(await this.hostKey, JSON.parse(payload));
    } catch {
      return;
    }
    if (body.seq <= this.lastSeq) return;
    this.lastSeq = body.seq;
    this.lastDown = Date.now();
    if (body.closed) {
      if (this.state.view?.phase !== 'over') this.set({ status: 'closed' });
      return;
    }
    if (body.view) this.set({ view: body.view, viewAt: performance.now(), status: 'live' });
  }

  send(intent: ClientIntent) {
    const key = this.hostKey;
    if (!key) return;
    const id = Math.max(++this.msgId, Date.now() * 100);
    this.msgId = id;
    key.then(async (k) => {
      const box = await seal(k, { id, intent, ent: randomHex(16) });
      this.relay.publish(this.t.up, JSON.stringify({ pid: this.pid, pub: this.keys.pub, ...box }));
    });
  }

  host() {}

  wake() {
    this.relay.nudge();
    if (this.hostKey) this.send({ type: 'ping' });
  }

  async leave() {
    if (this.state.view && this.state.view.phase !== 'over') this.send({ type: 'leave' });
    clearInterval(this.pinger);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    store.del(CLIENT_KEY);
    await new Promise((r) => setTimeout(r, 400));
    this.relay.end();
  }
}
