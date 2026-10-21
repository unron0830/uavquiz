import type { AppSettings, CourseSettings, TimingSettings } from './types.ts';

export interface RoundEstimate {
  roundNo: number;
  questions: number;
  startSec: number;
  endSec: number;
}
export interface CourseEstimate {
  courseNo: number;
  title: string;
  totalQuestions: number;
  rounds: RoundEstimate[];
  questionSec: number;
  leaderboardSec: number;
  explainSec: number;
  totalSec: number;
  classSec: number;
  remainingSec: number;
  overBy: number;
  leaderboardCount: number;
}

/**
 * 預計時間（SPEC §5.1 C）。進場與頒獎不計入。
 * perQuestionSeconds：依出題順序的單題作答秒數（null＝沿用預設）。長度不足時以預設補齊。
 */
export function estimateCourse(
  course: CourseSettings,
  timing: TimingSettings,
  perQuestionSeconds: (number | null)[] = [],
): CourseEstimate {
  const total = course.rounds.reduce((a, b) => a + b, 0);
  let t = 0;
  let q = 0;
  let lbCount = 0;
  const rounds: RoundEstimate[] = [];
  course.rounds.forEach((n, ri) => {
    const start = t;
    for (let i = 0; i < n; i++) {
      const ans = perQuestionSeconds[q] ?? timing.answerSeconds;
      t += ans + timing.revealSeconds + timing.transitionSeconds;
      q += 1;
      const isRoundEnd = i === n - 1;
      if ((timing.leaderboardEvery > 0 && q % timing.leaderboardEvery === 0) || isRoundEnd) {
        lbCount += 1;
        t += timing.leaderboardExtraSeconds;
      }
    }
    rounds.push({ roundNo: ri + 1, questions: n, startSec: start, endSec: t });
  });
  const leaderboardSec = lbCount * timing.leaderboardExtraSeconds;
  const questionSec = t - leaderboardSec;
  const explainSec = Math.round(course.explainReserveMinutes * 60);
  const totalSec = t + explainSec;
  const classSec = Math.round(timing.classMinutes * 60);
  return {
    courseNo: course.courseNo,
    title: course.title,
    totalQuestions: total,
    rounds,
    questionSec,
    leaderboardSec,
    explainSec,
    totalSec,
    classSec,
    remainingSec: classSec - totalSec,
    overBy: Math.max(0, totalSec - classSec),
    leaderboardCount: lbCount,
  };
}

export function estimateAll(settings: AppSettings, perCourse: Record<number, (number | null)[]> = {}): CourseEstimate[] {
  return settings.courses.map((c) => estimateCourse(c, settings.timing, perCourse[c.courseNo] ?? []));
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(Math.abs(sec)));
  const m = Math.floor(s / 60);
  return `${sec < 0 ? '-' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 平均分配回合題數 */
export function splitRounds(total: number, roundCount: number): number[] {
  const base = Math.floor(total / roundCount);
  const extra = total % roundCount;
  return Array.from({ length: roundCount }, (_, i) => base + (i < extra ? 1 : 0));
}
