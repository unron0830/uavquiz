import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from '../../lib/router';
import { assetUrl } from '../../lib/base';
import { OPTION_KEYS, fmtDuration, type GameState, type HostCommand } from '@uqa/shared';
import { useLive } from '../../lib/live';
import { Qr } from '../../components/Qr';
import { useCountdown } from '../../lib/hooks';
import { serverNow } from '../../lib/clock';
import { api } from '../../lib/api';
import { Modal, useAsync, useToast } from '../../components/ui';
import { Avatar } from '../../components/Avatar';
import { Leaderboard, TeamBoard } from '../../components/Boards';
import { PropRingAuto } from '../../components/PropRing';
import { ExplanationPanel } from '../../components/Explanation';
import { QuestionFeedbackForm } from './Feedback';

interface Monitor {
  participants: { id: number; nickname: string; avatar: string; teamId: number | null; lateJoin: boolean; connected: boolean; answered: boolean }[];
  connected: number; disconnected: number; currentCorrect: string | null; currentQuestionId: string | null; cursor: number;
  voided: string[]; plan: { index: number; questionId: string; warmup?: boolean; roundNo: number; seconds: number; customSeconds: number | null; stem: string; closed: boolean }[];
  config: { answerSeconds: number; revealSeconds: number; transitionSeconds: number; leaderboardExtraSeconds: number; leaderboardEvery: number; rounds: number[]; classMinutes?: number; minSeconds: number; maxSeconds: number };
  stageToken: string; startedAt: number | null;
}

const PHASE: Record<string, string> = { LOBBY: '等候入場', QUESTION_OPEN: '作答中', REVEAL: '揭曉答案', TRANSITION: '轉場', LEADERBOARD: '排行榜', ROUND_END: '回合結束', FINISHED: '比賽結束', AWARDS: '頒獎', ABORTED: '已終止' };

