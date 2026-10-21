import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate, useParams } from '../../lib/router';
import { OPTION_KEYS, type MyStatus, type OptionKey, type ParticipantView, type GameState } from '@uqa/shared';
import { useLive } from '../../lib/live';
import { useCountdown } from '../../lib/hooks';
import { loadToken, saveToken, testerSuffix } from './Join';
import { OptionTiles } from '../../components/OptionTiles';
import { PropRingAuto } from '../../components/PropRing';
import { Avatar, TeamChip } from '../../components/Avatar';
import { Leaderboard, TeamBoard } from '../../components/Boards';
import { sfx } from '../../lib/sound';

export default function Play() {
  const { code = '' } = useParams();
  const nav = navigate;
  const token = loadToken(code);
  const pollPath = useMemo(() => (token ? `/play/poll?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}` : null), [code, token]);
  const [pending, setPending] = useState<{ qid: string; option: OptionKey } | null>(null);
  const [notice, setNotice] = useState('');
  const [localAnswer, setLocalAnswer] = useState<{ qid: string; option: OptionKey } | null>(null);
  const { state, status: conn, extra, send } = useLive<{ me: MyStatus; joined: ParticipantView }>(pollPath, 1000);
  const me = extra?.joined ?? null;
  useEffect(() => { document.title = `${me?.nickname ?? '學生'}｜作答畫面`; }, [me?.nickname]);
  const serverStatus = extra?.me ?? null;
  // 伺服器狀態還沒回來前，先顯示剛送出的答案
  const status: MyStatus | null = serverStatus && localAnswer && state?.question?.questionId === localAnswer.qid && !serverStatus.myAnswer
    ? { ...serverStatus, myAnswer: localAnswer.option } : serverStatus;
  const kicked = conn === 'kicked' ? '你已被老師移出本場次' : '';
  useEffect(() => { if (kicked) saveToken(code, null); }, [kicked, code]);

  useEffect(() => { if (!token) nav(`/join/${code}${testerSuffix()}`, { replace: true }); }, [token, code, nav]);
  useEffect(() => {
    if (conn === 'denied' && !kicked) { saveToken(code, null); nav(`/join/${code}${testerSuffix()}`, { replace: true }); }
  }, [conn, code, nav, kicked]);

  // 答對／答錯回饋音（手機端，靜音設定共用）
  const prevPhase = useRef('');
  useEffect(() => {
    if (!state) return;
    const key = `${state.phase}|${state.question?.questionId}`;
    if (key !== prevPhase.current && state.phase === 'REVEAL' && state.reveal && status?.myAnswer) {
      state.reveal.correct === status.myAnswer ? sfx.correct() : sfx.neutral();
    }
    prevPhase.current = key;
  }, [state, status]);

  // 斷線期間的待送答案，重連後補送（伺服器以唯一鍵去重，逾時一律拒絕）
  useEffect(() => {
    if (conn === 'online' && pending && state?.question?.questionId === pending.qid && state.phase === 'QUESTION_OPEN') void submit(pending.option);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  const submit = async (option: OptionKey) => {
    if (!state?.question) return;
    const qid = state.question.questionId;
    setPending({ qid, option });
    try {
      const r = await send<{ ok: boolean; message: string; option?: OptionKey }>('/play/answer', { code, token, questionId: qid, option });
      setPending(null);
      if (!r.ok) setNotice(r.message);
      else setLocalAnswer({ qid, option: r.option ?? option });
    } catch {
      setNotice('網路不穩，恢復連線後會自動補送');
    }
  };
  useEffect(() => {
    setNotice('');
    if (state?.phase === 'REVEAL') { setLocalAnswer(null); setPending(null); }
  }, [state?.question?.questionId, state?.phase]);

  if (kicked) return <div className="play play-msg"><h1>已離開場次</h1><p>{kicked}</p></div>;
  if (!state || !me) return <div className="play play-msg"><h1>連線中…</h1>{conn === 'offline' && <p>網路似乎中斷了，正在重試</p>}</div>;

  return (
    <div className={`play phase-${state.phase.toLowerCase()}`}>
      <header className="play-head">
        <Avatar id={me.avatar} size={36} ring={state.teams.find((t) => t.id === status?.teamId)?.color} />
        <span className="ph-name">{me.nickname}</span>
        <TeamChip team={state.teams.find((t) => t.id === (status?.teamId ?? me.team?.id)) ?? null} small />
        <span className="ph-score">{status?.points ?? 0} 分</span>
      </header>
      {conn !== 'online' && <div className="conn-banner">連線中斷，正在重新連線…你的身分會保留</div>}
      <PlayBody state={state} me={me} status={status} pending={pending} onPick={submit} notice={notice} />
    </div>
  );
}

function PlayBody({ state, me, status, pending, onPick, notice }: {
  state: GameState; me: ParticipantView; status: MyStatus | null; pending: { qid: string; option: OptionKey } | null;
  onPick: (k: OptionKey) => void; notice: string;
}) {
  const ms = useCountdown(state.endsAt, state.remainingMs);
  const q = state.question;
  const myTeam = state.teams.find((t) => t.id === (status?.teamId ?? me.team?.id)) ?? null;

  if (state.phase === 'LOBBY') {
    return (
      <div className="play-center">
        <Avatar id={me.avatar} size={120} ring={myTeam?.color} />
        <h2>{me.nickname}</h2>
        {myTeam ? <p className="big-team" style={{ background: myTeam.color }}>{myTeam.icon} 你是 {myTeam.name}</p> : <p className="muted">等待分組中</p>}
        <p className="muted">看投影幕，老師開始後題目會出現在這裡</p>
      </div>
    );
  }
  if (state.phase === 'ABORTED') return <div className="play-center"><h2>本場次已終止</h2></div>;
  if (state.phase === 'QUESTION_OPEN' && state.paused) return <div className="play-center"><div className="paused-badge">暫停中</div><p className="muted">倒數凍結，等老師繼續</p></div>;

  if (state.phase === 'QUESTION_OPEN' && q) {
    const picked = status?.myAnswer ?? (pending?.qid === q.questionId ? pending.option : null);
    return (
      <div className="play-q">
        <div className="pq-top">
          <span className="pq-idx">{(q.warmup || q.questionId.startsWith('WARMUP-')) ? `暖身 ${q.index}／2` : `第 ${q.index - (state.warmupCount ?? 0)} 題`} <small>/ {(q.warmup || q.questionId.startsWith('WARMUP-')) ? '不計分' : q.total - (state.warmupCount ?? 0)}</small></span>
          <PropRingAuto ms={ms} k={q.questionId + state.version} size={56} />
        </div>
        <p className="pq-stem">{q.stem}</p>
        {picked ? (
          <div className="locked">
            <div className={`locked-tile tile-${picked}`}>{picked}</div>
            <p>{status?.myAnswer ? '已作答，等待公布答案' : '送出中…'}</p>
          </div>
        ) : (
          <OptionTiles mode="phone" options={q.options} onPick={onPick} />
        )}
        {notice && <p className="notice" role="status">{notice}</p>}
      </div>
    );
  }
  if (state.phase === 'REVEAL' && q && state.reveal) {
    const mine = status?.myAnswer;
    const ok = mine && mine === state.reveal.correct;
    const warmup = q.warmup || q.questionId.startsWith('WARMUP-');
    const correct = state.reveal.correct;
    return (
      <div className={`play-center reveal ${state.reveal.voided ? 'answer-void' : ok ? 'answer-correct' : mine ? 'answer-wrong' : 'answer-missed'}`}>
        <div className="answer-result" role="status">
          <span className="answer-result-icon" aria-hidden>{state.reveal.voided ? '—' : ok ? '✓' : mine ? '✕' : '！'}</span>
          <h2>{state.reveal.voided ? '本題不計分' : ok ? '答對了！' : mine ? '答錯了！' : '這題沒有作答'}</h2>
          {warmup && <p>暖身題，不計分</p>}
          {!state.reveal.voided && !ok && <p>正確答案是 <b>{correct}</b></p>}
        </div>
        <section className="answer-review" aria-label="本題題目與答案">
          <div className="answer-question"><span>{warmup ? `暖身第 ${q.index} 題` : `第 ${q.index - (state.warmupCount ?? 0)} 題`}</span><h3>{q.stem}</h3></div>
          <ol className="answer-options">{OPTION_KEYS.map(key => <li key={key} className={key === correct ? 'review-correct' : key === mine ? 'review-wrong' : ''}>
            <b className="review-key">{key}</b><div><p>{q.options[key]}</p>{key === correct ? <strong className="review-label">✓ 正確答案{key === mine ? '・你的答案' : ''}</strong> : key === mine ? <strong className="review-label">✕ 你的答案</strong> : null}</div>
          </li>)}</ol>
        </section>
        {!q.warmup && !q.questionId.startsWith('WARMUP-') && <div className="my-stats">
          <div><b>+{status?.questionPoints ?? 0}</b><span>本題得分（含速度加分）</span></div>
          <div><b>{status?.questionRank ?? '—'}</b><span>本題排名</span></div>
          <div><b>{status?.points ?? 0}</b><span>累積分數</span></div>
        </div>}
        {state.questionBoard && <section><h3>本題即時排名</h3><Leaderboard rows={state.questionBoard.slice(0, 5)} teams={state.teams} compact highlight={me.participantId} /></section>}
        {state.teamBoard && <section><h3>分組排名（累積）</h3><TeamBoard rows={state.teamBoard} compact /></section>}
        {state.explaining && <p className="muted">等待主持人，請看投影幕</p>}
        <p className="muted">目前答對 {status?.correct ?? 0} 題{status?.rank ? `，第 ${status.rank} 名` : ''}</p>
      </div>
    );
  }
  const final = state.phase === 'FINISHED' || state.phase === 'AWARDS';
  return (
    <div className="play-center">
      <h2>{final ? '比賽結束' : state.phase === 'ROUND_END' ? '回合結束' : '準備下一題'}</h2>
      <div className="my-stats">
        <div><b>{status?.rank ?? '—'}</b><span>個人名次</span></div>
        <div><b>{status?.points ?? 0}</b><span>累積分數</span></div>
        <div><b>{status?.teamRank ?? '—'}</b><span>隊伍名次</span></div>
      </div>
      {(state.showLeaderboard || ['LEADERBOARD', 'ROUND_END', 'FINISHED', 'AWARDS'].includes(state.phase)) && state.leaderboard && (
        <Leaderboard rows={state.leaderboard} teams={state.teams} compact highlight={me.participantId} />
      )}
      {state.phase === 'TRANSITION' && ms != null && <p className="muted">{Math.ceil(ms / 1000)} 秒後下一題</p>}
    </div>
  );
}
