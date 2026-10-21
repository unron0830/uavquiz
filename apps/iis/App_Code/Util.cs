using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Uqa
{
    public static class Json
    {
        public static JavaScriptSerializer S()
        {
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            s.RecursionLimit = 200;
            return s;
        }
        public static string Stringify(object o) { return S().Serialize(o); }
        public static T Parse<T>(string text) { return S().Deserialize<T>(text); }
        public static object ParseAny(string text) { return S().DeserializeObject(text); }

        public static T ReadFile<T>(string file, T fallback)
        {
            if (!File.Exists(file)) return fallback;
            var text = File.ReadAllText(file, Encoding.UTF8);
            if (text.Length > 0 && text[0] == '﻿') text = text.Substring(1);
            try { return Parse<T>(text); }
            catch (Exception e) { throw new GameError(Path.GetFileName(file) + " 不是有效的 JSON：" + e.Message); }
        }

        /// <summary>原子寫入：先寫暫存檔再取代</summary>
        public static void WriteFile(string file, object data)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            var tmp = file + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
            File.WriteAllText(tmp, Stringify(data), new UTF8Encoding(false));
            if (File.Exists(file)) File.Replace(tmp, file, null);
            else File.Move(tmp, file);
        }
    }

    /// <summary>取用 JSON 物件欄位（DeserializeObject 結果）</summary>
    public static class Obj
    {
        public static Dictionary<string, object> D(object o) { return o as Dictionary<string, object> ?? new Dictionary<string, object>(); }
        public static object Get(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v : null; }
        public static string Str(Dictionary<string, object> d, string k) { var v = Get(d, k); return v == null ? "" : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture); }
        public static bool Bool(Dictionary<string, object> d, string k) { var v = Get(d, k); return v is bool && (bool)v; }
        public static bool Has(Dictionary<string, object> d, string k) { return d != null && d.ContainsKey(k); }
        public static long? Num(Dictionary<string, object> d, string k)
        {
            var v = Get(d, k);
            if (v == null) return null;
            if (v is int || v is long || v is decimal || v is double) return Convert.ToInt64(v);
            long r; return long.TryParse(Convert.ToString(v), out r) ? (long?)r : null;
        }
        public static bool IsInteger(object v)
        {
            if (v is int || v is long) return true;
            if (v is decimal) return decimal.Truncate((decimal)v) == (decimal)v;
            if (v is double) return Math.Floor((double)v) == (double)v;
            return false;
        }
        public static List<string> StrList(Dictionary<string, object> d, string k)
        {
            var v = Get(d, k) as System.Collections.IEnumerable;
            var r = new List<string>();
            if (v == null || v is string) return r;
            foreach (var x in v) if (x != null) r.Add(Convert.ToString(x, System.Globalization.CultureInfo.InvariantCulture));
            return r;
        }
    }

    public static class U
    {
        static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        public static long Now() { return (long)(DateTime.UtcNow - Epoch).TotalMilliseconds; }
        static readonly RandomNumberGenerator Rng = RandomNumberGenerator.Create();
        public static int RandInt(int minIncl, int maxExcl)
        {
            var b = new byte[4];
            lock (Rng) Rng.GetBytes(b);
            var v = BitConverter.ToUInt32(b, 0);
            return (int)(minIncl + v % (uint)(maxExcl - minIncl));
        }
        public static string RandomToken(int bytes)
        {
            var b = new byte[bytes];
            lock (Rng) Rng.GetBytes(b);
            return B64Url(b);
        }
        public static string B64Url(byte[] b) { return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
        public static string Sha256Hex(string s)
        {
            using (var h = SHA256.Create())
            {
                var d = h.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder();
                foreach (var x in d) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }
        public static byte[] Sha256(string s) { using (var h = SHA256.Create()) return h.ComputeHash(Encoding.UTF8.GetBytes(s)); }
        public static string Hmac(string key, string data)
        {
            using (var h = new HMACSHA256(Encoding.UTF8.GetBytes(key))) return B64Url(h.ComputeHash(Encoding.UTF8.GetBytes(data)));
        }
        public static bool FixedEq(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
        public static List<T> Shuffle<T>(IEnumerable<T> src)
        {
            var a = src.ToList();
            for (int i = a.Count - 1; i > 0; i--) { int j = RandInt(0, i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
            return a;
        }
        public static List<string> SplitList(string s)
        {
            return (s ?? "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
        }
        public static int CodePointLength(string s) { return new System.Globalization.StringInfo(s).LengthInTextElements; }

        /// <summary>匯出 CSV 公式注入防護</summary>
        public static string CsvSafe(object v)
        {
            var s = v == null ? "" : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
            if (s.Length > 0 && "=+-@\t\r".IndexOf(s[0]) >= 0) s = "'" + s;
            if (s.IndexOfAny(new[] { '"', ',', '\n', '\r' }) >= 0) s = "\"" + s.Replace("\"", "\"\"") + "\"";
            return s;
        }

        static readonly string[] BadWords = { "幹你", "靠北", "機掰", "雞掰", "王八", "白痴", "智障", "去死", "fuck", "shit", "bitch" };
        /// <summary>學號、姓名或暱稱：2–32 字，限定名稱用純文字字元。</summary>
        public static string ValidateNickname(string raw)
        {
            if (raw == null || raw.Length > 256) return "請輸入有效的學號、姓名或暱稱";
            if (Regex.IsMatch(raw, @"[\p{Cc}\p{Cf}]")) return "名稱不可包含換行、控制字元或隱藏字元";
            string n;
            try { n = Regex.Replace(raw.Normalize(NormalizationForm.FormC).Trim(), " +", " "); }
            catch (ArgumentException) { return "名稱格式不合法"; }
            var len = CodePointLength(n);
            if (len < 2 || len > 32) return "學號、姓名或暱稱需 2–32 字";
            for (int i = 0; i < n.Length; i++)
            {
                var category = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(n, i);
                bool word = category >= System.Globalization.UnicodeCategory.UppercaseLetter && category <= System.Globalization.UnicodeCategory.OtherNumber;
                if (!word && !" ._'’·()-".Contains(n[i].ToString())) return "名稱僅接受文字、數字、空格與 . _ - 單引號、間隔號或括號";
                if (char.IsSurrogatePair(n, i)) i++;
            }
            if (BadWords.Any(w => n.ToLowerInvariant().Contains(w))) return "名稱含有不當用語";
            return null;
        }

        public static readonly string[] AvatarIds = { "fox", "panda", "cat", "dog", "owl", "penguin", "frog", "tiger", "rabbit", "koala", "octopus", "eagle", "unicorn", "dino", "robot", "alien" };

        static readonly string[][] Palette = {
            new[] { "紅隼隊", "#d64545", "▲" }, new[] { "藍鷹隊", "#2f6fd6", "●" }, new[] { "綠蜂隊", "#2e9d5b", "■" }, new[] { "黃蜓隊", "#c99a06", "★" },
            new[] { "紫燕隊", "#8a4fd1", "◆" }, new[] { "青鷺隊", "#138a95", "✚" }, new[] { "粉雀隊", "#d14f95", "♥" }, new[] { "棕鴞隊", "#8a5a33", "⬟" },
            new[] { "靛鶴隊", "#4a4fb8", "✦" }, new[] { "墨鴉隊", "#3d4a52", "⬢" }, new[] { "橄欖隊", "#6b7f1f", "♣" }, new[] { "珊瑚隊", "#d4663a", "♠" } };
        public static TeamInfo TeamStyle(int i, int id)
        {
            var p = Palette[i % Palette.Length];
            var cycle = i / Palette.Length;
            return new TeamInfo { id = id, name = cycle == 0 ? p[0] : p[0].Replace("隊", (cycle + 1) + "隊"), color = p[1], icon = p[2] };
        }
    }
}
