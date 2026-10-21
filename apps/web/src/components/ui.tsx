import { useEffect, useState, type ReactNode } from 'react';

export function Toast({ msg, kind = 'ok', onDone }: { msg: string; kind?: 'ok' | 'err'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, kind === 'err' ? 6000 : 2500); return () => clearTimeout(t); }, [msg, kind, onDone]);
  return <div className={`toast ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{msg}</div>;
}

export function useToast() {
  const [t, setT] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  return {
    node: t ? <Toast msg={t.msg} kind={t.kind} onDone={() => setT(null)} /> : null,
    ok: (msg: string) => setT({ msg, kind: 'ok' }),
    err: (e: unknown) => setT({ msg: e instanceof Error ? e.message : String(e), kind: 'err' }),
  };
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="關閉">✕</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function NumberField({ label, value, onChange, min, max, suffix, id }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string; id: string }) {
  return (
    <label className="numfield" htmlFor={id}>
      <span>{label}</span>
      <span className="nf-input">
        <input id={id} type="number" inputMode="numeric" value={Number.isFinite(value) ? value : ''} min={min} max={max}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    fn().then((d) => alive && (setData(d), setError(''))).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}
