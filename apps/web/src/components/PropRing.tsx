import { useRef } from 'react';
/** 倒數圈：無人機螺旋槳護罩造型；剩餘時間以外圈弧長表示，內圈螺旋槳隨倒數旋轉 */
export function PropRing({ ms, totalMs, size = 120, paused }: { ms: number | null; totalMs: number; size?: number; paused?: boolean }) {
  const sec = ms == null ? null : Math.ceil(ms / 1000);
  const frac = ms == null || totalMs <= 0 ? 1 : Math.max(0, Math.min(1, ms / totalMs));
  const r = 44, c = 2 * Math.PI * r;
  const urgent = sec != null && sec <= 5 && !paused;
  return (
    <div className={`prop-ring${urgent ? ' urgent' : ''}${paused ? ' paused' : ''}`} style={{ width: size, height: size }} role="timer" aria-live="off" aria-label={sec == null ? '' : `剩餘 ${sec} 秒`}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} className="pr-track" />
        <circle cx="50" cy="50" r={r} className="pr-arc" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 50 50)" />
        <g className="pr-blades">
          <ellipse cx="50" cy="31" rx="5" ry="15" />
          <ellipse cx="50" cy="69" rx="5" ry="15" />
          <circle cx="50" cy="50" r="5" />
        </g>
      </svg>
      <span className="pr-num">{paused ? '❚❚' : sec ?? ''}</span>
    </div>
  );
}

/** 每個 key 第一次收到的剩餘時間當作總長，讓圓環從滿格開始 */
export function PropRingAuto({ ms, k, size = 132 }: { ms: number | null; k: string; size?: number }) {
  const total = useRef<{ id: string; ms: number }>({ id: '', ms: 1 });
  if (total.current.id !== k && ms != null) total.current = { id: k, ms: Math.max(ms, 1000) };
  return <PropRing ms={ms} totalMs={total.current.ms} size={size} />;
}
