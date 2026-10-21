/** 題目進度：航線＋航點，無人機標記目前題次；回合邊界以較大航點表示 */
export function FlightPath({ index, total, rounds }: { index: number; total: number; rounds: number[] }) {
  const pct = total > 1 ? ((index - 1) / (total - 1)) * 100 : 0;
  const bounds: number[] = [];
  let acc = 0;
  for (const n of rounds.slice(0, -1)) { acc += n; bounds.push(acc); }
  return (
    <div className="flight" aria-label={`第 ${index} 題，共 ${total} 題`}>
      <div className="flight-line"><div className="flight-done" style={{ width: `${pct}%` }} /></div>
      {bounds.map((b) => <span key={b} className="flight-wp" style={{ left: `${((b - 0.5) / total) * 100}%` }} />)}
      <span className="flight-drone" style={{ left: `${pct}%` }} aria-hidden>
        <svg viewBox="0 0 48 28" width="40" height="24"><g fill="currentColor"><rect x="14" y="11" width="20" height="8" rx="4" /><rect x="4" y="12" width="40" height="3" rx="1.5" /><ellipse cx="7" cy="7" rx="7" ry="2" /><ellipse cx="41" cy="7" rx="7" ry="2" /><rect x="6" y="7" width="2" height="6" /><rect x="40" y="7" width="2" height="6" /><circle cx="24" cy="22" r="3" /></g></svg>
      </span>
    </div>
  );
}
