import type { OptionKey } from './types.ts';

export interface ScoringParticipant {
  id: number;
  teamId: number | null;
  joinOrder: number;
  lateJoin: boolean;
  removed: boolean;
}
export interface ScoringAnswer {
  points?: number;
  participantId: number;
  questionId: string;
  option: OptionKey;
  correct: boolean;
  /** 伺服器開題至伺服器接受的毫秒數 */
  elapsedMs: number;
}
export interface IndividualResult {
  participantId: number;
  correct: number;
  points: number;
  timeMs: number;
  rank: number;
}
export interface TeamResult {
  scoredQuestions: number;
  teamId: number;
  members: number;
  correct: number;
  accuracy: number;
  avgTimeMs: number;
  rank: number;
}

/**
 * 個人排名（SPEC §4.3）：答對題數優先；同分比答對題目的有效作答耗時總和（短者優先）；
 * 仍相同則依加入順序（穩定 tie-break）。
 */
export function rankIndividuals(
  participants: ScoringParticipant[],
  answers: ScoringAnswer[],
  scoredQuestionIds: Set<string>,
): IndividualResult[] {
  const map = new Map<number, IndividualResult & { joinOrder: number }>();
  for (const p of participants) {
    if (p.removed) continue;
    map.set(p.id, { participantId: p.id, correct: 0, points: 0, timeMs: 0, rank: 0, joinOrder: p.joinOrder });
  }
  for (const a of answers) {
    if (!scoredQuestionIds.has(a.questionId) || !a.correct) continue;
    const r = map.get(a.participantId);
    if (!r) continue;
    r.correct += 1;
    r.points += a.points ?? 1000;
    r.timeMs += a.elapsedMs;
  }
  const rows = [...map.values()].sort(
    (x, y) => y.points - x.points || y.correct - x.correct || x.timeMs - y.timeMs || x.joinOrder - y.joinOrder,
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows.map(({ joinOrder: _j, ...r }) => r);
}

/**
 * 團隊排名：答對總次數 ÷（符合資格隊員人數 × 正式計分題數）。
 * 缺答計 0；中途加入與被移除者不列入隊伍計算。
 * 同分比全體隊員答對題目的平均有效反應時間，再同分則並列。
 */
export function rankTeams(
  teamIds: number[],
  participants: ScoringParticipant[],
  answers: ScoringAnswer[],
  scoredQuestionIds: Set<string>,
): TeamResult[] {
  const eligible = participants.filter((p) => !p.removed && !p.lateJoin && p.teamId != null);
  const byPid = new Map(eligible.map((p) => [p.id, p]));
  const acc = new Map<number, { members: number; correct: number; time: number }>();
  for (const t of teamIds) acc.set(t, { members: 0, correct: 0, time: 0 });
  for (const p of eligible) {
    const a = acc.get(p.teamId!);
    if (a) a.members += 1;
  }
  for (const ans of answers) {
    if (!ans.correct || !scoredQuestionIds.has(ans.questionId)) continue;
    const p = byPid.get(ans.participantId);
    if (!p) continue;
    const a = acc.get(p.teamId!);
    if (!a) continue;
    a.correct += 1;
    a.time += ans.elapsedMs;
  }
  const n = scoredQuestionIds.size;
  const rows: TeamResult[] = [...acc.entries()].map(([teamId, a]) => ({
    teamId,
    members: a.members,
    correct: a.correct,
    scoredQuestions: n,
    accuracy: a.members > 0 && n > 0 ? a.correct / (a.members * n) : 0,
    avgTimeMs: a.correct > 0 ? a.time / a.correct : 0,
    rank: 0,
  }));
  const EPS = 1e-9;
  rows.sort((x, y) => {
    if (Math.abs(y.accuracy - x.accuracy) > EPS) return y.accuracy - x.accuracy;
    if (x.correct === 0 && y.correct === 0) return x.teamId - y.teamId;
    return x.avgTimeMs - y.avgTimeMs || x.teamId - y.teamId;
  });
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (prev && Math.abs(prev.accuracy - r.accuracy) <= EPS && Math.round(prev.avgTimeMs) === Math.round(r.avgTimeMs)) {
      r.rank = prev.rank; // 並列
    } else r.rank = i + 1;
  });
  return rows;
}

/** 平均分隊：回傳每位參賽者的隊伍索引（0 起），每隊人數差距最多 1 */
export function balancedTeams<T>(items: T[], teamCount: number, rand: () => number = Math.random): T[][] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const teams: T[][] = Array.from({ length: teamCount }, () => []);
  arr.forEach((x, i) => teams[i % teamCount].push(x));
  return teams;
}

/** 依人數計算隊伍數：每隊目標約 6 人，至少 2 隊（人數 ≥ 2 時） */
export function autoTeamCount(n: number, target = 6): number {
  if (n <= 1) return 1;
  return Math.max(2, Math.ceil(n / target));
}
