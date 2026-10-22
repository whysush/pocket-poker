import { useState } from 'react';
import type { View } from '../game/types';
import { useApp } from '../store';
import { fmt, shareOrCopy } from './common';

const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

export function GameOver({ view }: { view: View }) {
  const { runtime, leave } = useApp();
  const [note, setNote] = useState('');
  const rows = view.ledger ?? [];
  const isHost = view.you === view.hostId;

  const summary = () =>
    [
      `Pocket Poker — ${view.handsPlayed} hands`,
      ...rows.map((r, i) => `${i + 1}. ${r.name}: ${signed(r.net)} (in ${fmt(r.buyIn + r.loans)}${r.loans ? `, loans ${fmt(r.loans)}` : ''} · out ${fmt(r.out)})`),
      'Play chips only',
    ].join('\n');

  return (
    <div className="screen">
      <h1 className="over-title">Game over</h1>
      <div className="muted" style={{ fontSize: 15 }}>
        {view.handsPlayed} hands · Play chips only
      </div>
      <div className="list" style={{ marginTop: 22 }}>
        {rows.map((r, i) => (
          <div className="over-row" key={r.id}>
            <span className="rank">{i + 1}</span>
            <div>
              <div className="who">{r.id === view.you ? 'You' : r.name}</div>
              <div className="io num">
                In {fmt(r.buyIn + r.loans)}
                {r.loans ? ` (${fmt(r.loans)} loan${r.loans > view.buyIn ? 's' : ''})` : ''} · Out {fmt(r.out)}
                {r.left ? ' · left early' : ''}
              </div>
            </div>
            <span className={`net num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`}>{signed(r.net)}</span>
          </div>
        ))}
      </div>
      <div className="fine">{note}</div>
      <div className="two-btns">
        <button
          className="btn btn-dark"
          onClick={async () => {
            const m = await shareOrCopy(summary());
            if (m) {
              setNote(m);
              setTimeout(() => setNote(''), 1600);
            }
          }}
        >
          Share
        </button>
        {isHost ? (
          <button className="btn btn-gold" onClick={() => runtime?.host({ type: 'playAgain' })}>
            Play again
          </button>
        ) : (
          <button className="btn btn-gold" onClick={() => leave()}>
            Done
          </button>
        )}
      </div>
      {isHost ? (
        <button className="text-btn" style={{ alignSelf: 'center', marginTop: 6 }} onClick={() => leave()}>
          Close room
        </button>
      ) : null}
    </div>
  );
}