export default function Control() {
  const { id } = useParams();
  useEffect(() => { document.title = '主持後台｜無人機知識王'; }, []);
  const sid = String(id);
  const [showAns, setShowAns] = useState(false);
  const [pick, setPick] = useState(false);
  const [url, setUrl] = useState('');
  const [feedback, setFeedback] = useState<{ questionId: string; stem: string } | null>(null);
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const toast = useToast();
  const info = useAsync(() => api<{ code: string; joinUrl: string; stageUrl: string; demo: boolean; groupNames: string[] }>(`/sessions/${encodeURIComponent(sid)}`), [sid]);
  const pollPath = useMemo(() => `/host/poll?id=${encodeURIComponent(sid)}`, [sid]);
  const { state, status, extra, send } = useLive<{ monitor: Monitor }>(pollPath, 700);
  const mon = extra?.monitor ?? null;
  const cmd = async (c: HostCommand, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try { const r = await send<{ ok: boolean; message?: string }>('/host/cmd', { id: sid, cmd: c }); if (!r.ok) toast.err(r.message); } catch (e) { toast.err(e); }
  };

  if (info.error) return <div className="page"><p className="err">{info.error}</p><Link to="/records">到紀錄查詢</Link></div>;
  if (!state || !mon || !info.data) return <div className="page"><h1>控制台</h1><p>連線中…{status === 'denied' && '（登入逾時，請重新登入）'}{status === 'offline' && '（連不到伺服器，重試中）'}</p>{toast.node}</div>;

  return (
    <div className="page control">
      <header className="ctl-head">
        <div>
          <h1>{state.courseTitle}{info.data.demo && <span className="tag demo">示範模式</span>}</h1>
          <p className="muted small">題組：{info.data.groupNames.join('、')}</p>
          <div className="ctl-meta">
            <span className="code-pill">代碼 <b>{state.code}</b></span>
            <span className={`phase-pill p-${state.phase.toLowerCase()}`}>{state.paused ? '暫停中' : state.explaining ? '講解中' : PHASE[state.phase]}</span>
            <span className={`conn ${status}`}>{status === 'online' ? '已連線' : '重新連線中'}</span>
          </div>
        </div>
        <div className="head-actions">
          <a className="btn3d" href={info.data.stageUrl} target="uqa-stage" rel="noopener">開啟投影頁</a>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(info.data!.joinUrl).then(() => toast.ok('已複製學生加入網址'))}>複製學生網址</button>
        </div>
      </header>

      <div className="ctl-grid">
        <div className="ctl-main">
          <PrimaryActions state={state} mon={mon} cmd={cmd} onFeedback={() => { if (state.question) setFeedback({ questionId: state.question.questionId, stem: state.question.stem }); }} />
          <TimeBudget state={state} mon={mon} />
          {state.manualAdvance && <p className="hint">預計比賽時間包含每題作答＋講解＋主持人換題（預估 20 秒）；實際換題由主持人決定。</p>}
          {state.phase === 'LOBBY' && (
            <section className="panel lobby-ctl">
              <Qr className="qr-mini" text={info.data.joinUrl} />
              <div>
                <p className="big-count"><b>{state.participantCount}</b>／{state.maxParticipants ?? 100} 人已加入</p>
                <p className="muted">{info.data.joinUrl}</p>
                <TeamSizeSettings state={state} cmd={cmd} />
                <p className="hint">目前 {state.teams.length} 隊{state.maxTeamSize ? `，每組最多 ${state.maxTeamSize} 人，全部滿員後自動新增一隊` : ''}。由主持人按開始，開賽後不再分隊，中途加入者只計個人。</p>
              </div>
            </section>
          )}
          {state.phase === 'REVEAL' && state.questionBoard && <section className="panel"><h2>本題即時排名</h2><Leaderboard rows={state.questionBoard} teams={state.teams} compact /></section>}
          <CurrentQuestion state={state} mon={mon} showAns={showAns} setShowAns={setShowAns} />
          {state.question && <QuestionFeedbackForm key={`${sid}:${state.question.questionId}:${feedbackVersion}`} sessionId={sid} questionId={state.question.questionId} />}
          {state.phase === 'REVEAL' && state.reveal && (!state.manualAdvance || state.showDetails) && (
            <section className="panel">
              <div className="row-actions">
                <h2>本題詳解</h2><span className="spacer" />
                <button className="btn" onClick={() => setPick(true)}>投影圖片庫的圖</button>
                <input placeholder="https:// 網址（法規、懶人包）" value={url} onChange={(e) => setUrl(e.target.value)} />
                <button className="btn" disabled={!/^https:\/\//.test(url)} onClick={() => { window.open(url, '_blank', 'noopener'); cmd({ type: 'adhoc', kind: 'url', value: url }); }}>開啟並通知投影</button>
                {state.adhoc && <button className="btn" onClick={() => cmd({ type: 'adhoc', kind: 'clear' })}>回到本題素材</button>}
              </div>
              {!state.explaining && <p className="hint">按「暫停講解」後，投影幕會停在這裡並顯示以下素材。</p>}
              <ExplanationPanel key={state.question?.questionId} ex={state.reveal.explanation} adhoc={state.adhoc} answerText={state.question?.options[state.reveal.correct]} />
              {(state.reveal.explanation.lawUrl || state.reveal.explanation.referenceUrls.length > 0) && (
                <p className="links">
                  {state.reveal.explanation.lawUrl && <a href={state.reveal.explanation.lawUrl} target="_blank" rel="noopener noreferrer">開啟法規原文（新分頁）</a>}
                  {state.reveal.explanation.referenceUrls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https:\/\//, '').slice(0, 50)}</a>)}
                </p>
              )}
            </section>
          )}
          <section className="panel">
            <h2>累積排名</h2>
            <div className="boards-2">
              <section><h3>累積個人排名</h3><Leaderboard rows={state.leaderboard ?? []} teams={state.teams} compact /></section>
              <section><h3>分組排名（累積）</h3><TeamBoard rows={state.teamBoard ?? []} compact /><p className="hint">團隊答對率＝全隊答對次數 ÷（隊員人數 × 正式計分題數）。同率比答對題平均作答時間；未答算錯，暖身、作廢題、中途加入及已移除者不列入。</p></section>
            </div>
          </section>
          <PlanList state={state} mon={mon} cmd={cmd} />
        </div>

        <aside className="ctl-side">
          <section className="panel">
            <h2>參賽者 <small>{mon.connected} 在線　{mon.disconnected} 離線</small></h2>
            <Roster state={state} mon={mon} cmd={cmd} />
          </section>
          <section className="panel options">
            <h2>選項</h2>
            {!state.manualAdvance && <Toggle label="每題揭曉後自動停住（手動按下一題）" on={state.autoPauseAfterReveal} set={(v) => cmd({ type: 'setOptions', autoPauseAfterReveal: v })} />}
            <Toggle label="投影顯示解說文字" on={state.showExplanationText} set={(v) => cmd({ type: 'setOptions', showExplanationText: v })} />
            <Toggle label="投影音效" on={state.soundEnabled} set={(v) => cmd({ type: 'setOptions', soundEnabled: v })} />
            <Toggle label="隱藏參賽名稱（以編號顯示）" on={state.hideNames} set={(v) => cmd({ type: 'setOptions', hideNames: v })} />
            <Toggle label="允許中途加入（只計個人）" on={state.allowLateJoin} set={(v) => cmd({ type: 'setOptions', allowLateJoin: v })} />
          </section>
          <section className="panel danger-zone">
            {!['FINISHED', 'AWARDS', 'ABORTED', 'LOBBY'].includes(state.phase) && <button className="btn" onClick={() => cmd({ type: 'finish' }, '提前結束比賽並進入結算？')}>提前結束比賽</button>}
            {state.phase !== 'ABORTED' && <button className="btn danger" onClick={() => cmd({ type: 'abort' }, '終止場次？成績會標記為不完整，不列入正式成績。')}>終止場次</button>}
            <Link className="btn" to={`/records/${sid}`}>作答紀錄</Link>
          </section>
        </aside>
      </div>
      {pick && <ImagePicker onClose={() => setPick(false)} onPick={(f) => { cmd({ type: 'adhoc', kind: 'image', value: f }); setPick(false); }} />}
      {feedback && <Modal title="回饋詳解有誤" onClose={() => setFeedback(null)}><p className="small muted">題號：{feedback.questionId}</p><p><b>{feedback.stem}</b></p><QuestionFeedbackForm key={`${sid}:${feedback.questionId}`} sessionId={sid} questionId={feedback.questionId} defaultExplanation compact onSaved={() => { setFeedback(null); setFeedbackVersion(v => v + 1); toast.ok('已儲存本題回饋'); }} /></Modal>}
      {toast.node}
    </div>
  );
}

function TeamSizeSettings({ state, cmd }: { state: GameState; cmd: (c: HostCommand) => void }) {
  const [size, setSize] = useState(String(state.maxTeamSize ?? 6));
  useEffect(() => setSize(String(state.maxTeamSize ?? 6)), [state.maxTeamSize]);
  const value = Number(size);
  const valid = Number.isInteger(value) && value >= 1 && value <= 100;
  return <div>
    <div className="row-actions"><label>每組最多 <input type="number" min={1} max={100} step={1} inputMode="numeric" value={size} onChange={e => setSize(e.target.value)} aria-invalid={!valid} style={{ width: 90 }} /> 人</label>
      <button className="btn" disabled={!valid} onClick={() => cmd({ type: 'setTeamSize', maxTeamSize: value })}>套用上限並重新隨機分隊</button>
    </div>
    {!valid && <p className="err">請輸入 1～100 的整數。</p>}
    <p className="hint">更改上限並套用會重新分隊。設定每組最多 6 人，冠軍隊每人 1 份，6 個獎品足夠。</p>
  </div>;
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <label className="toggle"><input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} /><span>{label}</span></label>;
}

