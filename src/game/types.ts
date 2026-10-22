import type { Card } from '../engine/cards';
import type { Legal, Street } from '../engine/holdem';

export const BUY_IN = 500;

export interface Settings {
  sb: number;
  bb: number;
  /** Seconds per decision; 0 = no clock. */
  turnSecs: number;
}

export type Phase = 'lobby' | 'playing' | 'over';

export interface PlayerView {
  id: string;
  name: string;
  initials: string;
  stack: number;
  loans: number;
  bet: number;
  isHost: boolean;
  connected: boolean;
  sittingOut: boolean;
  left: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Face-up cards (showdown) or own hole cards. */
  cards: Card[] | null;
  isDealer: boolean;
  voted: boolean;
  lastAction: string | null;
  won: number;
  handName: string | null;
}

export interface HandView {
  no: number;
  street: Street;
  board: Card[];
  pot: number;
  toActId: string | null;
  /** Milliseconds left on the clock when this view was sent. */
  turnLeftMs: number | null;
  turnTotalMs: number;
  currentBet: number;
  minRaise: number;
  /** Identifies the current decision; actions for an older one are ignored. */
  turnId: number;
  commit: string;
  done: boolean;
  result: {
    byFold: boolean;
    winners: { id: string; amount: number }[];
    handName: string | null;
    winningCards: Card[];
  } | null;
  nextHandInMs: number | null;
}

export interface LedgerRow {
  id: string;
  name: string;
  buyIn: number;
  loans: number;
  out: number;
  net: number;
  left: boolean;
}

export interface HistoryEntry {
  no: number;
  board: Card[];
  winners: { name: string; amount: number; handName: string | null }[];
  yourCards: Card[] | null;
  commit: string;
  seed: string;
  /** Deal layout, so a client can re-derive the deck from the seed. */
  n: number;
  dealer: number;
  seat: number;
}

export interface LoanRequestView {
  id: string;
  playerId: string;
  name: string;
  amount: number;
}

export interface View {
  code: string;
  you: string;
  hostId: string;
  phase: Phase;
  settings: Settings;
  buyIn: number;
  players: PlayerView[];
  hand: HandView | null;
  legal: Legal | null;
  handsPlayed: number;
  waitingReason: string | null;
  loanRequests: LoanRequestView[];
  myPendingLoan: number | null;
  votesNeeded: number;
  votes: number;
  endAfterHand: boolean;
  ledger: LedgerRow[] | null;
  history: HistoryEntry[];
  feed: { seq: number; text: string; to?: string }[];
}

export type ClientIntent =
  | { type: 'join'; name: string }
  | { type: 'action'; action: 'fold' | 'check' | 'call' | 'raise'; to?: number; handNo: number; turnId?: number }
  | { type: 'loan'; amount: number }
  | { type: 'cancelLoan' }
  | { type: 'vote'; value: boolean }
  | { type: 'sitOut'; value: boolean }
  | { type: 'leave' }
  | { type: 'ping' };

export type HostIntent =
  | { type: 'start' }
  | { type: 'settings'; settings: Settings }
  | { type: 'resolveLoan'; id: string; approve: boolean; amount?: number }
  | { type: 'giveLoan'; playerId: string; amount: number }
  | { type: 'kick'; playerId: string }
  | { type: 'forceEnd' }
  | { type: 'playAgain' };
