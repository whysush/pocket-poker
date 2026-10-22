import { useState } from 'react';
import type { View } from '../game/types';
import { verifyHistory } from '../game/session';
import { useApp } from '../store';
import { PlayingCard, fmt } from './common';

const BLINDS: [number, number][] = [
  [1, 2],
  [2, 5],
  [5, 10],
  [10, 20],
  [25, 50],
];
const TIMERS = [15, 30, 60, 0];
const LOANS = [250, 500, 1000];

export function SettingsEditor({ view, onDone }: { view: View; onDone: () => void }) {
  const runtime = useApp((s) => s.runtime);
  const [sb, setSb] = useState(view.settings.sb);
  const [bb, setBb] = useState(view.settings.bb);
  const [t, setT] = useState(view.settings.turnSecs);
  return (
    <>
      <div className="sheet-title">Table settings</div>
      <div className="label">Blinds</div>
      <div className="seg">
        {BLINDS.map(([s, b]) => (
          <button
            key={b}
            className={sb === s && bb === b ? 'on' : ''}
            onClick={() => {
              setSb(s);
              setBb(b);
            }}
          >
            {s}/{b}
          </button>
        ))}
      </div>
      <div className="label">Decision timer</div>
      <div className="seg">
        {TIMERS.map((x) => (
          <button key={x} className={t === x ? 'on' : ''} onClick={() => setT(x)}>
            {x ? `${x}s` : 'Off'}
          </button>
        ))}
      </div>
      <div className="label">Buy-in is fixed at {fmt(view.buyIn)}. Players can borrow more from the host.</div>
      <div className="sheet-actions" style={{ marginTop: 18 }}>
        <button className="btn btn-dark" onClick={onDone}>
          Cancel
        </button>
        <button
          className="btn btn-gold"
          onClick={() => {
            runtime?.host({ type: 'settings', settings: { sb, bb, turnSecs: t } });
            onDone();
          }}
        >
          Save
        </button>
      </div>
    </>
  );
}

type Page = 'main' | 'loan' | 'scores' | 'history' | 'settings' | 'players' | 'leave';

