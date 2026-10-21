import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from '../../lib/router';
import type { GameState } from '@uqa/shared';
import { useLive } from '../../lib/live';
import { api } from '../../lib/api';
import { hashQuery } from '../../lib/router';
import { Qr } from '../../components/Qr';
import { useCountdown } from '../../lib/hooks';
import { sfx, unlockAudio, audioReady, isMuted, setMuted } from '../../lib/sound';
import { PropRingAuto } from '../../components/PropRing';
import { FlightPath } from '../../components/FlightPath';
import { OptionTiles } from '../../components/OptionTiles';
import { Leaderboard, TeamBoard } from '../../components/Boards';
import { Podium, TeamChampion } from '../../components/Podium';
import { Confetti } from '../../components/Confetti';
import { ExplanationPanel } from '../../components/Explanation';
import { Avatar } from '../../components/Avatar';

interface StageInfo { code: string; joinUrl: string; rounds: number[] }

export default function Stage() {
  const { id } = useParams();
  useEffect(() => { document.title = '電腦投影｜無人機知識王'; }, []);
  const token = hashQuery().get('t') ?? '';
  const pollPath = useMemo(() => (token ? `/stage/poll?id=${encodeURIComponent(String(id))}&t=${encodeURIComponent(token)}` : null), [id, token]);
  const { state, status } = useLive(pollPath, 700);
  const [info, setInfo] = useState<StageInfo | null>(null);
  const [soundAsked, setSoundAsked] = useState(audioReady());
  const [muted, setMutedState] = useState(isMuted());
  const [fs, setFs] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<StageInfo>(`/stage/info?id=${encodeURIComponent(String(id))}&t=${encodeURIComponent(token)}`).then(setInfo).catch(() => null);
  }, [id, token]);
  useEffect(() => { const f = () => setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);

  useStageSounds(state, soundAsked && !muted);

  if (!token || status === 'denied' || status === 'kicked') return <div className="stage stage-msg"><h1>舞台網址無效</h1><p>請從教師控制台重新開啟投影頁。</p></div>;
  if (!state) return <div className="stage stage-msg"><h1>連線中…</h1></div>;

  return (
    <div className={`stage phase-${state.phase.toLowerCase()}`}>
      <div className="stage-tools">
        {!fs && <button onClick={() => document.documentElement.requestFullscreen?.()}>全螢幕</button>}
        <button onClick={() => { const m = !muted; setMuted(m); setMutedState(m); }} aria-pressed={muted}>{muted ? '🔇 已靜音' : '🔊 音效'}</button>
      </div>
      {!soundAsked && (
        <div className="sound-ask" role="dialog" aria-label="啟用音效">
          <p>要在投影時播放音效嗎？</p>
          <button className="btn3d" onClick={() => { unlockAudio(); setSoundAsked(true); }}>啟用音效</button>
          <button className="btn-link" onClick={() => { setMuted(true); setMutedState(true); setSoundAsked(true); }}>先不要</button>
        </div>
      )}
      {status !== 'online' && <div className="conn-banner">連線中斷，正在重新連線…</div>}
      <StageBody state={state} info={info} />
    </div>
  );
}

function useStageSounds(state: GameState | null, on: boolean) {
  const prev = useRef<string>('');
  const ms = useCountdown(state?.endsAt ?? null, state?.remainingMs ?? null);
  const lastTick = useRef(-1);
  useEffect(() => {
    if (!state || !on || !state.soundEnabled) return;
    const key = `${state.phase}|${state.question?.index ?? ''}|${state.paused}`;
    if (key === prev.current) return;
    const was = prev.current.split('|')[0];
    prev.current = key;
    if (state.phase === 'QUESTION_OPEN' && !state.paused && was !== 'QUESTION_OPEN') sfx.open();
    if (state.phase === 'REVEAL' && was === 'QUESTION_OPEN') sfx.reveal();
    if (state.phase === 'AWARDS') sfx.fanfare();
  }, [state, on]);
  useEffect(() => {
    if (!state || !on || !state.soundEnabled || state.phase !== 'QUESTION_OPEN' || ms == null) return;
    const s = Math.ceil(ms / 1000);
    if (s <= 5 && s > 0 && s !== lastTick.current) { lastTick.current = s; sfx.tick(); }
  }, [ms, state, on]);
}

