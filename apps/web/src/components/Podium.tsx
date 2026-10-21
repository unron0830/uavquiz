import type { LeaderRow, TeamInfo, TeamRow } from '@uqa/shared';
import { Avatar } from './Avatar';

export function Podium({ rows, teams }: { rows: LeaderRow[]; teams: TeamInfo[] }) {
  const top = rows.filter((r) => r.rank <= 3).slice(0, 3);
  const order = [top.find((r) => r.rank === 2), top.find((r) => r.rank === 1), top.find((r) => r.rank === 3)];
  return (
    <div className="podium">
      {order.map((r, i) => {
        if (!r) return <div key={i} className="pod pod-empty" />;
        const t = teams.find((x) => x.id === r.teamId);
        const place = r.rank;
        return (
          <div key={r.participantId} className={`pod pod-${place}`}>
            <div className="pod-person">
              {place === 1 && <div className="crown" aria-hidden>👑</div>}
              <Avatar id={r.avatar} size={place === 1 ? 168 : 104} ring={t?.color} />
              <div className="pod-name">{r.nickname}</div>
              <div className="pod-meta">{t && <span style={{ color: t.color }}>{t.icon} {t.name}</span>} <span>{r.points ?? r.correct * 1000} 分 · 答對 {r.correct} 題</span></div>
            </div>
            <div className="pod-block"><span>{place}</span></div>
          </div>
        );
      })}
    </div>
  );
}

export function TeamChampion({ team, members }: { team: TeamRow | undefined; members: { nickname: string; avatar: string }[] }) {
  if (!team) return null;
  return (
    <div className="team-champ" style={{ ['--team' as string]: team.color }}>
      <div className="tc-badge"><span aria-hidden>{team.icon}</span></div>
      <h2>團體冠軍　{team.name}</h2>
      <p className="tc-total">團隊答對率 <b>{Math.round(team.accuracy * 1000) / 10}%</b></p>
      <div className="tc-calculation">
        {team.members > 0 && team.scoredQuestions > 0 ? <><p>{team.members} 位隊員 × {team.scoredQuestions} 題正式計分題＝{team.members * team.scoredQuestions} 次應答</p><p>全隊答對 {team.correct} 次 ÷ {team.members * team.scoredQuestions} 次應答＝{Math.round(team.accuracy * 1000) / 10}%</p></> : <p>尚無正式計分題成績</p>}
        <small>未答算錯；暖身、作廢題、中途加入及已移除者不列入。<br />同答對率時，比答對題的平均作答時間，較快者優先。</small>
      </div>
      <ul className="tc-members">
        {members.map((m, i) => <li key={i}><Avatar id={m.avatar} size={64} /><span>{m.nickname}</span></li>)}
      </ul>
    </div>
  );
}
