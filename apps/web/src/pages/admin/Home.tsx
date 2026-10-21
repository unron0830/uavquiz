import { useEffect, useState } from 'react';
import { fmtDuration } from '@uqa/shared';
import { api } from '../../lib/api';
import { navigate, Link } from '../../lib/router';
import { useAsync, useToast } from '../../components/ui';
export interface Group { id: string; name: string; active: number }
export default function Home() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(20);
  const [teamSize, setTeamSize] = useState('6');
  const maxTeamSize = Number(teamSize);
  const validTeamSize = Number.isInteger(maxTeamSize) && maxTeamSize >= 1 && maxTeamSize <= 100;
  const [secondsChoice, setSecondsChoice] = useState<number | 'custom'>(15);
  const [customSeconds, setCustomSeconds] = useState('45');
  const seconds = secondsChoice === 'custom' ? Number(customSeconds) : secondsChoice;
  const validSeconds = Number.isInteger(seconds) && seconds >= 15 && seconds <= 120;
  const [explanationSeconds, setExplanationSeconds] = useState(10);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const toast = useToast();
  const load = () => api<{ groups: Group[] }>('/settings').then(r => setGroups(r.groups)).catch(toast.err).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);
  const available = groups.filter(g => selected.includes(g.id)).reduce((n, g) => n + g.active, 0);
  const start = async () => {
    if (!validSeconds) { toast.err('作答時間請輸入 15～120 的整數秒數'); return; }
    if (!validTeamSize) { toast.err('每組人數上限請輸入 1～100 的整數'); return; }
    setStarting(true);
    try {
      const r = await api<{ id: string }>('/sessions/random', { body: { groupIds: selected, questionCount: count, answerSeconds: seconds, explanationSeconds, maxTeamSize } });
      navigate(`/host/control/${r.id}`);
    } catch (e) { toast.err(e); } finally { setStarting(false); }
  };
  return <div className="page home">
    <header className="page-head"><h1>隨機搶答</h1></header>
    <LiveSessions />
    <section className="panel open-panel">
      <h2>選擇題庫主題</h2><p className="hint">可複選，從勾選的主題混合隨機抽題，每場不重複。</p>
      {loading && <p>載入題庫中…</p>}
      <div className="group-list">{groups.map(g => <label key={g.id} className={`gl-item${selected.includes(g.id) ? ' on' : ''}`}>
        <input type="checkbox" checked={selected.includes(g.id)} onChange={e => setSelected(e.target.checked ? [...selected, g.id] : selected.filter(id => id !== g.id))} />
        <span className="gl-name">{g.name}</span><span className="gl-n">{g.active} 題</span>
      </label>)}</div>
      <h2 className="sub-h">隊伍與人數</h2>
      <div className="row-actions">
        <label>每組最多 <input type="number" inputMode="numeric" min={1} max={100} step={1} value={teamSize} onChange={e => setTeamSize(e.target.value)} aria-invalid={!validTeamSize} style={{ width: 90 }} /> 人</label>
      </div>
      {validTeamSize ? <p className="ready">每組最多 <b>{maxTeamSize} 人</b>，隊伍隨入場人數自動增加。請依現場人數與獎品數量設定每組上限。</p> : <p className="err">每組人數上限請輸入 1～100 的整數。</p>}
      <p className="hint">不用設定總人數或隊伍數；學生依序補入尚有名額的隊伍，全部滿員後自動新增一隊。按「開始比賽」才出題，中途加入者只計個人。</p>
      <h2 className="sub-h">正式題數</h2>
      <div className="quick-secs" role="group" aria-label="正式題數">{[20, 40, 80].map(n => <button key={n} className={`chip-btn${count === n ? ' on' : ''}`} aria-pressed={count === n} onClick={() => setCount(n)}>{n} 題</button>)}</div>
      <h2 className="sub-h">每題作答時間</h2>
      <div className="quick-secs" role="group" aria-label="每題作答時間">{[15, 20, 30].map(n => <button key={n} className={`chip-btn${secondsChoice === n ? ' on' : ''}`} aria-pressed={secondsChoice === n} onClick={() => setSecondsChoice(n)}>{n} 秒</button>)}<button className={`chip-btn${secondsChoice === 'custom' ? ' on' : ''}`} aria-pressed={secondsChoice === 'custom'} onClick={() => setSecondsChoice('custom')}>自行輸入</button></div>
      {secondsChoice === 'custom' && <label>每題作答秒數 <input type="number" inputMode="numeric" min={15} max={120} step={1} value={customSeconds} onChange={e => setCustomSeconds(e.target.value)} aria-invalid={!validSeconds} /> 秒（15～120 秒）{!validSeconds && <span className="err">請輸入 15～120 的整數秒數</span>}</label>}
      <h2 className="sub-h">每題講解時間</h2>
      <div className="quick-secs" role="group" aria-label="每題講解時間">{[5, 10, 15, 20, 30].map(n => <button key={n} className={`chip-btn${explanationSeconds === n ? ' on' : ''}`} aria-pressed={explanationSeconds === n} onClick={() => setExplanationSeconds(n)}>{n} 秒</button>)}</div>
      <div className="panel" style={{ marginTop: 24 }}>
        <h2>預計比賽時間：<strong>{validSeconds ? fmtDuration((count + 2) * (seconds + explanationSeconds + 20)) : '請先輸入有效作答秒數'}</strong></h2>
        <p>2 題暖身＋{count} 題正式題，共 {count + 2} 題。</p>
        <p className="hint">每題作答 {validSeconds ? seconds : '—'} 秒＋講解 {explanationSeconds} 秒＋主持人換題（預估 20 秒）；實際換題由主持人決定。</p>
        <p>每場先從勾選題庫隨機抽兩題暖身，不計分，與正式題不重複。揭曉答案後會停住，由主持人按「下一題」；每題皆可點選「顯示詳解」。答對 1,000 分，依作答速度再加最多 500 分。每題揭曉即顯示本題與累積排名，不增加停留時間。</p>
      </div>
      {selected.length > 0 && <p className={available >= count + 2 ? 'ready ok' : 'ready warn'}>已選 {selected.length} 種主題，題庫共 {available} 題，隨機抽取 {count} 題。</p>}
      <div className="row-actions"><button className="btn3d big" disabled={starting || loading || !selected.length || available < count + 2 || !validSeconds || !validTeamSize} onClick={start}>{starting ? '建立中…' : '開場（含兩題暖身）'}</button>
        <button className="btn" onClick={async () => { try { await api('/bank/reload', { body: {} }); await load(); toast.ok('已重新載入題庫'); } catch (e) { toast.err(e); } }}>重新載入題庫</button></div>
    </section>{toast.node}
  </div>;
}
function LiveSessions() {
  const live = useAsync(() => api<{ id: string; code: string; courseTitle: string; phase: string; participants: number }[]>('/sessions/live'), []);
  const rows = (live.data ?? []).filter(x => !['FINISHED', 'AWARDS', 'ABORTED'].includes(x.phase));
  if (!rows.length) return null;
  return <section className="panel live"><h2>進行中的場次</h2><ul className="live-list">{rows.map(x => <li key={x.id}>
    <b>{x.courseTitle}</b><span>代碼 {x.code}</span><span>{x.participants} 人</span><Link className="btn" to={`/host/control/${x.id}`}>回到控制台</Link>
  </li>)}</ul></section>;
}
