import { create } from 'zustand';
import { ClientRuntime, HostRuntime, NetState, Runtime, forgetRooms, normalizeCode, savedRoom } from './net/runtime';

const NAME_KEY = 'pkp.name';
const MUTE_KEY = 'pkp.muted';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

interface AppState {
  name: string;
  muted: boolean;
  runtime: Runtime | null;
  net: NetState | null;
  busy: boolean;
  error: string | null;
  /** Room code from a shared link, waiting for the user to confirm. */
  linkCode: string | null;
  setName(n: string): void;
  toggleMute(): void;
  create(): Promise<void>;
  join(code: string): Promise<void>;
  resume(): Promise<void>;
  leave(): Promise<void>;
  clearError(): void;
}

export const useApp = create<AppState>((set, get) => {
  const listener = (net: NetState) => set({ net });
  const fail = (e: unknown) => set({ busy: false, error: e instanceof Error ? e.message : String(e) });
  return {
    name: read(NAME_KEY) ?? '',
    muted: read(MUTE_KEY) === '1',
    runtime: null,
    net: null,
    busy: false,
    error: null,
    linkCode: (() => {
      const q = new URLSearchParams(location.search).get('room') ?? new URLSearchParams(location.hash.slice(1)).get('room');
      return q ? normalizeCode(q) : null;
    })(),
    setName(n) {
      const name = n.trim().slice(0, 16);
      write(NAME_KEY, name);
      set({ name });
    },
    toggleMute() {
      const muted = !get().muted;
      write(MUTE_KEY, muted ? '1' : '0');
      set({ muted });
    },
    async create() {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        const rt = await HostRuntime.create(get().name, listener);
        set({ runtime: rt, busy: false, linkCode: null });
      } catch (e) {
        fail(e);
      }
    },
    async join(raw) {
      const code = normalizeCode(raw);
      if (code.length !== 6) {
        set({ error: 'Room codes have 6 characters' });
        return;
      }
      if (get().busy) return;
      set({ busy: true, error: null, net: null });
      try {
        const rt = await ClientRuntime.join(code, get().name, listener);
        set({ runtime: rt, busy: false, linkCode: null });
      } catch (e) {
        fail(e);
      }
    },
    async resume() {
      const saved = savedRoom();
      if (!saved || get().runtime) return;
      try {
        const rt = saved.role === 'host' ? await HostRuntime.resume(listener) : await ClientRuntime.resume(listener);
        if (rt) set({ runtime: rt });
      } catch {
        forgetRooms();
      }
    },
    async leave() {
      const rt = get().runtime;
      set({ runtime: null, net: null });
      if (location.search || location.hash) history.replaceState(null, '', location.pathname);
      await rt?.leave().catch(() => {});
      forgetRooms();
    },
    clearError() {
      set({ error: null });
    },
  };
});

export const useView = () => useApp((s) => s.net?.view ?? null);