function PrimaryActions({ state, mon, cmd, onFeedback }: { state: GameState; mon: Monitor; cmd: (c: HostCommand, m?: string) => void; onFeedback: () => void }) {
  const ms = useCountdown(state.endsAt, state.remainingMs);
  const explanationMs = useCountdown(state.explanationEndsAt ?? null, null);
  const p = state.phase;
  const nextRound = (mon.plan[mon.cursor + 1]?.roundNo) ?? '';
  let main: { label: string; c: HostCommand } | null = null;
  if (p === 'LOBBY') main = { label: '開始比賽', c: { type: 'start' } };
  else if (state.paused) main = { label: '繼續', c: { type: 'resume' } };
  else if (p === 'QUESTION_OPEN') main = { label: '提早收題並公布答案', c: { type: 'revealNow' } };
  else if (p === 'REVEAL') main = { label: state.manualAdvance ? (mon.cursor === mon.plan.length - 1 ? '結束比賽' : '下一題') : state.explaining ? '講解完畢，繼續' : '下一步', c: { type: 'next' } };
  else if (p === 'TRANSITION' || p === 'LEADERBOARD') main = { label: '立即下一題', c: { type: 'next' } };
  else if (p === 'ROUND_END') main = { label: `開始第 ${nextRound} 回合`, c: { type: 'next' } };
  else if (p === 'FINISHED') main = { label: '頒獎', c: { type: 'awards' } };
  return (
    <section className="panel actions">
      <div className="act-row">
        {main && <button className="btn3d huge" onClick={() => cmd(main!.c)}>{main.label}</button>}
        {p === 'REVEAL' && state.question && (state.manualAdvance ? state.showDetails : state.explaining) && <button className="btn danger" aria-haspopup="dialog" onClick={onFeedback}>回饋詳解有誤</button>}
        {ms != null && <PropRingAuto ms={ms} k={`${p}${state.question?.questionId}${state.version}`} size={84} />}
        {state.remainingMs != null && state.paused && <span className="muted">剩 {Math.ceil(state.remainingMs / 1000)} 秒</span>}
      </div>
      {p === 'REVEAL' && state.manualAdvance && <p className="hint">講解時間 {state.explanationSeconds ?? 10} 秒 · {explanationMs != null && explanationMs > 0 ? `剩餘 ${Math.ceil(explanationMs / 1000)} 秒` : '講解時間到'}，由主持人按下一題。</p>}
      <div className="act-row secondary">
        {p === 'REVEAL' && state.manualAdvance && <button className="btn strong" aria-pressed={!!state.showDetails} onClick={() => cmd({ type: 'showDetails', visible: !state.showDetails })}>{state.showDetails ? '收起詳解' : '顯示詳解'}</button>}
        {p === 'REVEAL' && !state.explaining && <button className="btn strong" onClick={() => cmd({ type: 'explain' })}>暫停講解</button>}
        {['QUESTION_OPEN', 'REVEAL', 'TRANSITION', 'LEADERBOARD'].includes(p) && !state.paused && !(p === 'REVEAL' && state.explaining) && <button className="btn" onClick={() => cmd({ type: 'pause' })}>暫停</button>}
        {p === 'QUESTION_OPEN' && !state.paused && <><button className="btn" onClick={() => cmd({ type: 'extend', seconds: 5 })}>＋5 秒</button><button className="btn" onClick={() => cmd({ type: 'extend', seconds: 10 })}>＋10 秒</button></>}
        {p === 'QUESTION_OPEN' && <button className="btn" onClick={() => cmd({ type: 'skip' }, '跳過本題？本題會標為不計分。')}>跳過本題</button>}
        {['REVEAL', 'TRANSITION', 'LEADERBOARD', 'ROUND_END'].includes(p) && <button className="btn" onClick={() => cmd({ type: 'reopen' }, '重開本題？本題已收的答案會作廢，所有人重新作答。')}>重開本題</button>}
        {!['LOBBY', 'QUESTION_OPEN', 'AWARDS', 'ABORTED'].includes(p) && <button className="btn" onClick={() => cmd({ type: 'showLeaderboard' })}>{state.showLeaderboard ? '收起排行榜' : '顯示排行榜'}</button>}
      </div>
      {p === 'QUESTION_OPEN' && state.paused && <p className="hint">暫停時學生與投影都看不到題目，避免趁機查答案；繼續後至少保留 3 秒作答。</p>}
    </section>
  );
}