function StageBody({ state, info }: { state: GameState; info: StageInfo | null }) {
  const ms = useCountdown(state.endsAt, state.remainingMs);
  const rounds = info?.rounds ?? [];
  const q = state.question;

  if (state.phase === 'LOBBY') return <Lobby state={state} info={info} />;
  if (state.phase === 'ABORTED') return <div className="stage-center"><h1 className="stage-title">本場次已終止</h1><p className="stage-sub">成績不列入正式紀錄</p></div>;
  if (state.phase === 'AWARDS') return <Awards state={state} />;

  if (state.showLeaderboard || ['LEADERBOARD', 'ROUND_END', 'FINISHED'].includes(state.phase)) {
    const heading = state.phase === 'FINISHED' ? '比賽結束　最終排名' : state.phase === 'ROUND_END' ? `第 ${q?.roundNo ?? ''} 回合結束` : '目前排名';
    return (
      <div className="stage-boards">
        <h1 className="boards-title">{state.phase === 'ROUND_END' ? '回合結束' : heading}</h1>
        <div className="boards-grid">
          <section><h2>個人前 10 名</h2><Leaderboard rows={state.leaderboard ?? []} teams={state.teams} /></section>
          <section><h2>團體排名</h2><TeamBoard rows={state.teamBoard ?? []} /></section>
        </div>
        {state.phase === 'LEADERBOARD' && ms != null && <p className="boards-next">下一題 {Math.ceil(ms / 1000)} 秒後開始</p>}
        {state.phase === 'ROUND_END' && <p className="boards-next">等待老師開始下一回合</p>}
      </div>
    );
  }
  if (state.phase === 'TRANSITION') {
    return <div className="stage-center"><div className="next-up">下一題</div><PropRingAuto ms={ms} k={'t' + state.version} size={180} /></div>;
  }
  if (state.phase === 'QUESTION_OPEN' && state.paused) {
    return <div className="stage-center"><div className="paused-badge">暫停中</div><p className="stage-sub">老師暫停了作答，題目先隱藏，倒數凍結</p></div>;
  }
  if (!q) return <div className="stage-center"><PropRingAuto ms={ms} k="x" /></div>;
  const reveal = state.reveal;
  const ex = reveal?.explanation;
  const hasEx = !!(state.adhoc || (ex && ((state.showExplanationText && ex.text) || ex.lawReference || ex.lawExcerpt || ex.images.length)));
  const showEx = !!reveal && (state.manualAdvance ? state.showDetails : state.explaining) && hasEx;
  return (
    <div className={`stage-q${showEx || (reveal && state.questionBoard) ? ' with-ex' : ''}`}>
      <header className="sq-head">
        <div className="sq-round">{(q.warmup || q.questionId.startsWith('WARMUP-')) ? '暖身題' : '正式題'}<b>{(q.warmup || q.questionId.startsWith('WARMUP-')) ? q.index : q.index - (state.warmupCount ?? 0)}</b><span>/ {(q.warmup || q.questionId.startsWith('WARMUP-')) ? 2 : q.total - (state.warmupCount ?? 0)}</span></div>
        {state.phase === 'QUESTION_OPEN'
          ? <PropRingAuto ms={ms} k={q.questionId + state.version} />
          : <div className={`sq-state${reveal?.voided ? ' voided' : ''}`}>{(q.warmup || q.questionId.startsWith('WARMUP-')) ? '暖身不計分' : reveal?.voided ? '本題不計分' : state.showDetails ? '詳解' : state.manualAdvance ? '等待主持人下一題' : state.explaining ? '講解中' : '正確答案'}</div>}
        <div className="sq-answered"><b>{state.answeredCount}</b><span>/ {state.participantCount} 已作答</span></div>
      </header>
      <div className="sq-main">
        <div className="sq-left">
          <div className="sq-card"><p className="sq-stem">{q.stem}</p></div>
          <OptionTiles mode="stage" options={q.options} correct={reveal?.correct} distribution={reveal ? reveal.distribution : null} />
        </div>
        {reveal && state.questionBoard && <aside className="sq-ex">{showEx && <ExplanationPanel key={q.questionId} ex={reveal.explanation} adhoc={state.adhoc} showText={state.showExplanationText} answerText={q.options[reveal.correct]} />}<h2>本題即時排名</h2><Leaderboard rows={state.questionBoard.slice(0, 5)} teams={state.teams} compact /><h3>累積個人排名</h3><Leaderboard rows={(state.leaderboard ?? []).slice(0, 3)} teams={state.teams} compact /><h3>分組排名（累積）</h3><TeamBoard rows={state.teamBoard ?? []} compact /><p className="hint">團隊答對率＝全隊答對次數 ÷（隊員人數 × 正式計分題數）。同率比答對題平均作答時間；未答算錯，暖身、作廢題、中途加入及已移除者不列入。</p></aside>}
        {showEx && !state.questionBoard && <aside className="sq-ex"><ExplanationPanel ex={reveal!.explanation} adhoc={state.adhoc} showText={state.showExplanationText} answerText={q.options[reveal!.correct]} /></aside>}
      </div>
      <FlightPath index={q.index} total={q.total} rounds={rounds.length ? rounds : [q.total]} />
    </div>
  );
}

