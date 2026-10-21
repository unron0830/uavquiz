using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Uqa
{
    public class QuestionFeedbackEntry
    {
        public string id, sessionId, code, questionId, stem, correct;
        public int questionIndex;
        public Dictionary<string, string> options;
        public Explanation explanation;
        public List<string> categories = new List<string>();
        public string note = "", resolution = "", status = "open";
        public long createdAt, updatedAt;
    }

    public static class QuestionFeedback
    {
        static readonly object Gate = new object();
        static string Folder { get { return Path.Combine(Store.DataDir, "feedback"); } }
        static bool ValidId(string id) { return Regex.IsMatch(id ?? "", "^[a-f0-9]{32}$"); }
        static void Write(QuestionFeedbackEntry row)
        {
            if (!ValidId(row.id)) throw new GameError("回饋編號無效");
            Json.WriteFile(Path.Combine(Folder, row.id + ".json"), row);
        }
        static List<QuestionFeedbackEntry> Read()
        {
            Directory.CreateDirectory(Folder);
            // 相容舊版單檔，移轉時保留原檔；正式機器可直接複製 feedback 資料夾。
            var legacy = Json.ReadFile(Path.Combine(Store.DataDir, "question-feedback.json"), new List<QuestionFeedbackEntry>());
            foreach (var row in legacy.Where(x => x != null && ValidId(x.id)))
                if (!System.IO.File.Exists(Path.Combine(Folder, row.id + ".json"))) Write(row);
            var rows = new List<QuestionFeedbackEntry>();
            foreach (var file in Directory.GetFiles(Folder, "*.json"))
            {
                if (!ValidId(Path.GetFileNameWithoutExtension(file))) continue;
                var row = Json.ReadFile<QuestionFeedbackEntry>(file, null);
                if (row != null && ValidId(row.id) && Path.GetFileNameWithoutExtension(file) == row.id) rows.Add(row);
            }
            return rows;
        }
        static string Text(Dictionary<string, object> body, string key)
        {
            var value = Obj.Get(body, key);
            if (value != null && !(value is string)) throw new GameError("回饋內容須為文字");
            string text = Obj.Str(body, key).Trim();
            if (text.Length > 2000) throw new GameError("回饋內容最多 2000 字");
            return text;
        }
        public static List<QuestionFeedbackEntry> List(string sessionId, string questionId)
        {
            lock (Gate) return Read().Where(x => (string.IsNullOrEmpty(sessionId) || x.sessionId == sessionId) && (string.IsNullOrEmpty(questionId) || x.questionId == questionId)).OrderByDescending(x => x.updatedAt).ToList();
        }
        public static QuestionFeedbackEntry Save(Dictionary<string, object> body)
        {
            var categories = Obj.StrList(body, "categories").Distinct().ToList();
            if (categories.Count == 0 || categories.Any(x => x != "explanation" && x != "images" && x != "law")) throw new GameError("請勾選詳解有誤、圖片有誤或法規有誤");
            var note = Text(body, "note");
            var sessionId = Obj.Str(body, "sessionId");
            var questionId = Obj.Str(body, "questionId");
            var record = Records.Read(sessionId);
            if (record == null) throw new GameError("找不到場次");
            var item = record.plan.FirstOrDefault(x => x.questionId == questionId);
            if (item == null) throw new GameError("題目不在此場次");
            lock (Gate)
            {
                var rows = Read();
                var row = rows.FirstOrDefault(x => x.sessionId == sessionId && x.questionId == questionId);
                if (row == null)
                {
                    row = new QuestionFeedbackEntry { id = Guid.NewGuid().ToString("N"), sessionId = sessionId, code = record.code, questionId = questionId, stem = item.stem, options = item.options, correct = item.correct, questionIndex = record.plan.IndexOf(item) + 1, explanation = item.explanation, createdAt = U.Now() };
                    Question q;
                    if (Store.Bank.ById.TryGetValue(questionId, out q) && q.stem == item.stem && q.correct_option == item.correct) row.explanation = Bank.ToExplanation(q);
                    rows.Add(row);
                }
                row.categories = categories; row.note = note; row.status = "open"; row.updatedAt = U.Now();
                Write(row);
                return row;
            }
        }
        public static QuestionFeedbackEntry Review(string id, Dictionary<string, object> body)
        {
            if (!Regex.IsMatch(id, "^[a-f0-9]{32}$")) throw new GameError("回饋編號無效");
            var status = Obj.Str(body, "status");
            if (status != "open" && status != "resolved") throw new GameError("回饋狀態無效");
            var resolution = Text(body, "resolution");
            lock (Gate)
            {
                var rows = Read();
                var row = rows.FirstOrDefault(x => x.id == id);
                if (row == null) throw new GameError("找不到回饋");
                row.status = status; row.resolution = resolution; row.updatedAt = U.Now();
                Write(row); return row;
            }
        }
    }
}