export function MenuSheet({ view, onClose }: { view: View; onClose: () => void }) {
  const { runtime, muted, toggleMute, leave } = useApp();
  const [page, setPage] = useState<Page>('main');
  const isHost = view.you === view.hostId;
  const me = view.players.find((p) => p.id === view.you)!;
  const send = runtime!.send.bind(runtime);

  if (page === 'settings') return <SettingsEditor view={view} onDone={() => setPage('main')} />;

  if (page === 'loan') return <LoanPage view={view} isHost={isHost} onDone={() => setPage('main')} />;

  if (page === 'leave')
    return (
      <>
        <div className="sheet-title">{isHost ? 'End the game for everyone?' : 'Leave the table?'}</div>
        <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
          {isHost
            ? 'You are hosting. The game ends after the current hand and everyone sees the final scoreboard.'
            : `You cash out with ${fmt(me.stack)} chips. Your result stays on the scoreboard.`}
        </p>
        <div className="sheet-actions">
          <button className="btn btn-dark" onClick={() => setPage('main')}>
            Cancel
          </button>
          <button
            className="btn btn-fold"
            onClick={() => {
              onClose();
              if (isHost) runtime!.host({ type: 'forceEnd' });
              else leave();
            }}
          >
            {isHost ? 'End game' : 'Leave'}
          </button>
        </div>
      </>
    );

  if (page === 'scores')
    return (
      <>
        <div className="sheet-title">Scoreboard so far</div>
        {(view.ledger ?? []).map((r) => (
          <div className="menu-item" key={r.id}>
            <div>
              <div>{r.id === view.you ? 'You' : r.name}</div>
              <div className="sub num">
                In {fmt(r.buyIn + r.loans)} · Now {fmt(r.out)}
              </div>
            </div>
            <span className={`num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`} style={{ fontWeight: 700 }}>
              {r.net > 0 ? '+' : r.net < 0 ? '−' : ''}
              {fmt(Math.abs(r.net))}
            </span>
          </div>
        ))}
        <button className="btn btn-dark btn-block" style={{ marginTop: 14 }} onClick={() => setPage('main')}>
          Back
        </button>
      </>
    );

  if (page === 'history')
    return (
      <>
        <div className="sheet-title">Hand history</div>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
          Every deck is shuffled with ChaCha20 from a seed mixed with randomness from all players' phones. Its fingerprint is published before
          the deal and the seed revealed after — tap a hand to check it.
        </p>
        {view.history.length === 0 ? <div className="muted">No hands yet.</div> : null}
        {view.history.map((h) => (
          <HistoryRow key={h.no} h={h} />
        ))}
        {view.hand && !view.hand.done ? (
          <div style={{ marginTop: 12 }}>
            <div className="sub muted" style={{ fontSize: 12 }}>
              Hand #{view.hand.no} fingerprint
            </div>
            <div className="mono">{view.hand.commit}</div>
          </div>
        ) : null}
        <button className="btn btn-dark btn-block" style={{ marginTop: 14 }} onClick={() => setPage('main')}>
          Back
        </button>
      </>
    );

  if (page === 'players')
    return (
      <>
        <div className="sheet-title">Players</div>
        {view.players
          .filter((p) => !p.left)
          .map((p) => (
            <div className="menu-item" key={p.id}>
              <div style={{ minWidth: 0 }}>
                <div>{p.id === view.you ? 'You' : p.name}</div>
                <div className="sub num">
                  {fmt(p.stack)} chips{p.loans ? ` · borrowed ${fmt(p.loans)}` : ''}
                  {!p.connected ? ' · offline' : p.sittingOut ? ' · away' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="pill" onClick={() => runtime!.host({ type: 'giveLoan', playerId: p.id, amount: view.buyIn })}>
                  Lend {fmt(view.buyIn)}
                </button>
                {!p.isHost ? (
                  <button className="pill" style={{ color: 'var(--fold)' }} onClick={() => runtime!.host({ type: 'kick', playerId: p.id })}>
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        <button className="btn btn-dark btn-block" style={{ marginTop: 14 }} onClick={() => setPage('main')}>
          Back
        </button>
      </>
    );

  const iVoted = me.voted;
  return (
    <>
      <div className="sheet-title num">
        {fmt(me.stack)} chips
        <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
          {' '}
          · in for {fmt(view.buyIn + me.loans)}
        </span>
      </div>
      <div className="menu-list">
        <button className="menu-item" onClick={() => setPage('loan')}>
          <span>{isHost ? 'Take a loan' : 'Ask host for a loan'}</span>
          <span className="sub">{view.myPendingLoan ? `Requested ${fmt(view.myPendingLoan)}` : me.loans ? `Borrowed ${fmt(me.loans)}` : ''}</span>
        </button>
        <button className="menu-item" onClick={() => send({ type: 'vote', value: !iVoted })}>
          <span>{iVoted ? 'Withdraw vote to end' : 'Vote to end game'}</span>
          <span className={`sub num ${iVoted ? 'pos' : ''}`}>
            {view.votes}/{view.votesNeeded} voted
          </span>
        </button>
        <button className="menu-item" onClick={() => send({ type: 'sitOut', value: !me.sittingOut })}>
          <span>{me.sittingOut ? "I'm back" : 'Sit out next hands'}</span>
          <span className="sub">{me.sittingOut ? 'Sitting out' : ''}</span>
        </button>
        <button className="menu-item" onClick={() => setPage('scores')}>
          <span>Scoreboard</span>
          <span className="sub">›</span>
        </button>
        <button className="menu-item" onClick={() => setPage('history')}>
          <span>Hand history &amp; fairness</span>
          <span className="sub">›</span>
        </button>
        {isHost ? (
          <>
            {view.loanRequests.length ? (
              <div className="menu-item" style={{ flexWrap: 'wrap' }}>
                <span>Loan requests</span>
                <LoanRequests view={view} />
              </div>
            ) : null}
            <button className="menu-item" onClick={() => setPage('players')}>
              <span>Players</span>
              <span className="sub">Lend · remove</span>
            </button>
            <button className="menu-item" onClick={() => setPage('settings')}>
              <span>Table settings</span>
              <span className="sub num">
                {view.settings.sb}/{view.settings.bb}
              </span>
            </button>
          </>
        ) : null}
        <button className="menu-item" onClick={toggleMute}>
          <span>Sound</span>
          <span className="sub">{muted ? 'Off' : 'On'}</span>
        </button>
        <button className="menu-item danger" onClick={() => setPage('leave')}>
          {isHost ? 'End game now' : 'Leave table'}
        </button>
      </div>
      <div className="fine" style={{ marginTop: 10 }}>
        Room {view.code} · Play chips only
      </div>
    </>
  );
}

function LoanPage({ view, isHost, onDone }: { view: View; isHost: boolean; onDone: () => void }) {
  const runtime = useApp((s) => s.runtime);
  const [amt, setAmt] = useState(view.buyIn);
  return (
    <>
      <div className="sheet-title">{isHost ? 'Take a loan' : 'Ask the host for a loan'}</div>
      <p className="muted" style={{ fontSize: 14, marginTop: -4 }}>
        Loans are added to what you put in. At the end they're counted against your result.
      </p>
      <div className="seg" style={{ marginBottom: 18 }}>
        {LOANS.map((x) => (
          <button key={x} className={amt === x ? 'on' : ''} onClick={() => setAmt(x)}>
            {fmt(x)}
          </button>
        ))}
      </div>
      {view.myPendingLoan ? (
        <div className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
          Waiting for the host to approve {fmt(view.myPendingLoan)}…
        </div>
      ) : null}
      <div className="sheet-actions">
        <button
          className="btn btn-dark"
          onClick={() => {
            if (view.myPendingLoan) runtime?.send({ type: 'cancelLoan' });
            onDone();
          }}
        >
          {view.myPendingLoan ? 'Cancel ask' : 'Back'}
        </button>
        <button
          className="btn btn-gold"
          onClick={() => {
            runtime?.send({ type: 'loan', amount: amt });
            onDone();
          }}
        >
          {isHost ? `Take ${fmt(amt)}` : `Ask for ${fmt(amt)}`}
        </button>
      </div>
    </>
  );
}

export function LoanRequests({ view }: { view: View }) {
  const runtime = useApp((s) => s.runtime);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 10 }}>
      {view.loanRequests.map((l) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 14 }} className="num">
            {l.name} · {fmt(l.amount)}
          </span>
          <button className="pill" onClick={() => runtime?.host({ type: 'resolveLoan', id: l.id, approve: false })}>
            Decline
          </button>
          <button className="pill" style={{ background: 'var(--gold)', color: 'var(--gold-ink)' }} onClick={() => runtime?.host({ type: 'resolveLoan', id: l.id, approve: true })}>
            Lend
          </button>
        </div>
      ))}
    </div>
  );
}

