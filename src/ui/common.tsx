import { AnimatePresence, motion } from 'framer-motion';
import { ReactNode, useEffect, useState } from 'react';
import { Card as C, isRed, rankLabel, suitOf } from '../engine/cards';

// Vector suits: font glyphs fall back to colour emoji on some phones.
const SUIT_PATHS = [
  'M12 1.8C9 6 3 9.6 3 14c0 2.6 2 4.6 4.5 4.6 1.4 0 2.6-.6 3.4-1.6-.3 2-1 3.4-2.4 4.8h7c-1.4-1.4-2.1-2.8-2.4-4.8.8 1 2 1.6 3.4 1.6 2.5 0 4.5-2 4.5-4.6 0-4.4-6-8-9-12.2z',
  'M12 21.6l-1.4-1.3C5.4 15.6 2 12.5 2 8.7 2 5.6 4.4 3.2 7.5 3.2c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 3.1 0 5.5 2.4 5.5 5.5 0 3.8-3.4 6.9-8.6 11.6z',
  'M12 1.5L20.5 12 12 22.5 3.5 12z',
  'M12 2.2a4.3 4.3 0 0 0-3.9 6.1A4.3 4.3 0 1 0 10.6 16c-.3 2.2-1 3.8-2.6 5.6h8c-1.6-1.8-2.3-3.4-2.6-5.6a4.3 4.3 0 1 0 2.5-7.7A4.3 4.3 0 0 0 12 2.2z',
];

export function Suit({ suit, size }: { suit: number; size: number }) {
  return (
    <svg className="s" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={SUIT_PATHS[suit]} fill="currentColor" />
    </svg>
  );
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function PlayingCard({ card, w, dim, win, delay = 0 }: { card: C | null; w: number; dim?: boolean; win?: boolean; delay?: number }) {
  const h = Math.round(w * 1.42);
  const style = { width: w, height: h, ['--cw' as string]: `${w}px`, borderRadius: Math.max(4, w * 0.11) };
  if (card === null) return <div className="card slot" style={style} />;
  return (
    <motion.div
      className={`card ${isRed(card) ? 'red' : ''} ${dim ? 'dim' : ''} ${win ? 'win' : ''}`}
      style={style}
      initial={{ rotateY: 90, y: -8, opacity: 0 }}
      animate={{ rotateY: 0, y: 0, opacity: dim ? 0.42 : 1 }}
      transition={{ duration: 0.28, delay }}
      aria-label={`${rankLabel(card)} of ${['spades', 'hearts', 'diamonds', 'clubs'][suitOf(card)]}`}
    >
      <span className="r">{rankLabel(card)}</span>
      <Suit suit={suitOf(card)} size={Math.round(w * 0.34)} />
    </motion.div>
  );
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function MenuIcon() {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
      <rect x="1" y="1" width="20" height="2.2" rx="1.1" fill="currentColor" />
      <rect x="1" y="10.8" width="20" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  );
}

export function useNow(interval = 250) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function useLandscape() {
  const get = () => window.innerWidth > window.innerHeight && window.innerHeight < 560;
  const [l, setL] = useState(get);
  useEffect(() => {
    const f = () => setL(get());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return l;
}

export async function shareOrCopy(text: string, url?: string): Promise<string> {
  try {
    if (navigator.share) {
      await navigator.share(url ? { text, url } : { text });
      return '';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return '';
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    return 'Copied';
  } catch {
    return 'Could not copy';
  }
}

export const PUBLIC_URL = 'https://whysush.github.io/pocket-poker/';
export const roomLink = (code: string) => `${PUBLIC_URL}?room=${code}`;
