import { describe, expect, it } from 'vitest';
import { rankIndividuals, rankTeams, balancedTeams, autoTeamCount, estimateCourse, splitRounds, DEFAULT_SETTINGS, validateQuestionRow, csvSafe, validateNickname } from '@uqa/shared';

const P = (id: number, teamId: number | null, extra: Partial<{ lateJoin: boolean; removed: boolean }> = {}) => ({ id, teamId, joinOrder: id, lateJoin: false, removed: false, ...extra });
const A = (pid: number, q: string, correct: boolean, ms: number) => ({ participantId: pid, questionId: q, option: 'A' as const, correct, elapsedMs: ms });

describe('個人排名', () => {
  it('答對題數優先於速度', () => {
    const r = rankIndividuals([P(1, 1), P(2, 1)], [A(1, 'q1', true, 9000), A(1, 'q2', true, 9000), A(2, 'q1', true, 100), A(2, 'q2', false, 100)], new Set(['q1', 'q2']));
    expect(r[0].participantId).toBe(1);
    expect(r[0].correct).toBe(2);
  });
  it('同分時答對題目耗時總和較短者在前', () => {
    const r = rankIndividuals([P(1, 1), P(2, 1)], [A(1, 'q1', true, 5000), A(2, 'q1', true, 3000)], new Set(['q1']));
    expect(r.map((x) => x.participantId)).toEqual([2, 1]);
  });
  it('答錯題目的耗時不影響同分比較', () => {
    const r = rankIndividuals([P(1, 1), P(2, 1)], [A(1, 'q1', true, 3000), A(1, 'q2', false, 1), A(2, 'q1', true, 3000), A(2, 'q2', false, 19000)], new Set(['q1', 'q2']));
    expect(r.map((x) => x.participantId)).toEqual([1, 2]); // 再相同依加入順序（穩定）
  });
  it('作廢題目不計分', () => {
    const r = rankIndividuals([P(1, 1), P(2, 1)], [A(1, 'q1', true, 1000), A(2, 'q2', true, 1000)], new Set(['q2']));
    expect(r[0].participantId).toBe(2);
    expect(r.find((x) => x.participantId === 1)!.correct).toBe(0);
  });
  it('被移除者不列入', () => {
    const r = rankIndividuals([P(1, 1, { removed: true }), P(2, 1)], [A(1, 'q1', true, 1)], new Set(['q1']));
    expect(r.map((x) => x.participantId)).toEqual([2]);
  });
});

describe('團隊排名', () => {
  it('六人隊與五人隊用平均答對率，人多不會自動領先', () => {
    const six = [1, 2, 3, 4, 5, 6].map((i) => P(i, 10));
    const five = [7, 8, 9, 10, 11].map((i) => P(i, 20));
    const ans = [
      ...six.slice(0, 3).map((p) => A(p.id, 'q1', true, 1000)), // 6 人中 3 人答對 → 50%
      ...five.slice(0, 3).map((p) => A(p.id, 'q1', true, 1000)), // 5 人中 3 人答對 → 60%
    ];
    const r = rankTeams([10, 20], [...six, ...five], ans, new Set(['q1']));
    expect(r[0].teamId).toBe(20);
    expect(r[0].accuracy).toBeCloseTo(0.6);
    expect(r[1].accuracy).toBeCloseTo(0.5);
    expect(r[0].scoredQuestions).toBe(1);
    expect(r[0].members * r[0].scoredQuestions).toBe(5);
  });
  it('缺答計 0；中途加入者不列入隊伍計算', () => {
    const ps = [P(1, 10), P(2, 10), P(3, 10, { lateJoin: true })];
    const r = rankTeams([10], ps, [A(1, 'q1', true, 1), A(3, 'q1', true, 1)], new Set(['q1', 'q2']));
    expect(r[0].members).toBe(2);
    expect(r[0].accuracy).toBeCloseTo(1 / 4);
    expect(r[0].correct).toBe(1);
    expect(r[0].scoredQuestions).toBe(2);
  });
  it('不同隊員人數但相同答對率時公平比較，不使用個人速度積分決定團隊答對率', () => {
    const ps = [P(1, 10), P(2, 10), P(3, 20)];
    const ans = [{ ...A(1, 'q1', true, 1000), points: 1500 }, { ...A(2, 'q1', true, 1000), points: 1500 }, { ...A(3, 'q1', true, 1000), points: 1000 }];
    const rows = rankTeams([10, 20], ps, ans, new Set(['q1', 'q2']));
    expect(rows.map(r => r.accuracy)).toEqual([0.5, 0.5]);
    expect(rows.map(r => r.rank)).toEqual([1, 1]);
    expect(rows.map(r => r.scoredQuestions)).toEqual([2, 2]);
  });
  it('同答對率比平均反應時間，完全相同則並列', () => {
    const ps = [P(1, 10), P(2, 20), P(3, 30)];
    const r = rankTeams([10, 20, 30], ps, [A(1, 'q1', true, 3000), A(2, 'q1', true, 1000), A(3, 'q1', true, 1000)], new Set(['q1']));
    expect(r[0].rank).toBe(1);
    expect(r[1].rank).toBe(1);
    expect(r[2].teamId).toBe(10);
    expect(r[2].rank).toBe(3);
  });
});

