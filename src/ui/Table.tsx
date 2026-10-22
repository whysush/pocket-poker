import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Legal } from '../engine/holdem';
import { heroHandName } from '../game/session';
import type { PlayerView, View } from '../game/types';
import { useApp } from '../store';
import { MenuIcon, PlayingCard, Sheet, fmt, useLandscape, useNow } from './common';
import { LoanRequests, MenuSheet } from './Menu';
import { buzz, play } from './sound';

type Pre = null | 'checkFold' | 'check' | 'callAny';

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Table({ view }: { view: View }) {
  const runtime = useApp((s) => s.runtime)!;
  const net = useApp((s) => s.net)!;
  const landscape = useLandscape();
  const now = useNow(200);
  const [menu, setMenu] = useState(false);
  const [raise, setRaise] = useState(false);
  const [pre, setPre] = useState<Pre>(null);
  // Lock the buttons after acting until the host's next update arrives.
  const [sent, setSent] = useState<{ turn: number; at: number } | null>(null);
  const me = view.players.find((p) => p.id === view.you)!;
  const hand = view.hand;
  // …but unlock after a few seconds in case the message was lost on the way.
  const locked = !!sent && !!hand && sent.turn === hand.turnId && now - sent.at < 3500;
  const legal = view.legal && !locked ? view.legal : null;
  const isHost = view.you === view.hostId;

  // Turn clock, from the time the view arrived.
  const turnLeft = hand?.turnLeftMs != null ? Math.max(0, hand.turnLeftMs - (now - net.viewAt)) : null;
  const turnFrac = turnLeft != null && hand!.turnTotalMs ? Math.min(1, turnLeft / hand!.turnTotalMs) : null;
  const nextIn = hand?.nextHandInMs != null ? Math.max(0, hand.nextHandInMs - (now - net.viewAt)) : null;

  const act = (action: 'fold' | 'check' | 'call' | 'raise', to?: number) => {
    if (!hand) return;
    if (locked) return;
    setSent({ turn: hand.turnId, at: performance.now() });
    runtime.send({ type: 'action', action, to, handNo: hand.no, turnId: hand.turnId });
    setRaise(false);
    setPre(null);
  };

  // Pre-actions fire as soon as it becomes our turn.
  useEffect(() => {
    if (!legal || !pre) return;
    if (pre === 'checkFold') act(legal.canCheck ? 'check' : 'fold');
    else if (pre === 'check') {
      if (legal.canCheck) act('check');
      else setPre(null);
    }
    else if (pre === 'callAny') act(legal.canCheck ? 'check' : 'call');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legal]);
  // A bet in front of us cancels a plain "check" pre-action.
  useEffect(() => {
    if (pre === 'check' && hand && hand.currentBet > me.bet) setPre(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.currentBet]);
  useEffect(() => setPre(null), [hand?.no]);
  useEffect(() => {
    if (!legal) setRaise(false);
  }, [legal]);

  useSounds(view);

  // Keyboard shortcuts on desktop.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!legal || menu || raise || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if (key === 'f') act('fold');
      else if (key === 'c') act(legal.canCheck ? 'check' : 'call');
      else if (key === 'r' && legal.canRaise) setRaise(true);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const heroCards = me.cards;
  const result = hand?.result ?? null;
  const winCards = result && !result.byFold ? new Set(result.winningCards) : null;
  const heroWon = !!result?.winners.some((w) => w.id === me.id);
  const liveName = hand && heroCards && !me.folded ? heroHandName(heroCards, hand.board) : null;

  const heroBlock = (
    <div className="hero">
      <div className="hero-cards">
        {heroCards ? (
          heroCards.map((c, i) => (
            <PlayingCard
              key={`${hand?.no}-${c}`}
              card={c}
              w={landscape ? 50 : 74}
              dim={me.folded}
              win={heroWon && !!winCards?.has(c)}
              delay={i * 0.08}
            />
          ))
        ) : (
          <div className="hero-note" style={{ minHeight: landscape ? 0 : 60 }} />
        )}
      </div>
      <div className="hero-line num">
        <b>{fmt(me.stack)}</b>
        {me.folded ? ' · Folded' : liveName && !result ? ` · ${shortLabel(liveName)}` : result && me.handName && !me.folded ? ` · ${shortLabel(me.handName)}` : ''}
        {me.bet && !landscape ? null : null}
      </div>
    </div>
  );

  const actionZone = (
    <div className="action-zone">
      <ActionArea
        view={view}
        me={me}
        legal={legal}
        pre={pre}
        setPre={setPre}
        act={act}
        openRaise={() => setRaise(true)}
        turnFrac={legal ? turnFrac : null}
        nextIn={nextIn}
        landscape={landscape}
      />
    </div>
  );

  const head = (
    <div className="table-head num">
      <span>
        {view.code} · {fmt(view.settings.sb)}/{fmt(view.settings.bb)}
      </span>
      {!landscape ? <MenuButton onClick={() => setMenu(true)} dot={isHost && view.loanRequests.length > 0} /> : null}
    </div>
  );

  return (
    <div className={`screen wide table-screen ${landscape ? 'landscape' : ''}`}>
      {landscape ? (
        <>
          <div className="table-col">
            {head}
            <Felt view={view} turnFrac={turnFrac} landscape />
            {heroBlock}
            <div className="menu-corner">
              <MenuButton onClick={() => setMenu(true)} dot={isHost && view.loanRequests.length > 0} />
            </div>
          </div>
          {actionZone}
        </>
      ) : (
        <>
          {head}
          <Felt view={view} turnFrac={turnFrac} landscape={false} />
          {heroBlock}
          {actionZone}
        </>
      )}

      <Toasts view={view} />
      {isHost && view.loanRequests.length > 0 && !menu ? (
        <motion.div className="loan-card" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Loan request</div>
          <LoanRequests view={view} />
        </motion.div>
      ) : null}

      <Sheet open={raise && !!legal} onClose={() => setRaise(false)}>
        {legal && hand ? <RaiseSheet view={view} me={me} legal={legal} onCancel={() => setRaise(false)} onRaise={(to) => act('raise', to)} /> : null}
      </Sheet>
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <MenuSheet view={view} onClose={() => setMenu(false)} />
      </Sheet>
    </div>
  );
}

const shortLabel = (name: string) => {
  // "Full house, kings full of sevens" → "Full house" under the hero cards (as in the design).
  if (name.startsWith('Pair of') || name.endsWith(' high') && !name.includes(',')) return name;
  return name.split(',')[0];
};

function MenuButton({ onClick, dot }: { onClick: () => void; dot: boolean }) {
  return (
    <button className="icon-btn" aria-label="Menu" onClick={onClick}>
      <MenuIcon />
      {dot ? <span className="badge-dot" /> : null}
    </button>
  );
}

// ───────────────────────── Felt & seats ─────────────────────────

function Felt({ view, turnFrac, landscape }: { view: View; turnFrac: number | null; landscape: boolean }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const hand = view.hand;
  const result = hand?.result ?? null;
  const me = view.players.find((p) => p.id === view.you)!;

  // Everyone except the hero, in seat order starting from the hero's left.
  const others = useMemo(() => {
    const seated = view.players.filter((p) => !p.left || p.inHand);
    const i = seated.findIndex((p) => p.id === view.you);
    return [...seated.slice(i + 1), ...seated.slice(0, Math.max(0, i))];
  }, [view.players, view.you]);

  if (!w || !h) return <div className="table-area" ref={ref} />;

  const n = others.length;
  const many = n >= 5;
  let fw: number, fh: number, cx: number, cy: number;
  if (landscape) {
    fw = Math.min(w * 0.8, h * 1.75);
    fh = Math.min(h * 0.68, fw * 0.62);
    cx = w / 2;
    cy = h * 0.46;
  } else {
    fh = Math.min(h - 56, w * 1.42);
    fw = Math.min(w * (many ? 0.74 : 0.8), fh * 0.76);
    cx = w / 2;
    cy = h / 2 + 4;
  }
  const rx = fw / 2;
  const ry = fh / 2;
  const av = n <= 5 ? 44 : n <= 8 ? 40 : n <= 12 ? 34 : n <= 18 ? 30 : 26;
  // Small tables use the top arc (as in the design); big tables wrap around the whole oval.
  const span = many ? (landscape ? 300 : 296) : landscape ? 250 : 236;
  const startDeg = 90 + span / 2;
  const seats = others.map((p, i) => {
    const deg = n === 1 ? 90 : startDeg - (i + 0.5) * (span / n);
    const t = (deg * Math.PI) / 180;
    const kx = many ? 1.12 : landscape ? 1.06 : 1.02;
    const ky = landscape ? 1.08 : 1.02;
    let x = cx + rx * kx * Math.cos(t);
    let y = cy - ry * ky * Math.sin(t);
    x = Math.max(av / 2 + 8, Math.min(w - av / 2 - 8, x));
    y = Math.max(av / 2 + (landscape ? 6 : 2), Math.min(h - av / 2 - 30, y));
    return { p, x, y };
  });
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  const boardW = Math.max(28, Math.min(landscape ? fh * (many ? 0.26 : 0.3) : fw * (many ? 0.135 : 0.155), 58));
  const heroBet = { x: cx, y: cy + ry * (landscape ? 0.6 : 0.68) };
  const dealer = hand ? view.players.find((p) => p.isDealer) : null;
  let dealerPos: { x: number; y: number } | null = null;
  if (dealer) {
    if (dealer.id === me.id) dealerPos = { x: cx + Math.min(70, rx * 0.4), y: heroBet.y };
    else {
      const s = seats.find((q) => q.p.id === dealer.id);
      if (s) dealerPos = { x: lerp(s.x, cx, 0.3) + (s.x < cx ? 18 : -18), y: lerp(s.y, cy, 0.3) + 16 };
    }
  }

  const winners = result?.winners ?? [];
  const heroWin = winners.find((x) => x.id === me.id);
  let winLine = '';
  if (result) {
    if (winners.length > 1) winLine = heroWin ? `You split ${fmt(heroWin.amount)}` : 'Split pot';
    else if (heroWin) winLine = `You win ${fmt(heroWin.amount)}`;
    else if (winners[0]) winLine = `${view.players.find((p) => p.id === winners[0].id)?.name ?? ''} wins ${fmt(winners[0].amount)}`;
  }
  const winSet = result && !result.byFold ? new Set(result.winningCards) : null;
  const board = hand?.board ?? [];

  return (
    <div className="table-area" ref={ref}>
      <div className="felt" style={{ left: cx - rx, top: cy - ry, width: fw, height: fh }} />
      <div className="felt-center" style={{ left: cx, top: cy, ['--board-gap' as string]: `${Math.round(boardW * 0.11)}px` }}>
        {result ? (
          <div className="win-line num">{winLine}</div>
        ) : (
          <div className="pot num">{hand && hand.pot > 0 ? `Pot ${fmt(hand.pot)}` : hand ? '' : view.waitingReason ?? ''}</div>
        )}
        <div className="board">
          {[0, 1, 2, 3, 4].map((i) =>
            board[i] !== undefined ? (
              <PlayingCard key={`${hand!.no}-${board[i]}`} card={board[i]} w={boardW} dim={!!winSet && !winSet.has(board[i])} delay={i < 3 ? i * 0.07 : 0} />
            ) : (
              <PlayingCard key={`slot${i}`} card={null} w={boardW} />
            ),
          )}
        </div>
        <div className="hand-line" style={{ minHeight: 18 }}>
          {result && !result.byFold ? result.handName : ''}
        </div>
      </div>

      {seats.map(({ p, x, y }) => (
        <Seat key={p.id} p={p} x={x} y={y} cx={cx} av={av} side={many && Math.abs(y - cy) < ry * 0.5} toAct={hand?.toActId === p.id} turnFrac={turnFrac} winner={winners.some((q) => q.id === p.id)} showdown={!!result} />
      ))}
      {seats.map(({ p, x, y }) =>
        p.bet > 0 ? (
          <Bet key={'b' + p.id} x={lerp(x, cx, 0.42)} y={lerp(y, cy, 0.42)} amount={p.bet} />
        ) : null,
      )}
      {me.bet > 0 ? <Bet x={heroBet.x} y={heroBet.y} amount={me.bet} /> : null}
      {dealerPos ? (
        <div className="dealer-btn" style={{ left: dealerPos.x, top: dealerPos.y }}>
          D
        </div>
      ) : null}
    </div>
  );
}

function Bet({ x, y, amount }: { x: number; y: number; amount: number }) {
  return (
    <motion.div className="bet num" style={{ left: x, top: y }} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2 }}>
      {fmt(amount)}
    </motion.div>
  );
}

