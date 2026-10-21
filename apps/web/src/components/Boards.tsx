import type { LeaderRow, TeamRow, TeamInfo } from '@uqa/shared';
import { Avatar } from './Avatar';

const secs = (ms: number) => (ms / 1000).toFixed(1);

export function Leaderboard({ rows, teams, compact, highlight }: { rows: LeaderRow[]; teams: TeamInfo[]; compact?: boolean; highlight?: number }) {
  if (!rows.length) return <p className="empty">還沒有成績</p>;
  return (
    <ol className={`lb${compact ? ' compact' : ''}`}>
      {rows.map((r) => {
        const t = teams.find((x) => x.id === r.teamId);
        return (
          <li key={r.participantId} className={`lb-row${r.participantId === highlight ? ' me' : ''}${r.rank <= 3 ? ` top${r.rank}` : ''}`} style={{ ['--team' as string]: t?.color ?? '#999' }}>
            <span className="lb-rank">{r.rank}</span>
            <Avatar id={r.avatar} size={compact ? 34 : 46} />
            <span className="lb-name">{r.nickname}{r.lateJoin && <small className="late">中途加入</small>}</span>
            <span className="lb-team" title={t?.name}>{t ? <><span aria-hidden>{t.icon}</span> {t.name}</> : '—'}</span>
            <span className="lb-score"><b>{r.points ?? r.correct * 1000}</b> 分 <small>／{r.correct} 題</small></span>
            {!compact && <span className="lb-time">{secs(r.timeMs)} 秒</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function TeamBoard({ rows, compact }: { rows: TeamRow[]; compact?: boolean }) {
  if (!rows.length) return <p className="empty">尚未分隊</p>;
  return (
    <ol className={`tb${compact ? ' compact' : ''}`}>
      {rows.map((t) => (
        <li key={t.teamId} className="tb-row" style={{ ['--team' as string]: t.color }}>
          <span className="tb-rank">{t.rank}</span>
          <span className="tb-name"><span aria-hidden>{t.icon}</span> {t.name}</span>
          <span className="tb-bar" aria-hidden="true"><span style={{ width: `${Math.round(t.accuracy * 100)}%` }} /></span>
          <span className="tb-pct"><b>{Math.round(t.accuracy * 1000) / 10}</b>%</span>
          {!compact && <span className="tb-members">{t.members} 人</span>}
          <small className="tb-formula">{t.scoredQuestions ? <>{t.members} 人 × {t.scoredQuestions} 題＝{t.members * t.scoredQuestions} 次應答；答對 {t.correct} 次</> : <>{t.members} 人 · 尚無正式計分題</>}</small>
        </li>
      ))}
    </ol>
  );
}
