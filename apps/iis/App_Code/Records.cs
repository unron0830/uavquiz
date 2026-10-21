using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Uqa
{
    /// <summary>紀錄查詢：App_Data/records/*.json</summary>
    public static class Records
    {
        static string PathOf(string id) { return Regex.IsMatch(id ?? "", "^[\\w-]+$") ? Path.Combine(Store.RecordsDir, id + ".json") : null; }

        public static SessionRecord Read(string id)
        {
            var live = Store.Get(id);
            if (live != null) lock (live.Lock) { live.Flush(); }
            var f = PathOf(id);
            if (f == null || !File.Exists(f)) return null;
            var r = Json.ReadFile<SessionRecord>(f, null);
            return r != null && r.format == "uqa-session-v1" ? r : null;
        }

        static IEnumerable<string> Ids()
        {
            return Directory.GetFiles(Store.RecordsDir, "*.json").Select(Path.GetFileNameWithoutExtension).OrderByDescending(x => x, StringComparer.Ordinal);
        }

        static HashSet<string> Scored(SessionRecord r)
        {
            var v = new HashSet<string>(r.state.voided ?? new List<string>());
            return new HashSet<string>((r.state.closed ?? new List<string>()).Where(q => !v.Contains(q) && !q.StartsWith("WARMUP-") && !r.plan.Any(item => item.questionId == q && item.warmup)));
        }

        public static List<object> List()
        {
            var outp = new List<object>();
            foreach (var id in Ids())
            {
                try
                {
                    var r = Read(id);
                    if (r == null) continue;
                    outp.Add(new Dictionary<string, object> { { "id", r.id }, { "code", r.code }, { "courseNo", r.courseNo }, { "courseTitle", r.courseTitle }, { "status", r.status }, { "demo", r.demo },
                        { "groupNames", r.groupNames }, { "createdAt", r.createdAt }, { "startedAt", r.startedAt }, { "endedAt", r.endedAt },
                        { "participants", r.participants.Count(p => !p.removed) }, { "questions", r.plan.Count }, { "scored", Scored(r).Count }, { "answers", r.answers.Count } });
                }
                catch { }
            }
            return outp;
        }

        public static bool Delete(string id)
        {
            var f = PathOf(id);
            if (f == null || !File.Exists(f)) return false;
            File.Delete(f);
            return true;
        }

        public static Dictionary<string, object> Report(SessionRecord r)
        {
            var scored = Scored(r);
            var attempts = r.state.attempts ?? new Dictionary<string, int>();
            Func<string, int> att = q => { int a; return attempts.TryGetValue(q, out a) ? a : 0; };
            var answers = r.answers.Where(a => att(a.questionId) == a.attempt).ToList();
            var parts = r.participants.Where(p => !p.removed).ToList();
            var ind = Scoring.RankIndividuals(parts, answers, scored);
            var teamRows = Scoring.RankTeams(r.teams.Select(t => t.id), parts, answers, scored);
            Func<int?, TeamInfo> team = id => r.teams.FirstOrDefault(t => id.HasValue && t.id == id.Value);
            var voided = new HashSet<string>(r.state.voided ?? new List<string>());
            var closed = new HashSet<string>(r.state.closed ?? new List<string>());
            var people = ind.Select(row =>
            {
                var p = parts.First(x => x.id == row.participantId);
                var mine = answers.Where(a => a.participantId == p.id).ToList();
                var t = team(p.teamId);
                return (object)new Dictionary<string, object> {
                    { "participantId", p.id }, { "rank", row.rank }, { "nickname", p.nickname }, { "avatar", p.avatar }, { "team", t == null ? "" : t.name }, { "teamColor", t == null ? "" : t.color },
                    { "lateJoin", p.lateJoin }, { "joinedAt", p.joinedAt }, { "correct", row.correct }, { "points", row.points }, { "answered", mine.Count(a => scored.Contains(a.questionId)) },
                    { "accuracy", scored.Count > 0 ? (double)row.correct / scored.Count : 0 }, { "timeMs", row.timeMs },
                    { "answers", r.plan.Select((q, i) => new { q, i }).Where(x => closed.Contains(x.q.questionId)).Select(x =>
                        {
                            var a = mine.FirstOrDefault(y => y.questionId == x.q.questionId);
                            return (object)new Dictionary<string, object> { { "index", x.i + 1 }, { "questionId", x.q.questionId }, { "chosen", a == null ? null : a.option }, { "correctOption", x.q.correct },
                                { "points", a == null || !scored.Contains(x.q.questionId) ? 0 : (a.points ?? 1000) }, { "correct", a != null && a.correct }, { "elapsedMs", a == null ? (long?)null : a.elapsedMs }, { "acceptedAt", a == null ? (long?)null : a.acceptedAt }, { "voided", voided.Contains(x.q.questionId) || (x.q.warmup || x.q.questionId.StartsWith("WARMUP-")) }, { "closed", true } };
                        }).ToList() } };
            }).ToList();
            var questions = r.plan.Select((q, i) => new { q, i }).Where(x => closed.Contains(x.q.questionId)).Select(x =>
            {
                var a = answers.Where(y => y.questionId == x.q.questionId).ToList();
                var dist = new Dictionary<string, int> { { "A", 0 }, { "B", 0 }, { "C", 0 }, { "D", 0 } };
                foreach (var y in a) if (dist.ContainsKey(y.option)) dist[y.option]++;
                int ok = a.Count(y => y.correct);
                return (object)new Dictionary<string, object> { { "index", x.i + 1 }, { "questionId", x.q.questionId }, { "roundNo", x.q.roundNo }, { "stem", x.q.stem }, { "options", x.q.options }, { "correct", x.q.correct },
                    { "answered", a.Count }, { "correctCount", ok }, { "accuracy", a.Count > 0 ? (double)ok / a.Count : 0 }, { "distribution", dist },
                    { "avgMs", a.Count > 0 ? (long?)Math.Round(a.Average(y => (double)y.elapsedMs)) : null }, { "voided", voided.Contains(x.q.questionId) || (x.q.warmup || x.q.questionId.StartsWith("WARMUP-")) }, { "closed", true } };
            }).ToList();
            return new Dictionary<string, object> {
                { "id", r.id }, { "code", r.code }, { "courseNo", r.courseNo }, { "courseTitle", r.courseTitle }, { "status", r.status }, { "demo", r.demo }, { "groupNames", r.groupNames },
                { "createdAt", r.createdAt }, { "startedAt", r.startedAt }, { "endedAt", r.endedAt }, { "scored", scored.Count }, { "participants", people },
                { "teams", teamRows.Select(t => { var ti = team(t.teamId); return (object)new Dictionary<string, object> { { "teamId", t.teamId }, { "members", t.members }, { "correct", t.correct }, { "scoredQuestions", t.scoredQuestions }, { "accuracy", t.accuracy }, { "avgTimeMs", t.avgTimeMs }, { "rank", t.rank }, { "name", ti == null ? "" : ti.name }, { "color", ti == null ? "" : ti.color } }; }).ToList() },
                { "questions", questions }, { "events", r.events } };
        }

        public static List<object> SearchNickname(string q)
        {
            var needle = (q ?? "").Trim().ToLowerInvariant();
            var outp = new List<object>();
            if (needle.Length == 0) return outp;
            foreach (var id in Ids())
            {
                var r = Read(id); if (r == null) continue;
                var rep = Report(r);
                foreach (Dictionary<string, object> p in (List<object>)rep["participants"])
                {
                    if (!((string)p["nickname"]).ToLowerInvariant().Contains(needle)) continue;
                    var row = new Dictionary<string, object>(p);
                    row.Remove("answers");
                    row["sessionId"] = r.id; row["code"] = r.code; row["courseNo"] = r.courseNo; row["courseTitle"] = r.courseTitle; row["createdAt"] = r.createdAt;
                    outp.Add(row);
                }
            }
            return outp;
        }

        static string Pct(double x) { return (x * 100).ToString("0.0", CultureInfo.InvariantCulture) + "%"; }
        static string Time(object t)
        {
            if (t == null) return "";
            var ms = Convert.ToInt64(t);
            return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms).ToLocalTime().ToString("yyyy/MM/dd HH:mm:ss");
        }

        /// <summary>CSV：answers＝每人每題一列；summary＝排名摘要</summary>
        public static string Csv(Dictionary<string, object> rep, string kind)
        {
            var L = new List<string>();
            Action<object[]> row = v => L.Add(string.Join(",", v.Select(U.CsvSafe)));
            var parts = ((List<object>)rep["participants"]).Cast<Dictionary<string, object>>().ToList();
            var qs = ((List<object>)rep["questions"]).Cast<Dictionary<string, object>>().ToList();
            if (kind == "answers")
            {
                row(new object[] { "場次", "主題", "參賽名稱", "隊伍", "題次", "題目ID", "題幹", "作答", "正解", "是否答對", "作答秒數", "作答時間", "本題得分", "本題不計分" });
                var stem = qs.ToDictionary(q => (string)q["questionId"], q => (string)q["stem"]);
                foreach (var p in parts)
                    foreach (Dictionary<string, object> a in (List<object>)p["answers"])
                    {
                        var chosen = a["chosen"] as string;
                        var el = a["elapsedMs"];
                        row(new object[] { rep["code"], rep["courseTitle"], p["nickname"], p["team"], a["index"], a["questionId"], stem.ContainsKey((string)a["questionId"]) ? stem[(string)a["questionId"]] : "",
                            chosen ?? "未作答", a["correctOption"], chosen == null ? "" : ((bool)a["correct"] ? "對" : "錯"),
                            el == null ? "" : (Convert.ToInt64(el) / 1000.0).ToString("0.00", CultureInfo.InvariantCulture), Time(a["acceptedAt"]), a["points"], (bool)a["voided"] ? "是" : "" });
                    }
            }
            else
            {
                row(new object[] { "場次碼", rep["code"], "主題", rep["courseTitle"], "題組", string.Join("；", (List<string>)rep["groupNames"]), "開始", Time(rep["startedAt"]), "計分題數", rep["scored"] });
                L.Add("");
                row(new object[] { "個人排名", "參賽名稱", "隊伍", "累積積分", "答對題數", "作答題數", "正確率", "答對耗時(秒)", "中途加入" });
                foreach (var p in parts) row(new object[] { p["rank"], p["nickname"], p["team"], p["points"], p["correct"], p["answered"], Pct((double)p["accuracy"]), (Convert.ToInt64(p["timeMs"]) / 1000.0).ToString("0.0", CultureInfo.InvariantCulture), (bool)p["lateJoin"] ? "是" : "" });
                L.Add("");
                row(new object[] { "團體排名", "隊伍", "隊員人數", "正式計分題數", "全隊答對次數", "應答次數", "團隊答對率", "答對題平均反應(秒)" });
                foreach (Dictionary<string, object> t in (List<object>)rep["teams"]) row(new object[] { t["rank"], t["name"], t["members"], t["scoredQuestions"], t["correct"], (int)t["members"] * (int)t["scoredQuestions"], Pct((double)t["accuracy"]), ((double)t["avgTimeMs"] / 1000).ToString("0.00", CultureInfo.InvariantCulture) });
                L.Add("");
                row(new object[] { "題次", "題目ID", "題幹", "正解", "A", "B", "C", "D", "作答人數", "答對率", "不計分" });
                foreach (var q in qs)
                {
                    var d = (Dictionary<string, int>)q["distribution"];
                    row(new object[] { q["index"], q["questionId"], q["stem"], q["correct"], d["A"], d["B"], d["C"], d["D"], q["answered"], Pct((double)q["accuracy"]), (bool)q["voided"] ? "是" : "" });
                }
            }
            return "﻿" + string.Join("\n", L);
        }
    }
}
