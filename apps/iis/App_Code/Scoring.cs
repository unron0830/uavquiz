using System;
using System.Collections.Generic;
using System.Linq;

namespace Uqa
{
    public class IndRow { public int participantId; public int correct; public int points; public long timeMs; public int rank; }
    public class TeamRow { public int teamId; public int members; public int correct; public int scoredQuestions; public double accuracy; public double avgTimeMs; public int rank; }

    public static class Scoring
    {
        public static int AnswerPoints(bool correct, long elapsedMs, int seconds)
        {
            if (!correct) return 0;
            double ratio = Math.Min(1.0, Math.Max(0, elapsedMs) / (Math.Max(1, seconds) * 1000.0));
            return 1000 + (int)Math.Floor(500 * (1 - ratio));
        }
        /// <summary>個人：答對題數優先；同分比答對耗時總和；再相同依加入順序</summary>
        public static List<IndRow> RankIndividuals(IEnumerable<Participant> ps, IEnumerable<Answer> answers, HashSet<string> scored)
        {
            var map = new Dictionary<int, IndRow>();
            var order = new Dictionary<int, int>();
            foreach (var p in ps) { if (p.removed) continue; map[p.id] = new IndRow { participantId = p.id }; order[p.id] = p.joinOrder; }
            foreach (var a in answers)
            {
                if (!a.correct || !scored.Contains(a.questionId)) continue;
                IndRow r; if (!map.TryGetValue(a.participantId, out r)) continue;
                r.correct++; r.points += a.points ?? 1000; r.timeMs += a.elapsedMs;
            }
            var rows = map.Values.OrderByDescending(r => r.points).ThenByDescending(r => r.correct).ThenBy(r => r.timeMs).ThenBy(r => order[r.participantId]).ToList();
            for (int i = 0; i < rows.Count; i++) rows[i].rank = i + 1;
            return rows;
        }

        /// <summary>團隊：答對總次數÷（隊員人數×正式計分題數）；中途加入與移除者不列入；同率比答對題平均反應時間，再同則並列</summary>
        public static List<TeamRow> RankTeams(IEnumerable<int> teamIds, IEnumerable<Participant> ps, IEnumerable<Answer> answers, HashSet<string> scored)
        {
            var eligible = ps.Where(p => !p.removed && !p.lateJoin && p.teamId.HasValue).ToDictionary(p => p.id);
            var acc = new Dictionary<int, TeamRow>();
            var time = new Dictionary<int, long>();
            foreach (var t in teamIds) { acc[t] = new TeamRow { teamId = t }; time[t] = 0; }
            foreach (var p in eligible.Values) { TeamRow r; if (acc.TryGetValue(p.teamId.Value, out r)) r.members++; }
            foreach (var a in answers)
            {
                if (!a.correct || !scored.Contains(a.questionId)) continue;
                Participant p; if (!eligible.TryGetValue(a.participantId, out p)) continue;
                TeamRow r; if (!acc.TryGetValue(p.teamId.Value, out r)) continue;
                r.correct++; time[r.teamId] += a.elapsedMs;
            }
            int n = scored.Count;
            foreach (var r in acc.Values)
            {
                r.scoredQuestions = n;
                r.accuracy = r.members > 0 && n > 0 ? (double)r.correct / (r.members * n) : 0;
                r.avgTimeMs = r.correct > 0 ? (double)time[r.teamId] / r.correct : 0;
            }
            const double EPS = 1e-9;
            var rows = acc.Values.ToList();
            rows.Sort((x, y) =>
            {
                if (Math.Abs(y.accuracy - x.accuracy) > EPS) return y.accuracy.CompareTo(x.accuracy);
                if (x.correct == 0 && y.correct == 0) return x.teamId.CompareTo(y.teamId);
                int c = x.avgTimeMs.CompareTo(y.avgTimeMs);
                return c != 0 ? c : x.teamId.CompareTo(y.teamId);
            });
            for (int i = 0; i < rows.Count; i++)
            {
                var prev = i > 0 ? rows[i - 1] : null;
                if (prev != null && Math.Abs(prev.accuracy - rows[i].accuracy) <= EPS && Math.Round(prev.avgTimeMs) == Math.Round(rows[i].avgTimeMs)) rows[i].rank = prev.rank;
                else rows[i].rank = i + 1;
            }
            return rows;
        }

        public static int AutoTeamCount(int n) { if (n <= 1) return 1; return Math.Max(2, (int)Math.Ceiling(n / 6.0)); }

        public static List<int> SplitRounds(int total, int count)
        {
            var r = new List<int>();
            for (int i = 0; i < count; i++) r.Add(total / count + (i < total % count ? 1 : 0));
            return r;
        }

        /// <summary>預計時間（進場與頒獎不計入）</summary>
        public static Dictionary<string, object> Estimate(CourseSettings c, Timing t)
        {
            int total = c.rounds.Sum();
            long sec = 0; int q = 0, lb = 0;
            var rounds = new List<object>();
            for (int ri = 0; ri < c.rounds.Count; ri++)
            {
                long start = sec;
                for (int i = 0; i < c.rounds[ri]; i++)
                {
                    sec += t.answerSeconds + t.revealSeconds + t.transitionSeconds;
                    q++;
                    bool roundEnd = i == c.rounds[ri] - 1;
                    if ((t.leaderboardEvery > 0 && q % t.leaderboardEvery == 0) || roundEnd) { lb++; sec += t.leaderboardExtraSeconds; }
                }
                rounds.Add(new Dictionary<string, object> { { "roundNo", ri + 1 }, { "questions", c.rounds[ri] }, { "startSec", start }, { "endSec", sec } });
            }
            long lbSec = (long)lb * t.leaderboardExtraSeconds;
            long qSec = sec - lbSec;
            long ex = c.explainReserveMinutes * 60L;
            long totalSec = sec + ex;
            long cls = t.classMinutes * 60L;
            return new Dictionary<string, object> {
                { "courseNo", c.courseNo }, { "title", c.title }, { "totalQuestions", total }, { "rounds", rounds },
                { "questionSec", qSec }, { "leaderboardSec", lbSec }, { "explainSec", ex }, { "totalSec", totalSec },
                { "classSec", cls }, { "remainingSec", cls - totalSec }, { "overBy", Math.Max(0, totalSec - cls) }, { "leaderboardCount", lb } };
        }
    }
}
