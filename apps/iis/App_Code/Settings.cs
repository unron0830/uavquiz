using System;
using System.Collections.Generic;
using System.Linq;

namespace Uqa
{
    /// <summary>App_Data/config.json：老師密碼、Cookie 金鑰、秒數與題數</summary>
    public static class Settings
    {
        public static List<CourseSettings> DefaultCourses()
        {
            return new List<CourseSettings> {
                new CourseSettings { courseNo = 1, title = "隨機搶答", rounds = new List<int> { 20 } } };
        }


        public static ConfigFile Load(string file, out bool created)
        {
            var raw = Json.ReadFile<ConfigFile>(file, null);
            created = raw == null;
            var c = raw ?? new ConfigFile();
            bool dirty = created;
            // 密碼由部署者自行設定，未設定時禁止登入。
            if (string.IsNullOrEmpty(c.sessionSecret) || c.sessionSecret.Length < 32) { c.sessionSecret = U.RandomToken(32); dirty = true; }
            if (c.timing == null) c.timing = new Timing();
            var defs = DefaultCourses();
            var merged = new List<CourseSettings>();
            foreach (var d in defs)
            {
                var x = c.courses == null ? null : c.courses.FirstOrDefault(k => k != null && k.courseNo == d.courseNo);
                if (x == null) { merged.Add(d); continue; }
                if (string.IsNullOrEmpty(x.title)) x.title = d.title;
                if (x.rounds == null || x.rounds.Count == 0) x.rounds = d.rounds;
                merged.Add(x);
            }
            c.courses = merged;
            if (dirty) Json.WriteFile(file, c);
            return c;
        }

        static int Int(object v, int min, int max, string name)
        {
            if (v == null || !Obj.IsInteger(v)) throw new GameError(name + " 須為 " + min + "–" + max + " 的整數");
            var n = Convert.ToInt64(v);
            if (n < min || n > max) throw new GameError(name + " 須為 " + min + "–" + max + " 的整數");
            return (int)n;
        }

        /// <summary>驗證開場頁送來的設定</summary>
        public static AppSettings Validate(Dictionary<string, object> input, ConfigFile cur)
        {
            var t = Obj.D(Obj.Get(input, "timing"));
            Func<string, int, object> g = (k, d) => Obj.Has(t, k) ? Obj.Get(t, k) : (object)d;
            int min = Int(g("minQuestionSeconds", cur.timing.minQuestionSeconds), 1, 60, "最短作答秒數");
            int max = Int(g("maxQuestionSeconds", cur.timing.maxQuestionSeconds), min, 600, "最長作答秒數");
            var timing = new Timing {
                answerSeconds = Int(g("answerSeconds", cur.timing.answerSeconds), min, max, "作答秒數"),
                revealSeconds = Int(g("revealSeconds", cur.timing.revealSeconds), 0, 120, "揭曉秒數"),
                transitionSeconds = Int(g("transitionSeconds", cur.timing.transitionSeconds), 0, 60, "轉場秒數"),
                leaderboardExtraSeconds = Int(g("leaderboardExtraSeconds", cur.timing.leaderboardExtraSeconds), 0, 120, "排行榜額外停留秒數"),
                leaderboardEvery = Int(g("leaderboardEvery", cur.timing.leaderboardEvery), 0, 100, "每幾題顯示排行榜"),
                classMinutes = Int(g("classMinutes", cur.timing.classMinutes), 5, 300, "課堂長度"),
                minQuestionSeconds = min, maxQuestionSeconds = max };
            var incoming = (Obj.Get(input, "courses") as System.Collections.IEnumerable);
            var list = new List<Dictionary<string, object>>();
            if (incoming != null) foreach (var x in incoming) list.Add(Obj.D(x));
            var courses = new List<CourseSettings>();
            foreach (var c in cur.courses)
            {
                var i = list.FirstOrDefault(x => Obj.Num(x, "courseNo") == c.courseNo);
                var rounds = new List<int>();
                var rr = i == null ? null : Obj.Get(i, "rounds") as System.Collections.IEnumerable;
                if (rr == null) rounds = c.rounds.ToList();
                else { int k = 0; foreach (var r in rr) rounds.Add(Int(r, 1, 300, "第 " + c.courseNo + " 堂第 " + (++k) + " 回合題數")); }
                if (rounds.Count < 1 || rounds.Count > 9) throw new GameError("回合數須為 1–9");
                var title = i == null ? c.title : Obj.Str(i, "title");
                if (title.Length > 60) title = title.Substring(0, 60);
                courses.Add(new CourseSettings {
                    courseNo = c.courseNo, title = string.IsNullOrEmpty(title) ? c.title : title, rounds = rounds,
                    explainReserveMinutes = Int(i == null || !Obj.Has(i, "explainReserveMinutes") ? (object)c.explainReserveMinutes : Obj.Get(i, "explainReserveMinutes"), 0, 120, "說明預留分鐘") });
            }
            return new AppSettings { timing = timing, courses = courses };
        }
    }
}
