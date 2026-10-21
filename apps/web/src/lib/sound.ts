/** 以 WebAudio 合成簡短音效，無外部音檔；遵循瀏覽器自動播放限制 */
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem('uqa-muted') === '1'; } catch { return false; } })();
export const isMuted = () => muted;
export function setMuted(m: boolean) { muted = m; try { localStorage.setItem('uqa-muted', m ? '1' : '0'); } catch { /* ignore */ } }
export function unlockAudio() {
  try { if (!ctx) ctx = new AudioContext(); if (ctx.state === 'suspended') void ctx.resume(); } catch { /* ignore */ }
}
export const audioReady = () => !!ctx && ctx.state === 'running';
function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.18) {
  if (!ctx) return;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
export const sfx = {
  tick() { if (!muted) tone(880, 0, 0.08, 'square', 0.05); },
  open() { if (!muted) { tone(523, 0, 0.12, 'triangle'); tone(784, 0.1, 0.18, 'triangle'); } },
  correct() { if (!muted) { tone(660, 0, 0.12, 'triangle'); tone(880, 0.1, 0.12, 'triangle'); tone(1320, 0.2, 0.25, 'triangle'); } },
  neutral() { if (!muted) tone(440, 0, 0.18, 'sine', 0.1); },
  reveal() { if (!muted) { tone(392, 0, 0.15, 'triangle'); tone(523, 0.12, 0.2, 'triangle'); } },
  fanfare() {
    if (muted) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.3, 'triangle', 0.2));
    [784, 1047].forEach((f, i) => tone(f, 0.7 + i * 0.05, 0.8, 'sawtooth', 0.06));
  },
};
