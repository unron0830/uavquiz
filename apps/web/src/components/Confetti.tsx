import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../lib/hooks';

const COLORS = ['#2F6FE4', '#11A3A3', '#F2A93B', '#E5486B', '#7B4FD6', '#ffffff', '#22B07D'];

/** 彩帶落下（尊重 prefers-reduced-motion） */
export function Confetti({ run = true, duration = 6000 }: { run?: boolean; duration?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!run || reduced || !ref.current) return;
    const cv = ref.current; const g = cv.getContext('2d')!;
    let w = (cv.width = cv.offsetWidth), h = (cv.height = cv.offsetHeight);
    const N = Math.min(260, Math.floor(w / 5));
    const ps = Array.from({ length: N }, () => ({
      x: Math.random() * w, y: -Math.random() * h, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3.5,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, s: 6 + Math.random() * 8, c: COLORS[(Math.random() * COLORS.length) | 0],
      ribbon: Math.random() < 0.35,
    }));
    const t0 = performance.now(); let raf = 0;
    const onResize = () => { w = cv.width = cv.offsetWidth; h = cv.height = cv.offsetHeight; };
    window.addEventListener('resize', onResize);
    const step = (t: number) => {
      g.clearRect(0, 0, w, h);
      const fading = t - t0 > duration;
      let alive = 0;
      for (const p of ps) {
        p.x += p.vx + Math.sin((t + p.s * 100) / 600) * 0.6; p.y += p.vy; p.r += p.vr;
        if (p.y > h + 20) { if (fading) continue; p.y = -20; p.x = Math.random() * w; }
        alive++;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
        if (p.ribbon) g.fillRect(-p.s / 6, -p.s, p.s / 3, p.s * 2); else g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s / 1.5);
        g.restore();
      }
      if (alive) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [run, reduced, duration]);
  return <canvas ref={ref} className="confetti" aria-hidden />;
}
