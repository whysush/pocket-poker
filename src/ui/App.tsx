import { MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { GameOver } from './GameOver';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { Table } from './Table';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Router />
    </MotionConfig>
  );
}

function Router() {
  const { runtime, net, resume, leave } = useApp();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    resume().finally(() => setBooted(true));
  }, [resume]);

  // Phones drop sockets in the background: reconnect as soon as we're visible again.
  useEffect(() => {
    const wake = () => document.visibilityState === 'visible' && useApp.getState().runtime?.wake();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  useWakeLock(!!runtime);

  // Ask before closing the tab while hosting a live game.
  useEffect(() => {
    if (runtime?.role !== 'host' || net?.view?.phase !== 'playing') return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [runtime, net?.view?.phase]);

  if (!booted) return <div className="screen" />;
  if (!runtime) return <Home />;

  const view = net?.view;
  const banner =
    net && net.relays === 0 && view ? 'Offline — reconnecting…' : net?.status === 'hostAway' ? 'Waiting for the host’s phone…' : null;

  if (net?.status === 'notfound' && !view)
    return (
      <Message title="Room not found" body="Check the code with the host. The host's app needs to stay open." action="Back" onAction={leave} />
    );
  if (net?.status === 'closed')
    return <Message title="The host closed this room" body="Thanks for playing." action="Home" onAction={leave} />;
  if (!view) return <Message title={runtime.role === 'host' ? 'Opening room…' : `Joining ${runtime.code}…`} spinner action="Cancel" onAction={leave} />;

  const me = view.players.find((p) => p.id === view.you);
  if (!me || (me.left && view.phase !== 'over'))
    return <Message title="You left the table" body="Your result stays on the scoreboard." action="Home" onAction={leave} />;

  return (
    <>
      {banner ? <div className="banner">{banner}</div> : null}
      {view.phase === 'lobby' ? <Lobby view={view} /> : view.phase === 'playing' ? <Table view={view} /> : <GameOver view={view} />}
    </>
  );
}

function Message({ title, body, action, onAction, spinner }: { title: string; body?: string; action: string; onAction: () => void; spinner?: boolean }) {
  return (
    <div className="screen">
      <div className="center-fill">
        {spinner ? <div className="spinner" /> : <div className="logo-felt" />}
        <div style={{ fontSize: 19, fontWeight: 700 }}>{title}</div>
        {body ? <div className="muted" style={{ fontSize: 14, maxWidth: 280 }}>{body}</div> : null}
      </div>
      <button className="btn btn-dark btn-block" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    };
    get();
    document.addEventListener('visibilitychange', get);
    return () => {
      document.removeEventListener('visibilitychange', get);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