function HistoryRow({ h }: { h: View['history'][number] }) {
  const [check, setCheck] = useState<null | boolean>(null);
  return (
    <div className="hist">
      <div className="hist-row">
        <span className="muted num" style={{ fontSize: 12 }}>
          #{h.no}
        </span>
        <div className="mini-cards">
          {h.board.length ? h.board.map((c) => <PlayingCard key={c} card={c} w={22} />) : <span className="muted" style={{ fontSize: 12 }}>no board</span>}
        </div>
        {h.yourCards ? (
          <div className="mini-cards" style={{ marginLeft: 6 }}>
            {h.yourCards.map((c) => (
              <PlayingCard key={c} card={c} w={22} />
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 6 }}>
        {h.winners.map((w, i) => (
          <div key={i} className="num" style={{ fontSize: 13 }}>
            {w.name} won {fmt(w.amount)}
            {w.handName ? <span className="muted"> · {w.handName}</span> : null}
          </div>
        ))}
      </div>
      <button className="link" style={{ fontSize: 12, marginTop: 4, minHeight: 32 }} onClick={() => setCheck(verifyHistory(h))}>
        {check === null ? 'Verify shuffle' : check ? '✓ Shuffle verified — seed matches fingerprint and cards' : '✗ Verification failed'}
      </button>
      {check !== null ? <div className="mono">seed {h.seed}</div> : null}
    </div>
  );
}
