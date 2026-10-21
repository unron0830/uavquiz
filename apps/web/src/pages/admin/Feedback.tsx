import { useEffect, useState } from 'react';
import type { Explanation } from '@uqa/shared';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import { useAsync, useToast } from '../../components/ui';
import { ExplanationPanel } from '../../components/Explanation';

const labels: Record<string, string> = { explanation: '詳解有誤', images: '圖片有誤', law: '法規有誤' };
interface FeedbackEntry {
  id: string; sessionId: string; code: string; questionId: string; questionIndex: number;
  stem: string; correct: string; options: Record<string, string>; explanation: Explanation;
  categories: string[]; note: string; resolution: string; status: 'open' | 'resolved'; createdAt: number; updatedAt: number;
}

export function QuestionFeedbackForm({ sessionId, questionId, defaultExplanation = false, compact = false, onSaved }: { sessionId: string; questionId: string; defaultExplanation?: boolean; compact?: boolean; onSaved?: () => void }) {
  const [categories, setCategories] = useState<string[]>(defaultExplanation ? ['explanation'] : []);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api<FeedbackEntry[]>(`/question-feedback?sessionId=${encodeURIComponent(sessionId)}&questionId=${encodeURIComponent(questionId)}`)
      .then(rows => { if (alive && rows[0]) { setCategories(defaultExplanation ? [...new Set([...rows[0].categories, 'explanation'])] : rows[0].categories); setNote(rows[0].note); setMessage(rows[0].status === 'resolved' ? '此題回饋已標記處理完成' : '此題已有回饋，待處理'); } })
      .catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sessionId, questionId, defaultExplanation]);
  return <section className={`${compact ? '' : 'panel '}question-feedback`}>
    {!compact && <h2>本題回饋註記 <small>{questionId}</small></h2>}
    <form onSubmit={async e => {
      e.preventDefault(); setSaving(true); setError('');
      try { await api('/question-feedback', { body: { sessionId, questionId, categories, note } }); setMessage('已儲存回饋，待處理'); onSaved?.(); }
      catch (err) { setError(err instanceof Error ? err.message : '儲存失敗，請重試'); }
      finally { setSaving(false); }
    }}>
      <fieldset disabled={loading || saving}><legend>勾選問題類型（可複選）</legend><div className="row-actions">{Object.entries(labels).map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={categories.includes(key)} onChange={e => { setCategories(e.target.checked ? [...categories, key] : categories.filter(x => x !== key)); setMessage('尚未儲存'); }} />{label}</label>)}</div>
        <label className="feedback-note">回饋內容／修改建議<textarea rows={3} maxLength={2000} value={note} onChange={e => { setNote(e.target.value); setMessage('尚未儲存'); }} placeholder="例如：詳解引用上一題、圖片與題幹不符、應改用另一條法規…" /></label>
      </fieldset>
      <div className="row-actions"><button className="btn strong" type="submit" disabled={loading || saving || !categories.length}>{saving ? '儲存中…' : '儲存本題回饋'}</button><Link to="/host/feedback" target="_blank" className="btn">查看全部回饋</Link><span role="status">{loading ? '載入中…' : message}</span></div>
      {error && <p className="err" role="alert">{error}</p>}
    </form>
  </section>;
}