function TimeBudget({ state, mon }: { state: GameState; mon: Monitor }) {
  if (!mon.startedAt || ['FINISHED', 'AWARDS', 'ABORTED', 'LOBBY'].includes(state.phase)) return null;
  const c = mon.config;
  const now = serverNow();
  const left = mon.plan.slice(mon.cursor + 1);
  const remainingSec = state.manualAdvance
    ? left.reduce((a, q) => a + q.seconds + (state.explanationSeconds ?? 10) + 20, 0) + (state.phase === 'QUESTION_OPEN' ? (state.endsAt ? Math.max(0, state.endsAt - now) / 1000 : (state.remainingMs ?? 0) / 1000) + (state.explanationSeconds ?? 10) + 20 : Math.max(0, ((state.explanationEndsAt ?? now) - now) / 1000) + 20)
    : left.reduce((a, q) => a + q.seconds + c.revealSeconds + c.transitionSeconds, 0) + (state.phase === 'QUESTION_OPEN' ? c.revealSeconds : 0) + ((state.endsAt ? Math.max(0, state.endsAt - now) : state.remainingMs ?? 0) / 1000);
  const elapsed = (now - mon.startedAt) / 1000;
  if (state.manualAdvance) return <section className="panel budget">
    <div><span>已進行</span><b>{fmtDuration(elapsed)}</b></div>
    <div><span>剩餘題數（含暖身）</span><b>{left.length}</b></div>
    <div><span>預計再</span><b>{fmtDuration(remainingSec)}</b></div>
    <div><span>預計比賽時間</span><b>{fmtDuration(mon.plan.length * (c.answerSeconds + (state.explanationSeconds ?? 10) + 20))}</b></div>
  </section>;
  const classSec = (c.classMinutes ?? 50) * 60;
  const projected = elapsed + remainingSec;
  const over = projected - classSec;
  const perQ = left.length ? (classSec - elapsed) / left.length - c.revealSeconds - c.transitionSeconds : 0;
  return (
    <section className={`panel budget${over > 0 ? ' over' : ''}`}>
      <div><span>已進行</span><b>{fmtDuration(elapsed)}</b></div>
      <div><span>剩餘題數</span><b>{left.length}</b></div>
      <div><span>預計再</span><b>{fmtDuration(remainingSec)}</b></div>
      <div><span>預計結束</span><b>{fmtDuration(projected)}</b><small>／{c.classMinutes ?? 50}:00</small></div>
      <p>{over > 0
        ? <>預計超出 {fmtDuration(over)}。要準時，剩下每題作答平均需 {Math.max(0, Math.floor(perQ))} 秒；可縮短轉場、改短秒數，或跳過部分題目。</>
        : <>依目前速度可準時，還有 {fmtDuration(-over)} 可用於講解。</>}</p>
    </section>
  );
}

