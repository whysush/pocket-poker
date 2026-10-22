import { useState } from 'react';
import { useApp } from '../store';
import { Sheet } from './common';
import { unlockAudio } from './sound';
import { normalizeCode } from '../net/runtime';

export function Home() {
  const { name, setName, create, join, busy, error, linkCode, clearError } = useApp();
  const [code, setCode] = useState(linkCode ?? '');
  const [askName, setAskName] = useState<null | 'create' | 'join' | 'edit'>(null);
  const [draft, setDraft] = useState(name);

  const go = (what: 'create' | 'join', n = name) => {
    unlockAudio();
    clearError();
    if (!n) {
      setDraft('');
      setAskName(what);
      return;
    }
    if (what === 'create') create();
    else join(code);
  };

  const saveName = () => {
    const n = draft.trim();
    if (!n) return;
    setName(n);
    const what = askName;
    setAskName(null);
    if (what === 'create' || what === 'join') go(what, n);
  };

  return (
    <div className="screen">
      <div className="home-hero">
        <div className="logo-felt" aria-hidden />
        <h1 className="home-title">Pocket Poker</h1>
        <div className="muted" style={{ fontSize: 15 }}>
          Poker with friends
        </div>
      </div>
      <form
        className="home-actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) go('join');
        }}
      >
        <button type="button" className="btn btn-gold btn-block" disabled={busy} onClick={() => go('create')}>
          Create game
        </button>
        <div className="join-row">
          <input
            className="field"
            placeholder="Room code"
            value={code}
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-label="Room code"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <button type="submit" className="btn btn-dark" disabled={busy || code.length !== 6}>
            Join
          </button>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="fine">
          Play chips only
          {name ? (
            <>
              {' · '}
              <button
                type="button"
                className="muted"
                style={{ fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3 }}
                onClick={() => {
                  setDraft(name);
                  setAskName('edit');
                }}
              >
                {name}
              </button>
            </>
          ) : null}
        </div>
      </form>

      <Sheet open={askName !== null} onClose={() => setAskName(null)}>
        <h3>What should friends call you?</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveName();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}
        >
          <input
            className="field"
            style={{ letterSpacing: 0 }}
            placeholder="Your name"
            autoFocus
            maxLength={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn-gold btn-block" disabled={!draft.trim()}>
            {askName === 'create' ? 'Create game' : askName === 'join' ? 'Join game' : 'Save'}
          </button>
        </form>
      </Sheet>
    </div>
  );
}