function GithubReport({ row }: { row: FeedbackEntry }) {
  const settings = useAsync(() => api<{ githubRepository: string }>('/feedback-settings'), []);
  const repo = settings.data?.githubRepository?.replace(/\/$/, '') ?? '';
  const valid = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
  const body = `## 題庫回報\n題號：${row.questionId}\n類型：${row.categories.map(k => labels[k]).join('、')}\n\n### 題目\n${row.stem}\n${Object.entries(row.options).map(([k,v]) => `${k}：${v}`).join('\n')}\n正確答案：${row.correct}\n\n### 問題與建議\n${row.note || '請補充問題與修改建議'}\n\n### 現有解說\n${row.explanation?.text ?? ''}\n${row.explanation?.lawReference ?? ''}\n${row.explanation?.lawExcerpt ?? ''}\n\n### 圖片路徑\n${row.explanation?.images?.join('\n') ?? ''}\n\n請自行附上必要截圖，送出前確認沒有學生姓名、學號或伺服器密碼。`;
  return <div className="row-actions"><button className="btn" onClick={() => { const u=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=`題目回報-${row.questionId}.md`;a.click();URL.revokeObjectURL(u); }}>下載 GitHub 回報文字</button>{valid ? <a className="btn" href={`${repo}/issues/new?title=${encodeURIComponent('[題庫回報] '+row.questionId)}&body=${encodeURIComponent(body.slice(0,5000))}`} target="_blank" rel="noopener noreferrer">到 GitHub 留言回報</a> : <span>尚未設定 GitHub 網址，請下載回報文字交給管理者。</span>}</div>;
}

export default function Feedback() {
  useEffect(() => { document.title = '題目回饋｜無人機知識王'; }, []);
  const load = useAsync(() => api<FeedbackEntry[]>('/question-feedback'), []);
  const [filter, setFilter] = useState('open');
  const rows = (load.data ?? []).filter(row => filter === 'all' || row.status === filter);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = '題目回饋.json'; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="page"><header className="page-head"><h1>題目回饋</h1></header>
    <p>集中查看比賽中註記的問題，補充修改建議與處理紀錄。標記處理完成不會自動改寫題庫。GitHub 按鈕會開啟回報草稿，由你確認後送出，不會自動上傳資料。</p>
    <div className="row-actions"><label>狀態 <select value={filter} onChange={e => setFilter(e.target.value)}><option value="open">待處理</option><option value="resolved">已處理</option><option value="all">全部</option></select></label><button className="btn" onClick={load.reload}>重新整理</button><button className="btn" disabled={!rows.length} onClick={download}>下載目前回饋 JSON</button></div>
    {load.error && <p className="err" role="alert">{load.error}</p>}
    {!load.data && !load.error && <p>載入中…</p>}
    {load.data && !rows.length && <p>目前沒有符合的回饋。</p>}
    {rows.map(row => <ReviewEntry key={row.id} row={row} onSaved={load.reload} />)}
  </div>;
}

function ReviewEntry({ row, onSaved }: { row: FeedbackEntry; onSaved: () => void }) {
  const [resolution, setResolution] = useState(row.resolution);
  const [status, setStatus] = useState(row.status);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  return <article className="panel feedback-entry">
    <h2>{row.questionId} <small>{row.categories.map(key => labels[key]).join('、')}</small></h2>
    <p className="muted small">場次 {row.code} · 第 {row.questionIndex} 題 · {new Date(row.createdAt).toLocaleString('zh-TW')}</p>
    <GithubReport row={row} /><h3>{row.stem}</h3><p className="feedback-text">{row.note || '未填寫補充說明'}</p>
    <details><summary>查看註記當時的題目與詳解</summary><ol>{Object.entries(row.options).map(([key, option]) => <li key={key}>{key}：{option}{key === row.correct && '（正確答案）'}</li>)}</ol>{row.explanation && <ExplanationPanel ex={row.explanation} answerText={row.options[row.correct]} />}</details>
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await api(`/question-feedback/${row.id}`, { body: { status, resolution } }); toast.ok('已儲存處理紀錄'); onSaved(); } catch (err) { toast.err(err); } finally { setSaving(false); } }}>
      <label className="feedback-note">處理備註／修改建議<textarea rows={3} value={resolution} maxLength={2000} onChange={e => setResolution(e.target.value)} /></label>
      <div className="row-actions"><label>處理狀態 <select value={status} onChange={e => setStatus(e.target.value as FeedbackEntry['status'])}><option value="open">待處理</option><option value="resolved">已處理</option></select></label><button className="btn" disabled={saving}>{saving ? '儲存中…' : '儲存處理紀錄'}</button></div>
    </form>{toast.node}
  </article>;
}