function CurrentQuestion({ state, mon, showAns, setShowAns }: { state: GameState; mon: Monitor; showAns: boolean; setShowAns: (b: boolean) => void }) {
  const q = state.question;
  const item = mon.plan[mon.cursor];
  if (!item) return null;
  return (
    <section className="panel cur-q">
      <div className="row-actions">
        <h2>{(item.warmup || item.questionId.startsWith('WARMUP-')) ? `暖身 ${item.index}／2（不計分）` : `第 ${item.index - (state.warmupCount ?? 0)} 題`}　<span className="mono muted">{item.questionId}</span></h2>
        <span className="spacer" />
        <span className="answered"><b>{state.answeredCount}</b> / {state.participantCount} 已作答</span>
        {state.phase === 'QUESTION_OPEN' && <label className="toggle"><input type="checkbox" checked={showAns} onChange={(e) => setShowAns(e.target.checked)} /><span>顯示正解（筆電若正在投影請勿開啟）</span></label>}
      </div>
      {q ? (
        <>
          <p className="cq-stem">{q.stem}</p>
          <ol className="cq-opts">
            {OPTION_KEYS.map((k) => {
              const correct = (state.reveal?.correct ?? (showAns ? mon.currentCorrect : null)) === k;
              const n = state.reveal?.distribution[k];
              return <li key={k} className={correct ? 'correct' : ''}><b>{k}</b> {q.options[k]}{n != null && <span className="cnt">{n} 人</span>}</li>;
            })}
          </ol>
          {state.reveal?.voided && <p className="warn">本題已標記不計分</p>}
        </>
      ) : <p className="muted">{state.paused && state.phase === 'QUESTION_OPEN' ? '暫停中（學生端與投影已隱藏題目）' : '—'}</p>}
    </section>
  );
}

