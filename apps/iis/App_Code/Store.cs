using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web;
using System.Text.RegularExpressions;

namespace Uqa
{
    /// <summary>全站狀態：題庫、設定、進行中的場次。資料放在 App_Data（ASP.NET 自動禁止外部下載）。</summary>
    public static class Store
    {
        public static readonly object Gate = new object();
        public static string Root, DataDir, RecordsDir, ImagesDir, QuestionsFile, GroupsFile, ConfigFilePath;
        public static Bank Bank;
        public static ConfigFile Config;
        public static Dictionary<string, GameSession> Sessions = new Dictionary<string, GameSession>();
        public static bool ConfigCreated;
        public const int MaxParticipants = 100;
        static bool inited;

        public static void EnsureInit(HttpContext ctx)
        {
            if (inited) return;
            lock (Gate)
            {
                if (inited) return;
                // 以 api.ashx 所在資料夾為網站根目錄：不論放在 IIS 站台根目錄或任一子資料夾都能用
                Root = Path.GetDirectoryName(ctx.Server.MapPath(ctx.Request.FilePath));
                DataDir = Path.Combine(Root, "App_Data");
                RecordsDir = Path.Combine(DataDir, "records");
                ImagesDir = Path.Combine(Root, "images");
                QuestionsFile = Path.Combine(DataDir, "questions.json");
                GroupsFile = Path.Combine(DataDir, "groups.json");
                ConfigFilePath = Path.Combine(DataDir, "config.json");
                Directory.CreateDirectory(RecordsDir);
                Directory.CreateDirectory(ImagesDir);
                Config = Settings.Load(ConfigFilePath, out ConfigCreated);
                FirstRun.EnsureToken();
                Bank = new Bank(QuestionsFile, GroupsFile);
                try { Bank.Load(); } catch (Exception e) { Bank.Errors = new List<string> { e.Message }; }
                RestoreAll();
                inited = true;
            }
        }

        public static AppSettings CurrentSettings() { return new AppSettings { timing = Config.timing, courses = Config.courses }; }
        public static void SaveSettings(AppSettings s) { Config.timing = s.timing; Config.courses = s.courses; Json.WriteFile(ConfigFilePath, Config); }

        static void RestoreAll()
        {
            foreach (var f in Directory.GetFiles(RecordsDir, "*.json"))
            {
                try
                {
                    var rec = Json.ReadFile<SessionRecord>(f, null);
                    if (rec == null || rec.format != "uqa-session-v1" || (rec.status != "LOBBY" && rec.status != "RUNNING")) continue;
                    var s = new GameSession(rec, f, ImagesDir);
                    s.Restore();
                    Sessions[rec.id] = s;
                }
                catch { /* 略過損毀檔 */ }
            }
        }

        public static GameSession Get(string id, bool restoreCompleted = false)
        {
            lock (Gate)
            {
                GameSession s;
                if (id != null && Sessions.TryGetValue(id, out s)) return s;
                if (!restoreCompleted || !Regex.IsMatch(id ?? "", "^[\\w-]+$")) return null;
                var file = Path.Combine(RecordsDir, id + ".json");
                var record = Json.ReadFile<SessionRecord>(file, null);
                if (record == null || record.format != "uqa-session-v1" || (record.status != "FINISHED" && record.status != "AWARDS")) return null;
                s = new GameSession(record, file, ImagesDir); Sessions[id] = s; return s;
            }
        }
        public static GameSession ByCode(string code)
        {
            lock (Gate)
            {
                var all = Sessions.Values.Where(s => s.R.code == code).ToList();
                return all.FirstOrDefault(s => s.Phase != "ABORTED" && s.Phase != "AWARDS" && s.Phase != "FINISHED") ?? all.FirstOrDefault(s => s.Phase != "ABORTED");
            }
        }