function Seat({
  p,
  x,
  y,
  cx,
  av,
  toAct,
  turnFrac,
  winner,
  showdown,
  side,
}: {
  side: boolean;
  p: PlayerView;
  x: number;
  y: number;
  cx: number;
  av: number;
  toAct: boolean;
  turnFrac: number | null;
  winner: boolean;
  showdown: boolean;
}) {
  const out = !p.inHand || p.folded || p.left || (!p.connected && !p.inHand);
  const right = x < cx; // cards sit on the side facing the middle
  const bw = Math.round(av * 0.42);
  const bh = Math.round(bw * 1.4);
  const r = av / 2 + 3;
  const circ = 2 * Math.PI * r;
  let tag: string | null = null;
  if (p.allIn) tag = 'All-in';
  else if (!p.connected) tag = 'Offline';
  else if (p.sittingOut && !p.inHand) tag = 'Away';
  else if (p.lastAction && p.lastAction !== 'SB' && p.lastAction !== 'BB' && !showdown) tag = p.lastAction;
  if (showdown && winner) tag = `+${fmt(p.won)}`;
  return (
    <div className={`seat ${out && !showdown ? 'out' : ''} ${showdown && !winner && p.inHand ? '' : ''}`} style={{ left: x, top: y, ['--av' as string]: `${av}px` }}>
      {tag ? <div className={`seat-tag ${showdown && winner ? 'gold' : ''}`}>{tag}</div> : null}
      <div className={`avatar ${toAct ? 'turn' : ''}`}>
        {p.initials}
        {toAct && turnFrac != null ? (
          <svg className="timer-ring" width={av + 8} height={av + 8} viewBox={`0 0 ${av + 8} ${av + 8}`}>
            <circle
              cx={av / 2 + 4}
              cy={av / 2 + 4}
              r={r}
              fill="none"
              stroke="var(--gold)"
              strokeWidth="2.5"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - turnFrac)}
              strokeLinecap="round"
              transform={`rotate(-90 ${av / 2 + 4} ${av / 2 + 4})`}
              style={{ transition: 'stroke-dashoffset 0.2s linear' }}
            />
          </svg>
        ) : null}
        {p.inHand && !p.cards && !p.folded ? (
          <div className="seat-cards" style={{ left: right ? av * 0.62 : -bw * 1.25, top: -av * 0.12, width: bw * 1.6, height: bh }}>
            <div className="card-back" style={{ width: bw, height: bh, left: 0, top: 0, transform: 'rotate(-6deg)' }} />
            <div className="card-back" style={{ width: bw, height: bh, left: bw * 0.45, top: 0, transform: 'rotate(5deg)' }} />
          </div>
        ) : null}
        {p.inHand && p.folded && !showdown ? (
          <div className="seat-cards" style={{ left: right ? av * 0.62 : -bw * 1.25, top: -av * 0.12, width: bw * 1.6, height: bh }}>
            <div className="card-back dull" style={{ width: bw, height: bh, left: 0, top: 0, transform: 'rotate(-6deg)' }} />
            <div className="card-back dull" style={{ width: bw, height: bh, left: bw * 0.45, top: 0, transform: 'rotate(5deg)' }} />
          </div>
        ) : null}
        {p.cards && !side ? (
          <div className={`seat-shown ${side ? 'below' : ''}`} style={side ? undefined : { left: right ? av * 0.9 : -av * 1.45, top: -av * 0.05 }}>
            {p.cards.map((c) => (
              <PlayingCard key={c} card={c} w={Math.round(av * 0.62)} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="seat-name">{p.name}</div>
      <div className="seat-stack num">{fmt(p.stack)}</div>
      {p.cards && side ? (
        <div className={`seat-shown ${side ? 'below' : ''}`} style={side ? undefined : { left: right ? av * 0.9 : -av * 1.45, top: -av * 0.05 }}>
            {p.cards.map((c) => (
              <PlayingCard key={c} card={c} w={Math.round(av * 0.62)} />
            ))}
          </div>
      ) : null}
    </div>
  );
}

// ───────────────────────── Actions ─────────────────────────

function ActionArea({
  view,
  me,
  legal,
  pre,
  setPre,
  act,
  openRaise,
  turnFrac,
  nextIn,
  landscape,
}: {
  view: View;
  me: PlayerView;
  legal: Legal | null;
  pre: Pre;
  setPre: (p: Pre) => void;
  act: (a: 'fold' | 'check' | 'call' | 'raise', to?: number) => void;
  openRaise: () => void;
  turnFrac: number | null;
  nextIn: number | null;
  landscape: boolean;
}) {
  const runtime = useApp((s) => s.runtime)!;
  const hand = view.hand;

  if (hand?.done) {
    return (
      <div className="next-hand num">
        {view.endAfterHand ? 'Final hand — scores coming up' : nextIn != null ? `Next hand in ${Math.ceil(nextIn / 1000)}` : ''}
      </div>
    );
  }

  if (legal) {
    const allInCall = legal.callAmount > 0 && legal.callAmount >= me.stack;
    const raiseLabel = legal.minTo === legal.maxTo ? `All-in ${fmt(legal.maxTo)}` : hand!.currentBet === 0 ? 'Bet' : 'Raise';
    const buttons = [
      <button key="f" className="btn btn-fold" onClick={() => act('fold')}>
        Fold
      </button>,
      <button key="c" className="btn btn-dark num" onClick={() => act(legal.canCheck ? 'check' : 'call')}>
        {legal.canCheck ? 'Check' : allInCall ? `All-in ${fmt(legal.callAmount)}` : `Call ${fmt(legal.callAmount)}`}
      </button>,
      <button key="r" className="btn btn-gold num" disabled={!legal.canRaise} onClick={openRaise}>
        {legal.canRaise ? raiseLabel : 'Raise'}
      </button>,
    ];
    return (
      <>
        <div className="timer-bar">
          <div style={{ transform: `scaleX(${turnFrac ?? 1})`, transition: 'transform 0.2s linear' }} />
        </div>
        <div className="actions">{landscape ? buttons.reverse() : buttons}</div>
      </>
    );
  }

  if (hand && me.inHand && !me.folded && !me.allIn) {
    const facing = hand.currentBet > me.bet;
    const toggle = (p: Pre) => setPre(pre === p ? null : p);
    return (
      <>
        <div className="timer-bar" style={{ opacity: 0 }} />
        <div className="actions">
          <button className={`btn pre ${pre === 'checkFold' ? 'on' : ''}`} onClick={() => toggle('checkFold')}>
            {facing ? 'Fold' : 'Check/Fold'}
          </button>
          <button className={`btn pre num ${pre === 'check' ? 'on' : ''}`} disabled={facing} onClick={() => toggle('check')}>
            Check
          </button>
          <button className={`btn pre ${pre === 'callAny' ? 'on' : ''}`} onClick={() => toggle('callAny')}>
            Call any
          </button>
        </div>
      </>
    );
  }

  const broke = me.stack === 0;
  const isHost = view.you === view.hostId;
  let msg = view.waitingReason ?? (hand ? (me.allIn ? 'All-in' : me.folded ? 'Folded — waiting for the hand to finish' : 'Waiting for the next hand') : '');
  if (me.sittingOut && !broke) msg = 'You are sitting out';
  if (broke) msg = view.myPendingLoan ? `Loan of ${fmt(view.myPendingLoan)} requested` : 'Out of chips';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
      <div className="hero-note" style={{ padding: '6px 0' }}>
        {msg}
      </div>
      {broke && !view.myPendingLoan ? (
        <button className="btn btn-gold" onClick={() => runtime.send({ type: 'loan', amount: view.buyIn })}>
          {isHost ? `Take a ${fmt(view.buyIn)} loan` : `Ask host for ${fmt(view.buyIn)}`}
        </button>
      ) : me.sittingOut && !broke ? (
        <button className="btn btn-gold" onClick={() => runtime.send({ type: 'sitOut', value: false })}>
          I'm back
        </button>
      ) : null}
    </div>
  );
}

function RaiseSheet({ view, me, legal, onCancel, onRaise }: { view: View; me: PlayerView; legal: Legal; onCancel: () => void; onRaise: (to: number) => void }) {
  const hand = view.hand!;
  const step = Math.max(1, view.settings.sb);
  const bets = view.players.reduce((s, p) => s + p.bet, 0);
  const potAfterCall = hand.pot + bets + legal.callAmount;
  const clamp = (v: number) => Math.max(legal.minTo, Math.min(legal.maxTo, v));
  const snap = (v: number) => (v >= legal.maxTo ? legal.maxTo : clamp(Math.round(v / step) * step));
  const potTo = (f: number) => snap(hand.currentBet + f * potAfterCall);
  const [to, setTo] = useState(legal.minTo);
  const trackRef = useRef<HTMLDivElement>(null);
  const range = Math.max(1, legal.maxTo - legal.minTo);
  const frac = (to - legal.minTo) / range;
  const quick: [string, number][] = [
    ['½ pot', potTo(0.5)],
    ['¾ pot', potTo(0.75)],
    ['Pot', potTo(1)],
    ['All-in', legal.maxTo],
  ];

  const fromPointer = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setTo(snap(legal.minTo + f * range));
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onRaise(to);
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setTo((v) => snap(v + step));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setTo((v) => snap(v - step));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const allIn = to >= legal.maxTo;
  const verb = hand.currentBet === 0 ? 'Bet' : 'Raise to';
  return (
    <>
      <h3>{verb}</h3>
      <div className="raise-amount num">{fmt(to)}</div>
      <div
        className="slider"
        ref={trackRef}
        role="slider"
        aria-valuemin={legal.minTo}
        aria-valuemax={legal.maxTo}
        aria-valuenow={to}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && fromPointer(e.clientX)}
      >
        <div className="track" />
        <div className="fill" style={{ width: `${frac * 100}%` }} />
        <div className="knob" style={{ left: `${frac * 100}%` }} />
      </div>
      <div className="slider-labels num">
        <span>{fmt(legal.minTo)}</span>
        <span>{fmt(legal.maxTo)}</span>
      </div>
      <div className="quick">
        {quick.map(([label, v]) => (
          <button key={label} className={to === v ? 'on' : ''} onClick={() => setTo(v)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn btn-dark" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-gold num" onClick={() => onRaise(to)}>
          {allIn ? `All-in ${fmt(to)}` : `${verb} ${fmt(to)}`}
        </button>
      </div>
      <div className="fine num" style={{ marginTop: 10 }}>
        Stack {fmt(me.stack)}
      </div>
    </>
  );
}

// ───────────────────────── Toasts & sounds ─────────────────────────

function Toasts({ view }: { view: View }) {
  const seen = useRef<number>(Math.max(0, ...view.feed.map((f) => f.seq)));
  const [items, setItems] = useState<{ seq: number; text: string }[]>([]);
  useEffect(() => {
    const fresh = view.feed.filter((f) => f.seq > seen.current);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((f) => f.seq));
    setItems((xs) => [...xs, ...fresh].slice(-1));
    const ids = fresh.map((f) => f.seq);
    setTimeout(() => setItems((xs) => xs.filter((x) => !ids.includes(x.seq))), 3200);
  }, [view.feed]);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.seq} className="toast" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function useSounds(view: View) {
  const prev = useRef<View | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = view;
    if (!p || !view.hand) return;
    const h = view.hand;
    if (!p.hand || p.hand.no !== h.no) {
      play('deal');
      return;
    }
    if (h.board.length > p.hand.board.length) play('deal');
    for (const pl of view.players) {
      const old = p.players.find((x) => x.id === pl.id);
      if (!old || old.lastAction === pl.lastAction) continue;
      if (pl.lastAction === 'Check') play('check');
      else if (pl.lastAction === 'Fold') play('fold');
      else if (pl.lastAction) play('chip');
    }
    if (view.legal && !p.legal) {
      play('turn');
      buzz(35);
    }
    if (h.result && !p.hand.result && h.result.winners.some((w) => w.id === view.you)) play('win');
  }, [view]);
}