function Roster({ state, mon, cmd }: { state: GameState; mon: Monitor; cmd: (c: HostCommand, m?: string) => void }) {
  const groups = [...state.teams.map((t) => ({ t, ps: mon.participants.filter((p) => p.teamId === t.id && !p.lateJoin) })),
    { t: null, ps: mon.participants.filter((p) => p.teamId == null || p.lateJoin) }].filter((g) => g.t || g.ps.length);
  const live = state.phase === 'QUESTION_OPEN';
  return (
    <div className="roster">
      {groups.map(({ t, ps }) => (
        <div key={t?.id ?? 'none'} className="rg">
          <div className="rg-head" style={{ ['--team' as string]: t?.color ?? '#9aa' }}>{t ? <>{t.icon} {t.name}</> : '未分隊／中途加入'}<small>{ps.length} 人</small></div>
          <ul>
            {ps.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'off'}>
                <Avatar id={p.avatar} size={26} />
                <span className="rn">{p.nickname}{p.lateJoin && <small className="late">中途</small>}</span>
                {live && <span className={`ans-dot${p.answered ? ' on' : ''}`} aria-label={p.answered ? '已作答' : '未作答'} />}
                <span className={`conn-dot${p.connected ? ' on' : ''}`} aria-label={p.connected ? '在線' : '離線'} />
                {!state.rosterLocked && state.teams.length > 0 && (
                  <select aria-label={`${p.nickname} 換隊`} value={p.teamId ?? ''} onChange={(e) => cmd({ type: 'moveParticipant', participantId: p.id, teamId: Number(e.target.value) })}>
                    {state.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                )}
                <button className="icon-btn" aria-label={`移除 ${p.nickname}`} onClick={() => cmd({ type: 'removeParticipant', participantId: p.id }, `移除「${p.nickname}」？對方會被登出，成績不再列入。`)}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {mon.participants.length === 0 && <p className="muted">還沒有人加入</p>}
    </div>
  );
}

function PlanList({ state, mon, cmd }: { state: GameState; mon: Monitor; cmd: (c: HostCommand, m?: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <div className="row-actions"><h2>題目清單（{mon.plan.length} 題）</h2><span className="spacer" /><button className="btn-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '收合' : '展開：改秒數、作廢題目'}</button></div>
      {open && (
        <div className="table-wrap">
          <table className="qtable plan">
            <thead><tr><th>#</th><th>回合</th><th>題號</th><th>題幹</th><th>作答秒數</th><th>計分</th></tr></thead>
            <tbody>
              {mon.plan.map((p, i) => {
                const future = i > mon.cursor;
                const voided = mon.voided.includes(p.questionId);
                return (
                  <tr key={p.questionId} className={i === mon.cursor ? 'current' : voided ? 'inactive' : ''}>
                    <td>{(p.warmup || p.questionId.startsWith('WARMUP-')) ? `暖身 ${p.index}` : p.index - (state.warmupCount ?? 0)}</td><td>{p.roundNo}</td><td className="mono">{p.questionId}</td><td className="stem-cell">{p.stem}</td>
                    <td>{future && !state.manualAdvance ? (
                      <input className="secs-input" type="number" min={mon.config.minSeconds} max={mon.config.maxSeconds} defaultValue={p.customSeconds ?? ''} placeholder={String(p.seconds)}
                        aria-label={`第 ${p.index} 題秒數`}
                        onBlur={(e) => { const v = e.target.value; if (v !== String(p.customSeconds ?? '')) cmd({ type: 'setQuestionSeconds', questionId: p.questionId, seconds: v === '' ? null : Number(v) }); }} />
                    ) : `${p.seconds} 秒`}</td>
                    <td>{(p.warmup || p.questionId.startsWith('WARMUP-')) ? <span>暖身不計分</span> : p.closed ? (
                      <button className={`btn small${voided ? ' danger' : ''}`} onClick={() => cmd({ type: 'void', questionId: p.questionId, voided: !voided }, voided ? '恢復本題計分？' : '將本題標記為不計分？排行榜會立即重算並記錄。')}>{voided ? '不計分（恢復）' : '計分中'}</button>
                    ) : <span className="muted">{i === mon.cursor && state.phase === 'QUESTION_OPEN' ? '作答中' : '—'}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ImagePicker({ onPick, onClose }: { onPick: (f: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useAsync(() => api<string[]>(`/images?q=${encodeURIComponent(q)}`), [q]);
  return (
    <Modal title="投影講解圖片" onClose={onClose} wide>
      <input type="search" autoFocus placeholder="搜尋檔名（例：p097、第99-13條）" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋圖片" />
      <div className="asset-grid pick">
        {list.data?.map((f) => (
          <button key={f} className="asset" onClick={() => onPick(f)}><img loading="lazy" src={assetUrl(f)} alt="" /><span>{f}</span></button>
        ))}
        {list.data?.length === 0 && <p className="muted">沒有符合的圖片。圖片放在 data/images 資料夾。</p>}
      </div>
    </Modal>
  );
}