        /// <summary>開新場次：從題組抽題（隨機或依題號）；示範模式依可用題數縮減回合</summary>
        public static GameSession Create(int courseNo, List<string> groupIds, bool shuffle, bool demo, int? questionCount = null, int? answerSeconds = null, int explanationSeconds = 10)
        {
            var course = Config.courses.FirstOrDefault(c => c.courseNo == courseNo);
            if (course == null) throw new GameError("課程不存在");
            if (groupIds == null || groupIds.Count == 0) throw new GameError("請至少選一個題組");
            var ids = Bank.GroupQuestionIds(groupIds, true);
            if (shuffle) ids = U.Shuffle(ids);
            var rounds = questionCount.HasValue ? new List<int> { questionCount.Value } : course.rounds.ToList();
            int need = rounds.Sum() + (questionCount.HasValue ? 2 : 0);
            if (ids.Count == 0) throw new GameError("所選題組沒有可用題目");
            bool shrunk = false;
            if (ids.Count < need)
            {
                if (!demo) throw new GameError("所選題組只有 " + ids.Count + " 題，本堂需要 " + need + " 題；請多選題組、減少題數，或用示範模式");
                int left = ids.Count; var r2 = new List<int>();
                foreach (var n in rounds) { int k = Math.Min(n, left); left -= k; if (k > 0) r2.Add(k); }
                rounds = r2; shrunk = true;
            }
            int total = rounds.Sum();
            var plan = ids.Take(questionCount.HasValue ? total + 2 : total).Select(id =>
            {
                var q = Bank.ById[id];
                return new PlanItem { questionId = q.question_id, seconds = answerSeconds.HasValue ? answerSeconds : q.time_limit_seconds, stem = q.stem, options = new Dictionary<string, string> { { "A", q.option_a }, { "B", q.option_b }, { "C", q.option_c }, { "D", q.option_d } }, correct = q.correct_option, topic = q.topic, explanation = Bank.ToExplanation(q) };
            }).ToList();
            if (questionCount.HasValue)
            {
                for (int warmupIndex = 0; warmupIndex < 2; warmupIndex++) plan[warmupIndex].warmup = true;
                rounds = new List<int> { plan.Count };
                course = new CourseSettings { courseNo = 1, title = groupIds.Count == 1 ? Bank.GroupNames(groupIds)[0] : "混合題庫隨機挑戰" };
            }
            int idx = 0;
            for (int r = 0; r < rounds.Count; r++) for (int i = 0; i < rounds[r]; i++) plan[idx++].roundNo = r + 1;
            var t = Config.timing;
            var cfg = new SessionConfig { answerSeconds = t.answerSeconds, revealSeconds = t.revealSeconds, transitionSeconds = t.transitionSeconds, leaderboardExtraSeconds = t.leaderboardExtraSeconds, leaderboardEvery = t.leaderboardEvery, minSeconds = t.minQuestionSeconds, maxSeconds = t.maxQuestionSeconds, rounds = rounds, classMinutes = t.classMinutes };
            if (questionCount.HasValue) {
                cfg.answerSeconds = answerSeconds.Value; cfg.revealSeconds = 0; cfg.transitionSeconds = 0;
                cfg.leaderboardEvery = 0; cfg.leaderboardExtraSeconds = 0;
                cfg.minSeconds = 15; cfg.maxSeconds = 120; cfg.manualAdvance = true; cfg.warmupCount = 2; cfg.explanationSeconds = explanationSeconds;
            }
            string code;
            lock (Gate)
            {
                var activeCodes = new HashSet<string>(Sessions.Values.Where(s => s.Phase != "FINISHED" && s.Phase != "AWARDS" && s.Phase != "ABORTED").Select(s => s.R.code));
                do { code = U.RandInt(100000, 1000000).ToString(); } while (activeCodes.Contains(code));
            }
            var id2 = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + code;
            var rec = new SessionRecord { id = id2, code = code, courseNo = courseNo, courseTitle = course.title, demo = demo && shrunk, groupIds = groupIds, groupNames = Bank.GroupNames(groupIds), createdAt = U.Now(), stageToken = U.RandomToken(24), config = cfg, plan = plan, status = "LOBBY" };
            if (questionCount.HasValue) { rec.state.flags.autoPauseAfterReveal = true; rec.state.flags.showExplanationText = true; }
            rec.events.Add(new SessionEvent { at = U.Now(), type = "session.created", detail = new Dictionary<string, object> { { "courseNo", courseNo }, { "code", code }, { "questions", plan.Count }, { "groupIds", groupIds } } });
            var sess = new GameSession(rec, Path.Combine(RecordsDir, id2 + ".json"), ImagesDir);
            lock (sess.Lock) sess.Flush();
            lock (Gate) Sessions[id2] = sess;
            return sess;
        }
    }
}
