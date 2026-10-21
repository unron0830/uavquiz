import { useMemo, useState } from 'react';
import { api, apiUrl } from '../../lib/api';
import { Link, navigate, useParams, hashQuery } from '../../lib/router';
import { useAsync, useToast } from '../../components/ui';
import { Avatar } from '../../components/Avatar';

const STATUS: Record<string, string> = { LOBBY: '等候入場', RUNNING: '進行中', FINISHED: '已結束', AWARDS: '已頒獎', ABORTED: '已終止' };
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const dt = (t: number | null) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const sec = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} 秒`);

interface Row { id: string; code: string; courseNo: number; courseTitle: string; status: string; demo: boolean; groupNames: string[]; createdAt: number; participants: number; questions: number; scored: number; answers: number }

export default function Records() {
  const list = useAsync(() => api<Row[]>('/records'), []);
  const [q, setQ] = useState('');
  const [course, setCourse] = useState('');
  const [nick, setNick] = useState('');
  const [hits, setHits] = useState<any[] | null>(null);
  const rows = (list.data ?? []).filter((r) => (!course || r.groupNames.includes(course)) && (!q || r.code.includes(q) || r.id.includes(q)));
  return (
    <div className="page">
      <header className="page-head"><h1>紀錄查詢</h1></header>
      <p className="hint">每一場比賽存成一個 JSON 檔（App_Data/records），包含每位參賽者每一題的作答、是否答對與作答秒數。</p>
      <section className="panel">
        <h2>依參賽名稱查詢（跨場次）</h2>
        <form className="row-actions" onSubmit={async (e) => { e.preventDefault(); setHits(await api(`/records/search?nickname=${encodeURIComponent(nick)}`)); }}>
          <input placeholder="輸入參賽名稱（部分文字即可）" value={nick} onChange={(e) => setNick(e.target.value)} aria-label="參賽名稱" />
          <button className="btn" type="submit" disabled={!nick.trim()}>查詢</button>
        </form>
        {hits && (hits.length === 0 ? <p className="muted">沒有找到「{nick}」。</p> : (
          <div className="table-wrap"><table className="qtable">
            <thead><tr><th>日期</th><th>主題</th><th>參賽名稱</th><th>隊伍</th><th>名次</th><th>答對</th><th>正確率</th><th /></tr></thead>
            <tbody>{hits.map((h, i) => (
              <tr key={i}><td>{dt(h.createdAt)}</td><td>{h.courseTitle}</td><td>{h.nickname}</td><td>{h.team}</td><td>{h.rank}</td><td>{h.correct}</td><td>{pct(h.accuracy)}</td>
                <td><Link className="btn small" to={`/records/${h.sessionId}?p=${h.participantId}`}>看作答</Link></td></tr>
            ))}</tbody>
          </table></div>
        ))}
      </section>
      <section className="panel">
        <div className="filters">
          <h2 className="grow">場次</h2>
          <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="題庫主題"><option value="">全部主題</option>{["專業操作證學科題庫", "專業操作證屆期換證題庫", "專業操作證屆期換證題庫_簡易", "普通操作證學科題庫"].map(name => <option key={name} value={name}>{name}</option>)}</select>
          <input type="search" placeholder="代碼" value={q} onChange={(e) => setQ(e.target.value)} aria-label="代碼" style={{ width: 120 }} />
        </div>
        {list.error && <p className="err">{list.error}</p>}
        {rows.length === 0 && list.data && <p className="muted">還沒有比賽紀錄。開場後就會自動建立。</p>}
        <div className="table-wrap"><table className="qtable">
          <thead><tr><th>日期</th><th>主題</th><th>代碼</th><th>題組</th><th>狀態</th><th>人數</th><th>計分題數</th><th>作答筆數</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{dt(r.createdAt)}</td><td>{r.courseTitle}</td><td className="mono">{r.code}{r.demo && <span className="tag demo">示範</span>}</td>
              <td className="stem-cell small">{r.groupNames.join('、')}</td><td>{STATUS[r.status] ?? r.status}</td>
              <td>{r.participants}</td><td>{r.scored}／{r.questions}</td><td>{r.answers}</td>
              <td className="nowrap"><Link className="btn small" to={`/records/${r.id}`}>查看</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  );
}

type Tab = 'people' | 'questions' | 'teams' | 'events';

export function RecordDetail() {
  const { id } = useParams();
  const r = useAsync(() => api<any>(`/records/${encodeURIComponent(String(id))}`), [id]);
  const initialP = Number(hashQuery().get('p')) || null;
  const [tab, setTab] = useState<Tab>('people');
  const [pid, setPid] = useState<number | null>(initialP);
  const [confirmDel, setConfirmDel] = useState(false);
  const toast = useToast();
  const d = r.data;
  const person = useMemo(() => d?.participants.find((p: any) => p.participantId === pid), [d, pid]);
  const qById = useMemo(() => new Map<string, any>((d?.questions ?? []).map((q: any) => [q.questionId, q])), [d]);
  return (
    <div className="page">
      <header className="page-head">
        <h1>{d ? <>{d.courseTitle} <span className="mono muted">{d.code}</span></> : '作答紀錄'}</h1>
        <div className="head-actions">
          <a className="btn3d" href={apiUrl(`/records/${id}/csv?kind=answers`)}>下載作答明細 CSV</a>
          <a className="btn" href={apiUrl(`/records/${id}/csv?kind=summary`)}>下載成績摘要 CSV</a>
          <a className="btn" href={apiUrl(`/records/${id}/json`)}>下載 JSON</a>
        </div>
      </header>
      {r.error && <p className="err">{r.error}</p>}
      {d && (
        <>
          <p className="muted">{dt(d.startedAt)} 開始，題組：{d.groupNames.join('、')}，計分題數 {d.scored}，{d.participants.length} 人參賽{d.demo ? '（示範模式）' : ''}。</p>
          <div className="tabs" role="tablist">
            {([['people', '個人成績與作答'], ['questions', '每題統計'], ['teams', '團體'], ['events', '操作紀錄']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'people' && (
            <div className={`people-grid${person ? ' with-detail' : ''}`}>
              <section className="panel">
                <div className="table-wrap"><table className="qtable clickable">
                  <thead><tr><th>名次</th><th>參賽名稱</th><th>隊伍</th><th>積分</th><th>答對</th><th>作答</th><th>正確率</th><th>答對耗時</th></tr></thead>
                  <tbody>{d.participants.map((p: any) => (
                    <tr key={p.participantId} className={p.participantId === pid ? 'current' : ''} onClick={() => setPid(p.participantId)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPid(p.participantId)}>
                      <td>{p.rank}</td><td className="nick"><Avatar id={p.avatar} size={24} /> {p.nickname}{p.lateJoin && <span className="tag">中途加入</span>}</td>
                      <td><span style={{ color: p.teamColor }}>{p.team}</span></td><td><b>{p.points ?? 0}</b></td><td><b>{p.correct}</b></td><td>{p.answered}</td><td>{pct(p.accuracy)}</td><td>{sec(p.timeMs)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                <p className="hint">點一列查看這位學生每一題的作答。</p>
              </section>
              {person && (
                <section className="panel person">
                  <div className="row-actions"><h2><Avatar id={person.avatar} size={30} /> {person.nickname}</h2><span className="spacer" /><button className="icon-btn" aria-label="關閉" onClick={() => setPid(null)}>✕</button></div>
                  <p className="muted">第 {person.rank} 名，{person.points ?? 0} 分，答對 {person.correct}／{d.scored} 題，{person.team}</p>
                  <ol className="answer-log">
                    {person.answers.map((a: any) => {
                      const q = qById.get(a.questionId);
                      return (
                        <li key={a.questionId} className={a.voided ? 'voided' : a.chosen == null ? 'none' : a.correct ? 'ok' : 'no'}>
                          <span className="al-idx">{a.index}</span>
                          <div className="al-body">
                            <p className="al-stem">{q?.stem}</p>
                            <p className="al-meta">
                              {a.chosen == null ? '未作答' : <>作答 <b>{a.chosen}</b>　{q?.options[a.chosen]}</>}
                              {a.chosen !== a.correctOption && <>　｜　正解 <b>{a.correctOption}</b>　{q?.options[a.correctOption]}</>}
                              {a.elapsedMs != null && <>　｜　{sec(a.elapsedMs)}</>}<span>　｜　{a.points ?? 0} 分</span>
                              {a.voided && <>　｜　本題不計分</>}
                            </p>
                          </div>
                          <span className="al-mark" aria-label={a.chosen == null ? '未作答' : a.correct ? '答對' : '答錯'}>{a.voided ? '—' : a.chosen == null ? '·' : a.correct ? '✓' : '✗'}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </div>
          )}
          {tab === 'questions' && (
            <section className="panel"><div className="table-wrap"><table className="qtable">
              <thead><tr><th>題次</th><th>題目</th><th>正解</th><th>A</th><th>B</th><th>C</th><th>D</th><th>作答</th><th>答對率</th><th>平均秒數</th></tr></thead>
              <tbody>{d.questions.map((q: any) => (
                <tr key={q.questionId} className={q.voided ? 'inactive' : ''}>
                  <td>{q.index}</td><td className="stem-cell"><span className="mono muted small">{q.questionId}</span><br />{q.stem}</td><td><b>{q.correct}</b></td>
                  {(['A', 'B', 'C', 'D'] as const).map((k) => <td key={k} className={k === q.correct ? 'ok' : ''}>{q.distribution[k]}</td>)}
                  <td>{q.answered}</td><td>{q.voided ? '不計分' : pct(q.accuracy)}</td><td>{sec(q.avgMs)}</td>
                </tr>
              ))}</tbody>
            </table></div></section>
          )}
          {tab === 'teams' && (
            <section className="panel"><p>團隊答對率＝全隊答對次數 ÷（隊員人數 × 正式計分題數）。未答算錯；暖身、作廢題、中途加入及已移除者不列入。同率比較答對題平均作答時間，較快者優先。</p><table className="qtable">
              <thead><tr><th>名次</th><th>隊伍</th><th>隊員人數</th><th>正式計分題數</th><th>答對／應答次數</th><th>團隊答對率</th><th>答對題平均作答時間</th></tr></thead>
              <tbody>{d.teams.map((t: any) => <tr key={t.teamId}><td>{t.rank}</td><td style={{ color: t.color }}><b>{t.name}</b></td><td>{t.members}</td><td>{t.scoredQuestions}</td><td>{t.correct}／{t.members * t.scoredQuestions}</td><td>{pct(t.accuracy)}</td><td>{sec(t.avgTimeMs)}</td></tr>)}</tbody>
            </table></section>
          )}
          {tab === 'events' && (
            <section className="panel"><ul className="events">
              {d.events.map((e: any, i: number) => <li key={i}><span className="mono muted">{new Date(e.at).toLocaleTimeString('zh-TW', { hour12: false })}</span> {e.type} <small className="muted">{JSON.stringify(e.detail)}</small></li>)}
            </ul></section>
          )}
          <section className="panel danger-zone">
            {!confirmDel ? <button className="btn danger" onClick={() => setConfirmDel(true)}>刪除這場紀錄</button> : (
              <>
                <span className="warn">確定刪除？紀錄檔會被移除且無法復原，建議先下載 CSV 或 JSON。</span>
                <button className="btn danger" onClick={async () => { try { await api(`/records/${id}`, { method: 'DELETE' }); navigate('/records'); } catch (e) { toast.err(e); } }}>確定刪除</button>
                <button className="btn" onClick={() => setConfirmDel(false)}>取消</button>
              </>
            )}
          </section>
        </>
      )}
      <Link to="/records">回紀錄列表</Link>
      {toast.node}
    </div>
  );
}
