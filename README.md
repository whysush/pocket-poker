# Pocket Poker

Texas Hold'em with friends, on your phones. Play chips only.

- **Play in a browser (iPhone, Android, desktop):** https://whysush.github.io/pocket-poker/
  On iPhone, tap Share → *Add to Home Screen* to get it full screen like an app.
- **Android app:** download `PocketPoker.apk` from the [latest release](https://github.com/whysush/pocket-poker/releases/latest).

Browser players and app players can sit at the same table.

## How a night works

1. One person taps **Create game**. Their phone becomes the host and runs the table.
2. Friends join with the 6-letter code, the share link or the QR code. They can be on any network:
   the same Wi-Fi, other Wi-Fi or mobile data. There is no player limit. Up to 22 are dealt into a
   hand (a 52-card deck runs out after that) and the rest take turns.
3. Everyone buys in for **500**. Run out of chips? Ask the host for a **loan** from the menu. The
   host approves it and the chips arrive straight away, or after the current hand if you're in it.
   The host can also lend to anyone directly.
4. Blinds and the decision timer are set by the host in the lobby (*Edit*). The buy-in is fixed.
5. The game ends when **every** player has voted *End game* in the menu. The current hand finishes
   first. The scoreboard then shows, for each player, what they put in (buy-in plus loans), what they
   left with, and their net result. The nets always add up to zero.

Keep the host's phone open with the app in front. If the host locks their phone, the table pauses
until they come back, and the game is restored from the host's phone storage. Players who drop out
reconnect to the same seat automatically.

## Under the hood

| Part | Where | Notes |
| --- | --- | --- |
| Poker engine | `src/engine/holdem.ts` | Pure No-Limit Hold'em state machine. Blinds (heads-up rules too), min-raise, incomplete all-in raises, side pots, odd chips, uncalled bets, run-outs |
| Hand evaluator | `src/engine/evaluator.ts` | Best 5 of 7, kickers, readable names ("Full house, kings full of sevens") |
| RNG | `src/engine/rng.ts` | Written from scratch: SHA-256 + ChaCha20 (RFC 8439), rejection sampling, Fisher–Yates |
| Session | `src/game/session.ts` | Seats, buy-ins, loans, votes, timers, per-player views that never contain other players' hole cards |
| Network | `src/net/` | Host-authoritative. Messages go through free public MQTT brokers over secure WebSockets. Each player is end-to-end encrypted with the host (ECDH P-256 → AES-GCM) |
| UI | `src/ui/` | React. Follows the *FeltNight — Minimal* design, portrait and landscape |
| Android | `android/` | Capacitor wrapper around the same web app |

### Fair shuffles

Each hand's seed is `SHA-256(host secret ‖ entropy pool ‖ hand number)`. Every player's phone adds
fresh random bytes to the pool with each message, so no single phone decides the deck. The seed's
SHA-256 fingerprint is shown before the deal and the seed is revealed after. Under *Menu → Hand
history & fairness*, any player can re-derive the deck and check that it matches the cards dealt.

### Why public relays

There is no game server to pay for or keep running. The host's phone is the server. A relay is
needed only because phones can't accept incoming connections. The app connects to three brokers
(EMQX, Mosquitto, HiveMQ) at once and removes duplicate messages, so one broker going down doesn't
stop the game. The brokers only ever see encrypted data.

## Development

```bash
npm install
npm run dev          # http://localhost:5173 (also on your LAN)
npm test             # engine + session tests (Vitest)
npm run build && npx vite preview --port 4173
node e2e/play.mjs http://localhost:4173/ 4 60   # 4 headless phones play for 60 s over the real relays
```

Android APK (needs JDK 17 and the Android SDK):

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease   # signs with android/keystore.properties if present
```

Pushing to `main` deploys the web app to GitHub Pages (`.github/workflows/pages.yml`).
