import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '@uqa/shared';
import { api, ApiError } from './api';
import { syncFromServer } from './clock';

export type ConnStatus = 'connecting' | 'online' | 'offline' | 'denied' | 'kicked';

/**
 * 短輪詢（Windows 10 IIS 同時連線上限 10，不使用 WebSocket／長連線）。
 * 學生每秒一次、投影與老師約 0.7 秒一次；送出動作後立即再取一次。
 */
export function useLive<Extra = any>(path: string | null, intervalMs: number) {
  const [state, setState] = useState<GameState | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const timer = useRef<number>();
  const alive = useRef(true);
  const fails = useRef(0);
  const lastSeq = useRef(-1);

  const poll = useCallback(async () => {
    if (!path) return;
    window.clearTimeout(timer.current);
    try {
      const t0 = Date.now();
      const r = await api<{ state: GameState } & Record<string, unknown>>(path);
      if (!alive.current) return;
      fails.current = 0;
      setStatus('online');
      if (r.state) {
        // 往返時間的一半當作單程延遲，校正伺服器時鐘
        syncFromServer(r.state.serverTime + (Date.now() - t0) / 2);
        lastSeq.current = r.state.sequence;
        setState(r.state);
      }
      const { state: _s, ...rest } = r;
      setExtra(rest as Extra);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setStatus(e.message === 'kicked' ? 'kicked' : 'denied');
        return; // 不再輪詢
      }
      fails.current += 1;
      setStatus('offline');
    }
    const wait = document.hidden ? intervalMs * 3 : fails.current ? Math.min(5000, intervalMs * (1 + fails.current)) : intervalMs;
    timer.current = window.setTimeout(poll, wait);
  }, [path, intervalMs]);

  useEffect(() => {
    alive.current = true;
    lastSeq.current = -1;
    void poll();
    const vis = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive.current = false; window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', vis); };
  }, [poll]);

  /** 送出動作（POST），完成後立即刷新 */
  const send = useCallback(async <R = any>(p: string, body: unknown): Promise<R> => {
    try { return await api<R>(p, { body }); } finally { void poll(); }
  }, [poll]);

  return { state, extra, status, send, refresh: poll };
}
