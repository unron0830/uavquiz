export type OptionKey = 'A' | 'B' | 'C' | 'D';
export const OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

/** 場次狀態（SPEC §9） */
export type Phase =
  | 'LOBBY'
  | 'QUESTION_OPEN'
  | 'REVEAL'
  | 'TRANSITION'
  | 'LEADERBOARD'
  | 'ROUND_END'
  | 'FINISHED'
  | 'AWARDS'
  | 'ABORTED';

export interface TimingSettings {
  /** 預設作答秒數 */
  answerSeconds: number;
  revealSeconds: number;
  transitionSeconds: number;
  /** 排行榜額外停留秒數（0＝在轉場內顯示） */
  leaderboardExtraSeconds: number;
  /** 每幾題顯示一次排行榜 */
  leaderboardEvery: number;
  classMinutes: number;
  minQuestionSeconds: number;
  maxQuestionSeconds: number;
}

export interface CourseSettings {
  courseNo: number;
  title: string;
  /** 各回合題數；加總即總題數 */
  rounds: number[];
  explainReserveMinutes: number;
}

export interface AppSettings {
  timing: TimingSettings;
  courses: CourseSettings[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  timing: {
    answerSeconds: 20,
    revealSeconds: 5,
    transitionSeconds: 5,
    leaderboardExtraSeconds: 0,
    leaderboardEvery: 10,
    classMinutes: 50,
    minQuestionSeconds: 5,
    maxQuestionSeconds: 120,
  },
  courses: [
    { courseNo: 1, title: '無人機法規與飛航管理', rounds: [30, 30, 20], explainReserveMinutes: 0 },
    { courseNo: 2, title: '基礎飛行原理與機體知識', rounds: [30, 30, 20], explainReserveMinutes: 0 },
    { courseNo: 3, title: '航空氣象與飛行環境', rounds: [30, 30, 20], explainReserveMinutes: 0 },
    { courseNo: 4, title: '緊急處置與飛行決策', rounds: [30, 30, 20], explainReserveMinutes: 0 },
  ],
};

export interface PublicQuestion {
  warmup?: boolean;
  /** 場次內題次序號（1 起） */
  index: number;
  total: number;
  roundNo: number;
  roundIndex: number;
  roundTotal: number;
  questionId: string;
  stem: string;
  options: Record<OptionKey, string>;
  topic: string;
}

export interface Explanation {
  verified?: boolean;
  text: string;
  lawReference: string;
  lawExcerpt: string;
  lawUrl: string;
  referenceUrls: string[];
  images: string[];
}

export interface RevealInfo {
  correct: OptionKey;
  distribution: Record<OptionKey, number>;
  answeredCount: number;
  voided: boolean;
  explanation: Explanation;
}

export interface TeamInfo {
  id: number;
  name: string;
  color: string;
  icon: string;
}

export interface LeaderRow {
  points?: number;
  participantId: number;
  nickname: string;
  avatar: string;
  teamId: number | null;
  correct: number;
  timeMs: number;
  rank: number;
  lateJoin: boolean;
}

export interface TeamRow {
  correct: number;
  scoredQuestions: number;
  teamId: number;
  name: string;
  color: string;
  icon: string;
  members: number;
  accuracy: number;
  avgTimeMs: number;
  rank: number;
}

export interface GameState {
  maxTeamSize?: number | null;
  manualAdvance?: boolean;
  explanationSeconds?: number;
  explanationEndsAt?: number | null;
  warmupCount?: number;
  showDetails?: boolean;
  sessionId: string;
  code: string;
  courseNo: number;
  courseTitle: string;
  phase: Phase;
  paused: boolean;
  explaining: boolean;
  /** 狀態版本，每次變更 +1 */
  version: number;
  sequence: number;
  serverTime: number;
  /** 目前階段結束時間（伺服器毫秒）；null＝無倒數 */
  endsAt: number | null;
  /** 暫停時剩餘毫秒 */
  remainingMs: number | null;
  questionBoard?: LeaderRow[] | null;
  question: PublicQuestion | null;
  reveal: RevealInfo | null;
  answeredCount: number;
  participantCount: number;
  maxParticipants?: number;
  teams: TeamInfo[];
  leaderboard: LeaderRow[] | null;
  teamBoard: TeamRow[] | null;
  showLeaderboard: boolean;
  rosterLocked: boolean;
  allowLateJoin: boolean;
  hideNames: boolean;
  soundEnabled: boolean;
  showExplanationText: boolean;
  /** 講解時臨時投影的素材 */
  adhoc: { kind: 'image' | 'url'; value: string } | null;
  autoPauseAfterReveal: boolean;
  /** 等候室名單（僅 LOBBY） */
  roster: { id: number; nickname: string; avatar: string; teamId: number | null }[] | null;
  /** 團體冠軍成員（僅 FINISHED/AWARDS） */
  championMembers: { nickname: string; avatar: string }[] | null;
}

export interface ParticipantView {
  participantId: number;
  nickname: string;
  avatar: string;
  team: TeamInfo | null;
  lateJoin: boolean;
}

export interface MyStatus {
  points?: number;
  questionPoints?: number;
  questionRank?: number | null;
  myAnswer: OptionKey | null;
  teamId: number | null;
  correct: number;
  rank: number | null;
  teamRank: number | null;
}

/** Socket 事件名稱（SPEC §7.2） */
export const EV = {
  join: 'session:join',
  joined: 'session:joined',
  teamAssigned: 'team:assigned',
  state: 'game:state',
  answerSubmit: 'answer:submit',
  answerAck: 'answer:ack',
  me: 'player:status',
  recovered: 'connection:recovered',
  kicked: 'player:kicked',
  hostCommand: 'host:command',
  hostMonitor: 'host:monitor',
  error: 'error:message',
} as const;

export type HostCommand =
  | { type: 'setTeamSize'; maxTeamSize: number }
  | { type: 'showDetails'; visible: boolean }
  | { type: 'assignTeams'; teamCount?: number }
  | { type: 'moveParticipant'; participantId: number; teamId: number }
  | { type: 'removeParticipant'; participantId: number }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'revealNow' }
  | { type: 'explain' }
  | { type: 'extend'; seconds: 5 | 10 }
  | { type: 'reopen' }
  | { type: 'void'; questionId: string; voided: boolean }
  | { type: 'showLeaderboard' }
  | { type: 'finish' }
  | { type: 'awards' }
  | { type: 'abort' }
  | { type: 'setOptions'; allowLateJoin?: boolean; hideNames?: boolean; soundEnabled?: boolean; showExplanationText?: boolean; autoPauseAfterReveal?: boolean }
  | { type: 'adhoc'; kind: 'image' | 'url' | 'clear'; value?: string }
  | { type: 'setQuestionSeconds'; questionId: string; seconds: number | null };