describe('分組', () => {
  it('每隊人數差最多 1 人', () => {
    for (const n of [5, 30, 32, 61, 100]) {
      const k = autoTeamCount(n);
      const t = balancedTeams(Array.from({ length: n }, (_, i) => i), k);
      const sizes = t.map((x) => x.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    }
    expect(autoTeamCount(32)).toBe(6); // SPEC 範例：32 人分 6 組（5–6 人）
    expect(autoTeamCount(36)).toBe(6);
  });
});

describe('預計時間', () => {
  it('預設 80 題每題 30 秒＝40 分鐘，50 分鐘課剩 10 分鐘（不含進場與頒獎）', () => {
    const e = estimateCourse(DEFAULT_SETTINGS.courses[0], DEFAULT_SETTINGS.timing);
    expect(e.questionSec).toBe(2400);
    expect(e.leaderboardSec).toBe(0);
    expect(e.totalSec).toBe(2400);
    expect(e.remainingSec).toBe(600);
    expect(e.rounds.map((r) => [r.startSec, r.endSec])).toEqual([[0, 900], [900, 1800], [1800, 2400]]);
  });
  it('單題秒數優先、排行榜額外秒數與說明預留計入，超時會算出超出秒數', () => {
    const t = { ...DEFAULT_SETTINGS.timing, leaderboardExtraSeconds: 15 };
    const c = { ...DEFAULT_SETTINGS.courses[0], explainReserveMinutes: 5 };
    const per = Array(80).fill(null); per[0] = 60;
    const e = estimateCourse(c, t, per);
    expect(e.leaderboardCount).toBe(8);
    expect(e.questionSec).toBe(2400 + 40);
    expect(e.totalSec).toBe(2440 + 120 + 300);
    expect(e.overBy).toBe(2860 - 3000 > 0 ? 2860 - 3000 : 0);
  });
  it('平均分配回合', () => {
    expect(splitRounds(80, 3)).toEqual([27, 27, 26]);
    expect(splitRounds(72, 3).reduce((a, b) => a + b)).toBe(72);
  });
});

describe('驗證', () => {
  const base = { question_id: 'X-1', stem: '題', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: 'a' };
  it('答案大小寫正規化、秒數範圍、https 連結', () => {
    expect(validateQuestionRow(base, 2).value?.correct_option).toBe('A');
    expect(validateQuestionRow({ ...base, time_limit_seconds: '200' }, 2).errors[0].field).toBe('time_limit_seconds');
    expect(validateQuestionRow({ ...base, law_url: 'http://x' }, 2).errors[0].field).toBe('law_url');
    expect(validateQuestionRow({ ...base, correct_option: 'E' }, 2).errors[0].field).toBe('correct_option');
    expect(validateQuestionRow({ ...base, course_no: '5' }, 2).errors[0].field).toBe('course_no');
    expect(validateQuestionRow({ ...base, explanation_images: '../etc/passwd.png' }, 2).errors[0].field).toBe('explanation_images');
  });
  it('匯出 CSV 公式注入防護', () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvSafe('+886')).toBe("'+886");
    expect(csvSafe('一般')).toBe('一般');
  });
  it('暱稱規則', () => {
    expect(validateNickname('a')).toBeTruthy();
    expect(validateNickname('飛行小王子')).toBeNull();
    expect(validateNickname('0912345678')).toBeNull();
    expect(validateNickname('A123456789')).toBeNull();
  });
});
