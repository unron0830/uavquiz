using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Uqa
{
    /// <summary>題庫：App_Data/questions.json；自訂題組：App_Data/groups.json</summary>
    public class Bank
    {
        public List<Question> Questions = new List<Question>();
        public Dictionary<string, Question> ById = new Dictionary<string, Question>();
        public List<CustomGroup> Custom = new List<CustomGroup>();
        public List<string> Errors = new List<string>();
        public long LoadedAt;
        readonly string qFile, gFile;

        public Bank(string qFile, string gFile) { this.qFile = qFile; this.gFile = gFile; }

        public static string Validate(Question q, int min, int max)
        {
            if (string.IsNullOrWhiteSpace(q.question_id)) return "題目 ID 不可空白";
            if (q.question_id.Length > 64 || !Regex.IsMatch(q.question_id, "^[\\w\\-.]+$")) return "題目 ID 只能用英數字、-、_、.";
            if (q.course_no.HasValue && (q.course_no < 1 || q.course_no > 4)) return "course_no 只能是 1–4";
            if (string.IsNullOrWhiteSpace(q.stem)) return "題幹不可空白";
            if (string.IsNullOrWhiteSpace(q.option_a) || string.IsNullOrWhiteSpace(q.option_b) || string.IsNullOrWhiteSpace(q.option_c) || string.IsNullOrWhiteSpace(q.option_d)) return "選項不可空白";
            q.correct_option = (q.correct_option ?? "").Trim().ToUpperInvariant();
            if (!new[] { "A", "B", "C", "D" }.Contains(q.correct_option)) return "答案只能是 A/B/C/D";
            if (q.time_limit_seconds.HasValue && (q.time_limit_seconds < min || q.time_limit_seconds > max)) return "秒數須為 " + min + "–" + max;
            foreach (var f in U.SplitList(q.explanation_images))
                if (f.Contains("/") || f.Contains("\\") || f.Contains("..") || !Regex.IsMatch(f, "\\.(png|jpe?g|webp|gif)$", RegexOptions.IgnoreCase)) return "圖片檔名不合法：" + f;
            foreach (var u in new[] { q.law_url, q.source_url }.Concat(U.SplitList(q.reference_urls)))
                if (!string.IsNullOrEmpty(u) && !Regex.IsMatch(u, "^https://\\S+$", RegexOptions.IgnoreCase)) return "連結只接受 https://";
            return null;
        }

        public Bank Load()
        {
            var errors = new List<string>();
            var raw = Json.ReadFile<List<Question>>(qFile, new List<Question>()) ?? new List<Question>();
            var list = new List<Question>();
            var seen = new HashSet<string>();
            for (int i = 0; i < raw.Count; i++)
            {
                var q = raw[i];
                if (q == null) continue;
                foreach (var f in typeof(Question).GetFields())
                    if (f.FieldType == typeof(string) && f.GetValue(q) == null) f.SetValue(q, "");
                var e = Validate(q, 1, 600);
                if (e != null) { errors.Add("questions.json 第 " + (i + 1) + " 筆（" + q.question_id + "）：" + e); continue; }
                if (!seen.Add(q.question_id)) { errors.Add("questions.json 題號重複：" + q.question_id); continue; }
                list.Add(q);
            }
            Questions = list;
            ById = list.ToDictionary(q => q.question_id);
            Custom = Json.ReadFile<List<CustomGroup>>(gFile, new List<CustomGroup>()) ?? new List<CustomGroup>();
            Errors = errors;
            LoadedAt = U.Now();
            return this;
        }

        public bool IsDemo(Question q) { return q.question_id.StartsWith("DEMO-", StringComparison.OrdinalIgnoreCase) || q.stem.Contains("【示範題】"); }

        string AutoKey(Question q) { return q.source_name + "|" + (q.course_no.HasValue ? q.course_no.Value.ToString() : ""); }

        public static readonly string[] ThemeSources = { "專業操作證學科題庫", "專業操作證屆期換證題庫", "專業操作證屆期換證題庫_簡易", "普通操作證學科題庫" };
        public List<GroupInfo> Groups()
        {
            return ThemeSources.Select(src => new GroupInfo {
                id = "t:" + src, name = src, description = "全題庫隨機抽題", auto = true,
                count = Questions.Count(q => q.source_name == src),
                active = Questions.Count(q => q.source_name == src && q.active)
            }).ToList();
        }

        public List<string> GroupQuestionIds(IEnumerable<string> groupIds, bool activeOnly)
        {
            var set = new HashSet<string>();
            foreach (var gid in groupIds)
            {
                IEnumerable<string> ids = new string[0];
                if (gid.StartsWith("t:") && ThemeSources.Contains(gid.Substring(2))) ids = Questions.Where(q => q.source_name == gid.Substring(2)).Select(q => q.question_id);
                else if (gid == "demo") ids = Questions.Where(IsDemo).Select(q => q.question_id);
                else if (gid.StartsWith("c"))
                {
                    int idx; if (int.TryParse(gid.Substring(1), out idx) && idx >= 0 && idx < Custom.Count) ids = Custom[idx].questionIds ?? new List<string>();
                }
                else if (gid.StartsWith("a:"))
                {
                    var key = gid.Substring(2);
                    ids = Questions.Where(q => !IsDemo(q) && AutoKey(q) == key).Select(q => q.question_id);
                }
                foreach (var id in ids)
                {
                    Question q; if (ById.TryGetValue(id, out q) && (!activeOnly || q.active)) set.Add(id);
                }
            }
            return set.OrderBy(x => x, StringComparer.Ordinal).ToList();
        }

        public List<string> GroupNames(IEnumerable<string> groupIds)
        {
            var all = Groups();
            return groupIds.Select(id => { var g = all.FirstOrDefault(x => x.id == id); return g != null ? g.name : id; }).ToList();
        }

        public int SetSeconds(IEnumerable<string> ids, int? seconds)
        {
            int n = 0;
            foreach (var id in ids) { Question q; if (ById.TryGetValue(id, out q)) { q.time_limit_seconds = seconds; n++; } }
            Json.WriteFile(qFile, Questions);
            return n;
        }

        public static Explanation ToExplanation(Question q)
        {
            return new Explanation { verified = q.explanation_verified, text = q.answer_explanation, lawReference = q.law_reference, lawExcerpt = q.law_excerpt, lawUrl = q.law_url, referenceUrls = U.SplitList(q.reference_urls), images = U.SplitList(q.explanation_images) };
        }
    }
}