function Lobby({ state, info }: { state: GameState; info: StageInfo | null }) {
  return (
    <div className="lobby">
      <div className="lobby-left">
        <h1 className="brand-title"><span>無人機</span>知識王</h1>
        <p className="lobby-course">{state.courseTitle}</p>
        <ol className="lobby-steps">
          <li>手機掃 QR Code，或到網址輸入代碼</li>
          <li>輸入學號、姓名或暱稱，選頭像，免登入</li>
          <li>答對 1,000 分，越快再加最多 500 分；每題公布即時排名</li>
        </ol>
        <p className="lobby-wait">入場後請確認自己的隊伍，等待主持人開始比賽</p>
      </div>
      <div className="lobby-right">
        <div className="qr-card">
          {info ? <Qr className="qr" text={info.joinUrl} /> : <div className="qr" />}
          <div className="code-label">代碼</div>
          <div className="code">{state.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
          {info && <div className="join-url">{info.joinUrl.replace(/^https?:\/\//, '').replace(/#\/join\/\d+$/, '')}</div>}
        </div>
        <div className="lobby-count"><b>{state.participantCount}</b>／{state.maxParticipants ?? 100} 人已加入</div>
      </div>
      <LobbyTeams state={state} />
    </div>
  );
}

function LobbyTeams({ state }: { state: GameState }) {
  const rows = state.roster ?? [];
  const groups = state.teams.map(t => ({ team: t, members: rows.filter(r => r.teamId === t.id) }));
  const unassigned = rows.filter(r => !state.teams.some(t => t.id === r.teamId));
  return <section className="lobby-roster" aria-label="各隊入場名單" aria-live="polite">
    <h2>各隊入場名單 <small>等待主持人按「開始比賽」</small></h2>
    {state.teams.length > 0 && <p className="lobby-team-size">共 <b>{state.teams.length} 隊</b> · {state.maxTeamSize ? <>每組最多 <b>{state.maxTeamSize} 人</b><small>滿員後自動新增隊伍</small></> : state.participantCount > 0 ? <>每隊最多 <b>{Math.ceil(state.participantCount / state.teams.length)} 人</b><small>依目前 {state.participantCount} 位入場人數計算</small></> : '等待學生入場後顯示每隊人數'}</p>}
    {!groups.length && <p>等待主持人設定隊伍數，學生可先加入。</p>}
    <div className="lobby-team-grid">
      {groups.map(({ team, members }) => <section className="lobby-team-card" key={team.id} style={{ borderColor: team.color }}>
        <h3><span style={{ color: team.color }}>{team.icon} {team.name}</span><small>{members.length}{state.maxTeamSize ? `／${state.maxTeamSize}` : ''} 人</small></h3>
        <div className="lobby-team-members">{members.map(r => <span key={r.id} className="lobby-member"><Avatar id={r.avatar} size={36} ring={team.color} /><span>{r.nickname}</span></span>)}</div>
        {!members.length && <p className="lobby-team-empty">等待同學加入…</p>}
      </section>)}
      {unassigned.length > 0 && <section className="lobby-team-card"><h3>等待分隊 <small>{unassigned.length} 人</small></h3><div className="lobby-team-members">{unassigned.map(r => <span key={r.id} className="lobby-member"><Avatar id={r.avatar} size={36} /><span>{r.nickname}</span></span>)}</div></section>}
    </div>
  </section>;
}

function Awards({ state }: { state: GameState }) {
  const [view, setView] = useState<'solo' | 'team'>('solo');
  useEffect(() => {
    const t = setTimeout(() => setView('team'), 12000);
    const k = (e: KeyboardEvent) => { if (['ArrowRight', 'ArrowLeft', ' '].includes(e.key)) setView((v) => (v === 'solo' ? 'team' : 'solo')); };
    window.addEventListener('keydown', k);
    return () => { clearTimeout(t); window.removeEventListener('keydown', k); };
  }, []);
  const champTeam = state.teamBoard?.find((t) => t.rank === 1);
  const members = state.championMembers ?? [];
  return (
    <div className="awards" onClick={() => setView(view === 'solo' ? 'team' : 'solo')}>
      <Confetti key={view} />
      {view === 'solo' ? (
        <>
          <h1 className="awards-title">個人冠軍</h1>
          <Podium rows={state.leaderboard ?? []} teams={state.teams} />
        </>
      ) : (
        <TeamChampion team={champTeam} members={members} />
      )}
      <p className="awards-hint">按空白鍵或點一下切換{view === 'solo' ? '團體' : '個人'}頒獎</p>
    </div>
  );
}
