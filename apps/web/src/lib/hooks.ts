import { useEffect, useState } from 'react';
import { serverNow } from './clock';

export function useCountdown(endsAt: number | null, remainingMs: number | null) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (endsAt == null) return;
    const t = setInterval(() => refresh(value => value + 1), 100);
    return () => clearInterval(t);
  }, [endsAt]);
  if (endsAt == null) return remainingMs ?? null;
  return Math.max(0, endsAt - serverNow());
}

export function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const f = () => setR(m.matches);
    m?.addEventListener('change', f);
    return () => m?.removeEventListener('change', f);
  }, []);
  return r;
}
