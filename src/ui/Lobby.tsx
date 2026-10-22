import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { View } from '../game/types';
import { useApp } from '../store';
import { Sheet, fmt, roomLink, shareOrCopy } from './common';
import { SettingsEditor } from './Menu';

export function Lobby({ view }: { view: View }) {
  const { runtime, leave } = useApp();
  const [qr, setQr] = useState(false);
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState('');
  const isHost = view.you === view.hostId;
  const players = view.players.filter((p) => !p.left);
  const link = roomLink(view.code);

  const flash = (m: string) => {
    if (!m) return;
    setNote(m);
    setTimeout(() => setNote(''), 1600);
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="text-btn" onClick={() => leave()}>
          Leave
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {note}
        </span>
      </div>
      <div className="room-code-label">Room code</div>
      <div className="room-code" aria-label={`Room code ${view.code.split('').join(' ')}`}>
        {view.code}
      </div>
      <div className="row-center">
        <button className="pill" onClick={async () => flash(await shareOrCopy(`Join my Pocket Poker game — code ${view.code}`, link))}>
          Share link
        </button>
        <button className="pill" onClick={() => setQr(true)}>
          QR code
        </button>
      </div>

      <div className="section-head">
        <span>Players</span>
        <span className="muted num" style={{ fontSize: 13, fontWeight: 500 }}>
          {players.length}
        </span>
      </div>
      <div className="list">
        {players.map((p) => (
          <div className="prow" key={p.id}>
            <div className="avatar">{p.initials}</div>
            <div className="grow">{p.id === view.you ? 'You' : p.name}</div>
            <div className="tag">{p.isHost ? 'Host' : !p.connected ? 'Offline' : ''}</div>
            {isHost && !p.isHost ? (
              <button className="tag" style={{ minHeight: 44, padding: '0 4px' }} onClick={() => runtime?.host({ type: 'kick', playerId: p.id })}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {players.length < 2 ? (
          <div className="muted" style={{ fontSize: 13, padding: '16px 0' }}>
            Share the code — anyone can join, on any network.
          </div>
        ) : null}
      </div>

      <div className="lobby-foot num">
        <span>
          Blinds {fmt(view.settings.sb)}/{fmt(view.settings.bb)} · Buy-in {fmt(view.buyIn)}
          {view.settings.turnSecs ? ` · ${view.settings.turnSecs}s` : ''}
        </span>
        {isHost ? (
          <button className="link" style={{ minHeight: 44 }} onClick={() => setEdit(true)}>
            Edit
          </button>
        ) : null}
      </div>
      {isHost ? (
        <button className="btn btn-gold btn-block" style={{ height: 58 }} disabled={players.length < 2} onClick={() => runtime?.host({ type: 'start' })}>
          {players.length < 2 ? 'Waiting for friends…' : 'Start game'}
        </button>
      ) : (
        <button className="btn btn-dark btn-block" style={{ height: 58 }} disabled>
          Waiting for host to start
        </button>
      )}

      <Sheet open={qr} onClose={() => setQr(false)}>
        <h3>Scan to join</h3>
        <QR text={link} />
        <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: '0.14em', fontSize: 22 }}>{view.code}</div>
        <button className="btn btn-dark btn-block" style={{ marginTop: 18 }} onClick={() => setQr(false)}>
          Done
        </button>
      </Sheet>
      <Sheet open={edit} onClose={() => setEdit(false)}>
        <SettingsEditor view={view} onDone={() => setEdit(false)} />
      </Sheet>
    </div>
  );
}

function QR({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, color: { dark: '#15100a', light: '#f4f1ea' } }).then(setSvg, () => setSvg(''));
  }, [text]);
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}
