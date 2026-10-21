<%@ WebHandler Language="C#" Class="Uqa.Api" %>
<%@ Assembly Name="System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31BF3856AD364E35" %>
<%@ Assembly Name="System.Drawing, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a" %>
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Threading;
using System.Web.Script.Serialization;
using System.Globalization;
using System.Security.Cryptography;

// Api.cs
namespace Uqa
{
    /// <summary>
    /// 單一 API 入口：api.ashx?r=/路徑?參數
    /// 學生、投影、老師都用短輪詢（Windows 10 IIS 同時連線上限 10，不能用長連線）。
    /// </summary>
    public class Api : IHttpHandler
    {
        public bool IsReusable { get { return true; } }
        const string Cookie = "uqa_host";
        static readonly Dictionary<string, List<long>> Hits = new Dictionary<string, List<long>>();

        static bool Limit(string key, int windowMs, int max)
        {
            var now = U.Now();
            lock (Hits)
            {
                List<long> l;
                if (!Hits.TryGetValue(key, out l)) { l = new List<long>(); Hits[key] = l; }
                l.RemoveAll(t => now - t > windowMs);
                if (l.Count >= max) return false;
                l.Add(now);
                if (Hits.Count > 5000) foreach (var k in Hits.Where(kv => kv.Value.Count == 0).Select(kv => kv.Key).ToList()) Hits.Remove(k);
                return true;
            }
        }

        class Ctx
        {
            public HttpContext H; public string Path; public NameValueCollection Q; public Dictionary<string, object> Body; public string Method;
            public string P(string k) { return Q[k] ?? ""; }
        }

        public void ProcessRequest(HttpContext h)
        {
            h.Response.ContentType = "application/json; charset=utf-8";
            h.Response.Cache.SetCacheability(HttpCacheability.NoCache);
            h.Response.Cache.SetNoStore();
            h.Response.AddHeader("X-Content-Type-Options", "nosniff");
            try
            {
                Store.EnsureInit(h);
                var r = h.Request.QueryString["r"] ?? "/";
                var qi = r.IndexOf('?');
                var c = new Ctx { H = h, Method = h.Request.HttpMethod.ToUpperInvariant(), Q = new NameValueCollection(h.Request.QueryString) };
                c.Path = qi >= 0 ? r.Substring(0, qi) : r;
                if (qi >= 0) c.Q.Add(HttpUtility.ParseQueryString(r.Substring(qi + 1)));
                if (c.Method != "GET")
                {
                    if (h.Request.Headers["X-Requested-With"] != "uqa") { Fail(h, 403, "CSRF 驗證失敗"); return; }
                    string text;
                    using (var sr = new StreamReader(h.Request.InputStream, Encoding.UTF8)) text = sr.ReadToEnd();
                    c.Body = string.IsNullOrWhiteSpace(text) ? new Dictionary<string, object>() : Obj.D(Json.ParseAny(text));
                }
                else c.Body = new Dictionary<string, object>();
                Route(c);
            }
            catch (GameError e) { Fail(h, 400, e.Message); }
            catch (Exception) { Fail(h, 500, "伺服器處理失敗，請聯絡此站管理者。"); }
        }

        static void Send(HttpContext h, object o) { h.Response.Write(Json.Stringify(o)); }
        static void Fail(HttpContext h, int code, string msg)
        {
            h.Response.Clear();
            h.Response.TrySkipIisCustomErrors = true;
            h.Response.StatusCode = code;
            h.Response.ContentType = "application/json; charset=utf-8";
            h.Response.Write(Json.Stringify(new Dictionary<string, object> { { "error", msg } }));
        }
        static string Ip(HttpContext h) { return h.Request.UserHostAddress ?? "x"; }

        // ---------- 老師登入（單一密碼） ----------
        static string Fingerprint() { return U.B64Url(U.Sha256(Store.Config.hostPassword)).Substring(0, 10); }
        static string MakeCookie()
        {
            var payload = U.B64Url(Encoding.UTF8.GetBytes((U.Now() + 10L * 3600 * 1000) + "." + Fingerprint()));
            return payload + "." + U.Hmac(Store.Config.sessionSecret, payload);
        }
        static bool IsHost(HttpContext h)
        {
            var ck = h.Request.Cookies[Cookie];
            if (string.IsNullOrWhiteSpace(Store.Config.hostPassword) || ck == null || string.IsNullOrEmpty(ck.Value)) return false;
            var parts = ck.Value.Split('.');
            if (parts.Length != 2) return false;
            var exp = U.Hmac(Store.Config.sessionSecret, parts[0]);
            if (!U.FixedEq(Encoding.UTF8.GetBytes(exp), Encoding.UTF8.GetBytes(parts[1]))) return false;
            try
            {
                var p = parts[0].Replace('-', '+').Replace('_', '/');
                while (p.Length % 4 != 0) p += "=";
                var s = Encoding.UTF8.GetString(Convert.FromBase64String(p)).Split('.');
                return long.Parse(s[0]) > U.Now() && s[1] == Fingerprint();
            }
            catch { return false; }
        }
        static void SetCookie(HttpContext h, string v)
        {
            var c = new HttpCookie(Cookie, v ?? "") { HttpOnly = true, Path = VirtualPathUtility.GetDirectory(h.Request.FilePath), Secure = h.Request.IsSecureConnection };
            if (v == null) c.Expires = DateTime.UtcNow.AddDays(-1); else c.Expires = DateTime.UtcNow.AddHours(10);
            h.Response.Headers.Add("Set-Cookie", c.Name + "=" + c.Value + "; Path=" + c.Path + "; HttpOnly; SameSite=Strict" + (c.Secure ? "; Secure" : "") + (v == null ? "; Max-Age=0" : "; Max-Age=36000"));
        }
        static bool RequireHost(Ctx c) { if (IsHost(c.H)) return true; Fail(c.H, 401, "請先輸入老師密碼"); return false; }

        /// <summary>對外網址（QR Code 用）：config.json 的 publicBaseUrl 優先，否則依請求的 Host 標頭</summary>
        static string PublicBase(HttpContext h)
        {
            var cfg = Store.Config.publicBaseUrl;
            if (!string.IsNullOrWhiteSpace(cfg)) return cfg.TrimEnd('/') + "/";
            var u = h.Request.Url;
            var host = h.Request.Headers["Host"];
            // api.ashx 所在的網址目錄（放在子資料夾時也正確，例如 /quiz/）
            var dir = VirtualPathUtility.GetDirectory(h.Request.FilePath);
            return u.Scheme + "://" + (string.IsNullOrEmpty(host) ? u.Authority : host) + dir;
        }

        static object BankInfo()
        {
            var b = Store.Bank;
            return new Dictionary<string, object> { { "total", b.Questions.Count }, { "active", b.Questions.Count(q => q.active) }, { "withSeconds", b.Questions.Count(q => q.time_limit_seconds.HasValue) },
                { "errors", b.Errors.Take(50).ToList() }, { "errorCount", b.Errors.Count }, { "loadedAt", b.LoadedAt } };
        }
        static object WithEstimates(AppSettings s)
        {
            return new Dictionary<string, object> { { "settings", s }, { "estimates", s.courses.Select(c => (object)Scoring.Estimate(c, s.timing)).ToList() } };
        }

        void Route(Ctx c)
        {
            var h = c.H; var path = c.Path; var m = c.Method; var now = U.Now();
            Match mt;

            if (path == "/health") { Send(h, new Dictionary<string, object> { { "ok", true }, { "time", now }, { "sessions", Store.Sessions.Count }, { "questions", Store.Bank.Questions.Count }, { "server", "aspnet" } }); return; }

            // ---- 學生 ----
            if (path == "/public/avatar" && m == "POST")
            {
                var session = Store.ByCode(Obj.Str(c.Body, "code"));
                if (session == null || session.Phase == "FINISHED" || session.Phase == "AWARDS" || session.Phase == "ABORTED") throw new GameError("請先加入有效的場次");
                lock (session.Lock)
                {
                    if (session.Participants.Values.Count(p => !p.removed) >= Store.MaxParticipants) throw new GameError("本場次人數已滿");
                    if (session.S.rosterLocked && !session.S.flags.allowLateJoin) throw new GameError("比賽已開始，無法再上傳頭像");
                }
                if (!Limit("avatar:" + Ip(h), 60000, 300)) { Fail(h, 429, "上傳太頻繁，請稍後再試"); return; }
                Send(h, new Dictionary<string, object> { { "avatar", Avatars.Upload(Obj.Str(c.Body, "image")) } }); return;
            }
            if (path == "/public/avatar" && m == "GET")
            {
                var avatarId = c.P("id");
                if (!Avatars.ValidId(avatarId) || !System.IO.File.Exists(Avatars.FilePath(avatarId))) { Fail(h, 404, "頭像不存在"); return; }
                h.Response.ContentType = "image/png";
                h.Response.AddHeader("Content-Disposition", "inline; filename=avatar.png");
                h.Response.BinaryWrite(System.IO.File.ReadAllBytes(Avatars.FilePath(avatarId))); return;
            }
            if (path == "/play/poll")
            {
                var s = Store.ByCode(c.P("code"));
                if (s == null) { Fail(h, 401, "unauthorized"); return; }
                lock (s.Lock)
                {
                    s.Tick(now);
                    var p = s.FindByToken(c.P("token"));
                    if (p == null)
                    {
                        Fail(h, 401, s.Participants.Values.Any(x => x.removed && x.tokenHash == U.Sha256Hex(c.P("token"))) ? "kicked" : "unauthorized");
                        return;
                    }
                    p.lastSeen = now;
                    Send(h, new Dictionary<string, object> { { "state", s.PublicState("player", now) }, { "me", s.MyStatus(p.id) }, { "joined", s.ParticipantView(p) } });
                }
                return;
            }
            if (path == "/play/answer" && m == "POST")
            {
                var s = Store.ByCode(Obj.Str(c.Body, "code"));
                if (s == null) { Fail(h, 401, "unauthorized"); return; }
                if (!Limit("ans:" + Obj.Str(c.Body, "token"), 10000, 40)) { Send(h, new Dictionary<string, object> { { "ok", false }, { "code", "rate_limited" }, { "message", "操作太頻繁" } }); return; }
                lock (s.Lock)
                {
                    s.Tick(now);
                    var p = s.FindByToken(Obj.Str(c.Body, "token"));
                    if (p == null) { Fail(h, 401, "unauthorized"); return; }
                    p.lastSeen = now;
                    Send(h, s.Submit(p.id, Obj.Str(c.Body, "questionId"), Obj.Str(c.Body, "option"), now));
                }
                return;
            }
            if ((mt = Regex.Match(path, "^/public/session/(\\d{6})$")).Success)
            {
                var s = Store.ByCode(mt.Groups[1].Value);
                if (s == null || s.Phase == "FINISHED" || s.Phase == "AWARDS") { Fail(h, 404, "找不到進行中的場次，請確認代碼"); return; }
                lock (s.Lock) Send(h, new Dictionary<string, object> { { "code", s.R.code }, { "courseTitle", s.R.courseTitle }, { "phase", s.Phase }, { "rosterLocked", s.S.rosterLocked }, { "allowLateJoin", s.S.flags.allowLateJoin } });
                return;
            }
            if (path == "/public/join" && m == "POST")
            {
                if (!Limit("join:" + Ip(h), 60000, 300)) { Fail(h, 429, "加入太頻繁，請稍後再試"); return; }
                var s = Store.ByCode(Obj.Str(c.Body, "code"));
                if (s == null) { Fail(h, 404, "找不到場次，請確認代碼"); return; }
                lock (s.Lock)
                {
                    if (!(Obj.Get(c.Body, "nickname") is string)) throw new GameError("請輸入有效的學號、姓名或暱稱");
                    string token;
                    var p = s.Join(Obj.Str(c.Body, "nickname"), Obj.Str(c.Body, "avatar"), Store.MaxParticipants, out token);
                    Send(h, new Dictionary<string, object> { { "token", token }, { "participant", s.ParticipantView(p) } });
                }
                return;
            }

            // ---- 投影（需舞台金鑰） ----
            if (path == "/stage/poll" || path == "/stage/info")
            {
                var s = Store.Get(c.P("id"), true);
                if (s == null || c.P("t") != s.R.stageToken) { Fail(h, 403, "unauthorized"); return; }
                lock (s.Lock)
                {
                    s.Tick(now);
                    if (path == "/stage/info") Send(h, new Dictionary<string, object> { { "code", s.R.code }, { "joinUrl", PublicBase(h) + "#/join/" + s.R.code }, { "rounds", s.R.config.rounds } });
                    else Send(h, new Dictionary<string, object> { { "state", s.PublicState("stage", now) } });
                }
                return;
            }

            // ---- 老師 ----
            if (path == "/setup/status" && m == "GET") { Send(h, new { required = FirstRun.Required }); return; }
            if (path == "/setup/complete" && m == "POST")
            {
                if (!Limit("setup:" + Ip(h), 15 * 60 * 1000, 10)) { Fail(h, 429, "Too many attempts"); return; }
                FirstRun.Complete(c.Body); Send(h, new { ok = true }); return;
            }
            if (path == "/auth/me") { Send(h, new Dictionary<string, object> { { "host", IsHost(h) } }); return; }
            if (path == "/auth/login" && m == "POST")
            {
                if (string.IsNullOrWhiteSpace(Store.Config.hostPassword)) { Fail(h, 503, "此站尚未設定主持人密碼，請聯絡管理者。"); return; }
                if (!Limit("login:" + Ip(h), 15 * 60 * 1000, 10)) { Fail(h, 429, "嘗試太多次，請 15 分鐘後再試"); return; }
                if (!U.FixedEq(U.Sha256(Obj.Str(c.Body, "password")), U.Sha256(Store.Config.hostPassword))) { Fail(h, 401, "老師密碼錯誤，請重新輸入"); return; }
                SetCookie(h, MakeCookie());
                Send(h, new Dictionary<string, object> { { "ok", true } });
                return;
            }
            if (path == "/auth/logout" && m == "POST") { SetCookie(h, null); Send(h, new Dictionary<string, object> { { "ok", true } }); return; }
            if (!RequireHost(c)) return;

            if (path == "/feedback-settings" && m == "GET") { Send(h, new { githubRepository = Store.Config.githubRepository }); return; }
            if (path == "/question-feedback" && m == "GET") { Send(h, QuestionFeedback.List(c.P("sessionId"), c.P("questionId"))); return; }
            if (path == "/question-feedback" && m == "POST") { Send(h, QuestionFeedback.Save(c.Body)); return; }
            if ((mt = Regex.Match(path, "^/question-feedback/([a-f0-9]{32})$")).Success && m == "POST") { Send(h, QuestionFeedback.Review(mt.Groups[1].Value, c.Body)); return; }

            if (path == "/settings" && m == "GET")
            {
                var d = (Dictionary<string, object>)WithEstimates(Store.CurrentSettings());
                d["groups"] = Store.Bank.Groups(); d["bank"] = BankInfo();
                Send(h, d); return;
            }
            if (path == "/settings" && m == "PUT") { lock (Store.Gate) { var s = Settings.Validate(c.Body, Store.Config); Store.SaveSettings(s); Send(h, WithEstimates(s)); } return; }
            if (path == "/settings/preview" && m == "POST") { Send(h, WithEstimates(Settings.Validate(c.Body, Store.Config))); return; }
            if (path == "/bank/reload" && m == "POST")
            {
                lock (Store.Gate) Store.Bank.Load();
                Send(h, new Dictionary<string, object> { { "groups", Store.Bank.Groups() }, { "bank", BankInfo() } }); return;
            }
            if (path == "/groups/questions" && m == "POST")
            {
                var ids = Store.Bank.GroupQuestionIds(Obj.StrList(c.Body, "groupIds"), false);
                Send(h, ids.Select(id => { var q = Store.Bank.ById[id]; return new Dictionary<string, object> { { "id", id }, { "stem", q.stem }, { "correct", q.correct_option }, { "seconds", q.time_limit_seconds }, { "active", q.active } }; }).ToList());
                return;
            }
            if (path == "/questions/seconds" && m == "POST")
            {
                var ids = Obj.StrList(c.Body, "ids");
                if (ids.Count == 0) { Fail(h, 400, "請選擇題目"); return; }
                var sec = Obj.Get(c.Body, "seconds"); var t = Store.Config.timing;
                int? secs = null;
                if (sec != null)
                {
                    if (!Obj.IsInteger(sec) || Convert.ToInt64(sec) < t.minQuestionSeconds || Convert.ToInt64(sec) > t.maxQuestionSeconds) { Fail(h, 400, "秒數須為 " + t.minQuestionSeconds + "–" + t.maxQuestionSeconds); return; }
                    secs = Convert.ToInt32(sec);
                }
                lock (Store.Gate) Send(h, new Dictionary<string, object> { { "changed", Store.Bank.SetSeconds(ids, secs) } });
                return;
            }
            if (path == "/images")
            {
                var q = c.P("q").ToLowerInvariant();
                var files = Directory.GetFiles(Store.ImagesDir).Select(System.IO.Path.GetFileName).Where(f => Regex.IsMatch(f, "\\.(png|jpe?g|webp|gif)$", RegexOptions.IgnoreCase) && f.ToLowerInvariant().Contains(q)).OrderBy(f => f, StringComparer.Ordinal).Take(300).ToList();
                Send(h, files); return;
            }
            if (path == "/sessions/random" && m == "POST")
            {
                var groups = Obj.StrList(c.Body, "groupIds").Distinct().ToList();
                var count = Obj.Num(c.Body, "questionCount");
                var seconds = Obj.Num(c.Body, "answerSeconds");
                var teamCount = Obj.Num(c.Body, "teamCount");
                var maxTeamSize = Obj.Num(c.Body, "maxTeamSize");
                if (Obj.Has(c.Body, "maxTeamSize") && (!Obj.IsInteger(Obj.Get(c.Body, "maxTeamSize")) || !maxTeamSize.HasValue || maxTeamSize.Value < 1 || maxTeamSize.Value > 100)) throw new GameError("每組人數上限請輸入 1～100 的整數");
                if (Obj.Has(c.Body, "maxTeamSize") && Obj.Has(c.Body, "teamCount")) throw new GameError("請擇一設定每組人數上限或隊伍數");
                if (Obj.Has(c.Body, "teamCount") && (!Obj.IsInteger(Obj.Get(c.Body, "teamCount")) || !teamCount.HasValue || teamCount.Value < 1 || teamCount.Value > 24)) throw new GameError("隊伍數請選擇 1～24 隊");
                var explanation = Obj.Has(c.Body, "explanationSeconds") ? Obj.Num(c.Body, "explanationSeconds") : (long?)10;
                if (!explanation.HasValue || (Obj.Has(c.Body, "explanationSeconds") && !Obj.IsInteger(Obj.Get(c.Body, "explanationSeconds"))) || !new long[] { 5, 10, 15, 20, 30 }.Contains(explanation.Value)) throw new GameError("講解時間請選擇 5、10、15、20 或 30 秒");
                if (!Obj.IsInteger(Obj.Get(c.Body, "questionCount")) || !count.HasValue || !new[] { 20.0, 40.0, 80.0 }.Contains((double)count.Value)) throw new GameError("題數請選擇 20、40 或 80 題");
                if (!Obj.IsInteger(Obj.Get(c.Body, "answerSeconds")) || !seconds.HasValue || seconds.Value < 15 || seconds.Value > 120) throw new GameError("作答時間請輸入 15～120 的整數秒數");
                if (groups.Count == 0 || groups.Any(g => !Uqa.Bank.ThemeSources.Any(src => g == "t:" + src))) throw new GameError("請勾選有效的題庫主題");
                GameSession session;
                lock (Store.Gate) {
                    session = Store.Create(1, groups, true, false, (int)count.Value, (int)seconds.Value, (int)explanation.Value);
                    if (teamCount.HasValue) lock (session.Lock) session.AssignTeams((int)teamCount.Value);
                    if (maxTeamSize.HasValue) lock (session.Lock) session.SetTeamSize((int)maxTeamSize.Value);
                }
                Send(h, new Dictionary<string, object> { { "id", session.R.id }, { "code", session.R.code } }); return;
            }
            if (path == "/sessions" && m == "POST")
            {
                var s = Store.Create((int)(Obj.Num(c.Body, "courseNo") ?? 0), Obj.StrList(c.Body, "groupIds"), !(Obj.Get(c.Body, "shuffle") is bool) || (bool)Obj.Get(c.Body, "shuffle"), Obj.Bool(c.Body, "demo"));
                Send(h, new Dictionary<string, object> { { "id", s.R.id }, { "code", s.R.code } }); return;
            }
            if (path == "/sessions/live")
            {
                List<GameSession> all; lock (Store.Gate) all = Store.Sessions.Values.ToList();
                Send(h, all.Where(s => s.Phase != "ABORTED").Select(s => new Dictionary<string, object> { { "id", s.R.id }, { "code", s.R.code }, { "courseNo", s.R.courseNo }, { "courseTitle", s.R.courseTitle }, { "phase", s.Phase }, { "participants", s.Participants.Values.Count(p => !p.removed) } }).ToList());
                return;
            }
            if ((mt = Regex.Match(path, "^/sessions/([\\w-]+)$")).Success && m == "GET")
            {
                var s = Store.Get(mt.Groups[1].Value, true);
                if (s == null) { Fail(h, 404, "場次不在進行中（可到「紀錄查詢」看結果）"); return; }
                var b = PublicBase(h);
                Send(h, new Dictionary<string, object> { { "id", s.R.id }, { "code", s.R.code }, { "courseNo", s.R.courseNo }, { "demo", s.R.demo }, { "groupNames", s.R.groupNames },
                    { "joinUrl", b + "#/join/" + s.R.code }, { "stageUrl", b + "#/stage/" + s.R.id + "?t=" + Uri.EscapeDataString(s.R.stageToken) } });
                return;
            }
            if (path == "/host/poll")
            {
                var s = Store.Get(c.P("id"), true);
                if (s == null) { Fail(h, 404, "場次不存在或已封存"); return; }
                lock (s.Lock) { s.Tick(now); Send(h, new Dictionary<string, object> { { "state", s.PublicState("host", now) }, { "monitor", s.Monitor(now) } }); }
                return;
            }
            if (path == "/host/cmd" && m == "POST")
            {
                var s = Store.Get(Obj.Str(c.Body, "id"), true);
                if (s == null) { Fail(h, 404, "場次不存在"); return; }
                lock (s.Lock)
                {
                    s.Tick(now);
                    try { s.Command(Obj.D(Obj.Get(c.Body, "cmd")), now); Send(h, new Dictionary<string, object> { { "ok", true } }); }
                    catch (GameError e) { Send(h, new Dictionary<string, object> { { "ok", false }, { "message", e.Message } }); }
                }
                return;
            }

            // ---- 紀錄查詢 ----
            if (path == "/records") { Send(h, Records.List()); return; }
            if (path == "/records/search") { Send(h, Records.SearchNickname(c.P("nickname"))); return; }
            if ((mt = Regex.Match(path, "^/records/([\\w-]+)(/csv|/json)?$")).Success)
            {
                var id = mt.Groups[1].Value; var sub = mt.Groups[2].Value;
                if (m == "DELETE")
                {
                    var live = Store.Get(id);
                    if (live != null && live.Phase != "FINISHED" && live.Phase != "AWARDS" && live.Phase != "ABORTED") { Fail(h, 400, "進行中的場次不能刪除，請先結束或終止"); return; }
                    if (live != null) lock (Store.Gate) Store.Sessions.Remove(id);
                    Send(h, new Dictionary<string, object> { { "ok", Records.Delete(id) } }); return;
                }
                var r = Records.Read(id);
                if (r == null) { Fail(h, 404, "找不到這場紀錄"); return; }
                if (sub == "/csv")
                {
                    var kind = c.P("kind") == "answers" ? "answers" : "summary";
                    h.Response.ContentType = "text/csv; charset=utf-8";
                    var fname = r.id + "_" + (kind == "answers" ? "作答明細" : "成績摘要") + ".csv";
                    h.Response.AddHeader("Content-Disposition", "attachment; filename=\"" + r.id + ".csv\"; filename*=UTF-8''" + Uri.EscapeDataString(fname));
                    h.Response.Write(Records.Csv(Records.Report(r), kind));
                    return;
                }
                if (sub == "/json")
                {
                    foreach (var p in r.participants) p.tokenHash = null;
                    r.stageToken = null;
                    h.Response.AddHeader("Content-Disposition", "attachment; filename=\"" + r.id + ".json\"");
                    Send(h, r); return;
                }
                Send(h, Records.Report(r)); return;
            }
            Fail(h, 404, "Not found");
        }
    }
}

// Avatars.cs
namespace Uqa
{
    public static class Avatars
    {
        static string DirectoryPath { get { return Path.Combine(Store.DataDir, "avatars"); } }
        public static bool ValidId(string id) { return id != null && Regex.IsMatch(id, "\\A[a-f0-9]{32}\\z"); }
        public static string FilePath(string id)
        {
            if (!ValidId(id)) throw new GameError("頭像不存在");
            return Path.Combine(DirectoryPath, id + ".png");
        }
        public static bool Exists(string avatar)
        {
            return avatar != null && avatar.StartsWith("upload:") && ValidId(avatar.Substring(7)) && File.Exists(FilePath(avatar.Substring(7)));
        }
        public static string Upload(string data)
        {
            if (data == null || data.Length > 720000) throw new GameError("頭像檔案太大，請重新選擇圖片");
            string prefix;
            if (data.StartsWith("data:image/png;base64,")) prefix = "data:image/png;base64,";
            else if (data.StartsWith("data:image/jpeg;base64,")) prefix = "data:image/jpeg;base64,";
            else throw new GameError("頭像僅接受 PNG 或 JPEG 圖片");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(data.Substring(prefix.Length)); }
            catch (FormatException) { throw new GameError("圖片格式不正確"); }
            if (bytes.Length == 0 || bytes.Length > 512000) throw new GameError("圖片大小不正確");
            // Decode actual pixels and create a fresh PNG. Never store original filenames,
            // SVG, metadata or executable content from the upload.
            try
            {
                using (var input = new MemoryStream(bytes))
                using (var image = Image.FromStream(input, false, true))
                {
                    if (image.RawFormat.Guid != ImageFormat.Png.Guid && image.RawFormat.Guid != ImageFormat.Jpeg.Guid) throw new GameError("頭像僅接受 PNG 或 JPEG 圖片");
                    if (image.Width < 1 || image.Height < 1 || image.Width > 4096 || image.Height > 4096) throw new GameError("圖片尺寸過大");
                    using (var output = new Bitmap(128, 128, PixelFormat.Format32bppArgb))
                    {
                        using (var graphics = Graphics.FromImage(output))
                        {
                            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            var side = Math.Min(image.Width, image.Height);
                            graphics.DrawImage(image, new Rectangle(0, 0, 128, 128), new Rectangle((image.Width - side) / 2, (image.Height - side) / 2, side, side), GraphicsUnit.Pixel);
                        }
                        Directory.CreateDirectory(DirectoryPath);
                        var id = Guid.NewGuid().ToString("N");
                        output.Save(FilePath(id), ImageFormat.Png);
                        return "upload:" + id;
                    }
                }
            }
            catch (ArgumentException) { throw new GameError("無法讀取這張圖片，請改選 PNG 或 JPEG"); }
            catch (OutOfMemoryException) { throw new GameError("圖片格式或尺寸不正確"); }
        }
    }
}

// Bank.cs
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

// FirstRun.cs
namespace Uqa {
 public static class FirstRun {
  public static bool Required { get { return string.IsNullOrWhiteSpace(Store.Config.hostPassword); } }
  static string TokenPath { get { return Path.Combine(Store.DataDir, "setup-token.txt"); } }
  public static void EnsureToken() {
   lock (Store.Gate) { if (Required && !File.Exists(TokenPath)) File.WriteAllText(TokenPath, U.RandomToken(32), Encoding.UTF8); }
  }
  public static void Complete(Dictionary<string, object> body) {
   lock (Store.Gate) {
    if (!Required) throw new GameError("此站已完成設定，請登入。");
    EnsureToken();
    if (!U.FixedEq(Encoding.UTF8.GetBytes(Obj.Str(body,"setupToken").Trim()), Encoding.UTF8.GetBytes(File.ReadAllText(TokenPath,Encoding.UTF8).Trim()))) throw new GameError("首次設定碼不正確，請向伺服器管理者取得。");
    var pw=Obj.Str(body,"password");
    if (string.IsNullOrWhiteSpace(pw) || pw.Length<12 || pw.Length>128) throw new GameError("密碼須為 12–128 字元，且不可全部為空白。");
    if (pw!=Obj.Str(body,"confirmPassword")) throw new GameError("兩次密碼不一致。");
    var url=Obj.Str(body,"publicBaseUrl").Trim().TrimEnd('/'); Uri parsed;
    if (url.Length>0 && (!Uri.TryCreate(url,UriKind.Absolute,out parsed) || (parsed.Scheme!="http" && parsed.Scheme!="https") || parsed.UserInfo.Length>0 || parsed.Query.Length>0 || parsed.Fragment.Length>0)) throw new GameError("請填寫有效網站網址，包含子目錄、不含參數。");
    var oldUrl=Store.Config.publicBaseUrl;
    Store.Config.hostPassword=pw; Store.Config.publicBaseUrl=url;
    try { Json.WriteFile(Store.ConfigFilePath,Store.Config); }
    catch { Store.Config.hostPassword=""; Store.Config.publicBaseUrl=oldUrl; throw; }
    try { File.Delete(TokenPath); } catch { }
   }
  }
 }
}

// GameSession.cs
namespace Uqa
{
    /// <summary>
    /// 一場比賽。伺服器權威計時：不使用計時器，任何請求進來時先 Tick()，
    /// 依截止時間推進狀態（轉場時間點以「預定時間」計算，不受請求延遲影響）。
    /// </summary>
    public class GameSession
    {
        public readonly object Lock = new object();
        public SessionRecord R;
        public string File;
        public string ImagesDir;
        public long? EndsAt;
        public long OpenedAt;
        public int Version, Sequence;
        public Dictionary<string, Answer> Answers = new Dictionary<string, Answer>();
        public Dictionary<int, Participant> Participants = new Dictionary<int, Participant>();
        public Dictionary<string, int> Tokens = new Dictionary<string, int>();
        public Dictionary<string, string> Adhoc; // {kind, value}
        int joinCounter;
        Timer writeTimer;
        bool dirty;
        long lastWrite;

        public Snapshot S { get { return R.state; } }
        public string Phase { get { return R.state.phase; } }

        public GameSession(SessionRecord rec, string file, string imagesDir)
        {
            R = rec; File = file; ImagesDir = imagesDir;
            foreach (var p in rec.participants) { Participants[p.id] = p; if (p.tokenHash != null) Tokens[p.tokenHash] = p.id; joinCounter = Math.Max(joinCounter, p.joinOrder); }
            foreach (var a in rec.answers) Answers[Key(a.participantId, a.questionId, a.attempt)] = a;
        }

        static string Key(int pid, string qid, int attempt) { return pid + "|" + qid + "|" + attempt; }
        int Attempt(string qid) { int a; return S.attempts.TryGetValue(qid, out a) ? a : 0; }
        void Audit(string type, object detail) { R.events.Add(new SessionEvent { at = U.Now(), type = type, detail = detail ?? new Dictionary<string, object>() }); }
        public int Total { get { return R.config.rounds.Sum(); } }

        // ---------- 持久化 ----------
        public string Status()
        {
            if (Phase == "LOBBY") return "LOBBY";
            if (Phase == "FINISHED" || Phase == "AWARDS" || Phase == "ABORTED") return Phase;
            return "RUNNING";
        }
        void SyncRecord(long now)
        {
            R.status = Status();
            R.participants = Participants.Values.OrderBy(p => p.joinOrder).ToList();
            R.answers = Answers.Values.OrderBy(a => a.acceptedAt).ToList();
            S.remainingMs = S.paused ? S.remainingMs : (EndsAt.HasValue ? (long?)Math.Max(0, EndsAt.Value - now) : null);
        }
        /// <summary>變更後 0.3 秒內合併寫入</summary>
        public void Persist()
        {
            dirty = true;
            var now = U.Now();
            if (now - lastWrite > 300) { Flush(); return; }
            if (writeTimer == null) writeTimer = new Timer(_ => { lock (Lock) { if (dirty) Flush(); } }, null, 320, Timeout.Infinite);
            else writeTimer.Change(320, Timeout.Infinite);
        }
        public void Flush()
        {
            var now = U.Now();
            SyncRecord(now);
            Json.WriteFile(File, R);
            dirty = false;
            lastWrite = now;
        }
        /// <summary>從紀錄檔恢復：進行中的場次一律暫停</summary>
        public void Restore()
        {
            var p = Phase;
            bool timed = p == "QUESTION_OPEN" || p == "TRANSITION" || p == "LEADERBOARD" || (p == "REVEAL" && !S.explaining);
            if (timed && !S.paused) { S.paused = true; if (!S.remainingMs.HasValue) S.remainingMs = 0; }
            EndsAt = null;
            Audit("session.restored", new Dictionary<string, object> { { "phase", p }, { "cursor", S.cursor } });
        }
        void Changed(bool state) { if (state) Version++; Sequence++; Persist(); }

        // ---------- 計時推進 ----------
        public void Tick(long now)
        {
            int guard = 0;
            while (!S.paused && EndsAt.HasValue && now >= EndsAt.Value && guard++ < 500)
            {
                long at = EndsAt.Value;
                var act = S.pending;
                EndsAt = null; S.pending = null;
                if (act == "close") CloseQuestion(at);
                else if (act == "afterReveal") AfterReveal(at);
                else if (act == "open") OpenQuestion(S.cursor + 1, at);
            }
        }
        void Schedule(long at, string action) { EndsAt = at; S.pending = action; }
        void ClearTimer() { EndsAt = null; S.pending = null; }

        public int SecondsFor(int i)
        {
            var s = i >= 0 && i < R.plan.Count && R.plan[i].seconds.HasValue ? R.plan[i].seconds.Value : R.config.answerSeconds;
            return Math.Min(R.config.maxSeconds, Math.Max(R.config.minSeconds, s));
        }
        public int[] RoundInfo(int i) // roundNo, roundIndex, roundTotal, isRoundEnd
        {
            int acc = 0;
            for (int r = 0; r < R.config.rounds.Count; r++)
            {
                int n = R.config.rounds[r];
                if (i < acc + n) return new[] { r + 1, i - acc + 1, n, i == acc + n - 1 ? 1 : 0 };
                acc += n;
            }
            return new[] { R.config.rounds.Count, 1, 1, 1 };
        }

        // ---------- 參賽者 ----------
        public Participant Join(string nickname, string avatar, int maxParticipants, out string token)
        {
            if (Phase == "FINISHED" || Phase == "AWARDS" || Phase == "ABORTED") throw new GameError("本場次已結束");
            bool late = S.rosterLocked;
            if (late && !S.flags.allowLateJoin) throw new GameError("比賽已開始，名單已鎖定；如需加入請洽老師");
            var active = Participants.Values.Where(p => !p.removed).ToList();
            if (active.Count >= Math.Min(maxParticipants, Store.MaxParticipants)) throw new GameError("本場次已滿 100 人，無法再加入");
            var err = U.ValidateNickname(nickname);
            if (err != null) throw new GameError(err);
            var nick = Regex.Replace(nickname.Normalize(System.Text.NormalizationForm.FormC).Trim(), " +", " ");
            var names = new HashSet<string>(active.Select(p => p.nickname));
            if (names.Contains(nick)) { int i = 2; while (names.Contains(nick + "#" + i)) i++; nick = nick + "#" + i; }
            var av = U.AvatarIds.Contains(avatar) || Avatars.Exists(avatar) ? avatar : U.AvatarIds[0];
            token = U.RandomToken(32);
            int? teamId = null;
            if (R.teams.Count > 0 && !late)
            {
                var counts = R.teams.ToDictionary(t => t.id, t => 0);
                foreach (var p in active) if (p.teamId.HasValue && !p.lateJoin && counts.ContainsKey(p.teamId.Value)) counts[p.teamId.Value]++;
                if (R.config.maxTeamSize.HasValue && counts.All(kv => kv.Value >= R.config.maxTeamSize.Value))
                {
                    int nextId = R.teams.Max(t => t.id) + 1;
                    R.teams.Add(U.TeamStyle(R.teams.Count, nextId));
                    counts[nextId] = 0;
                }
                teamId = counts.OrderBy(kv => kv.Value).ThenBy(kv => kv.Key).First().Key;
            }
            int order = ++joinCounter;
            var np = new Participant { id = order, nickname = nick, avatar = av, teamId = teamId, joinOrder = order, lateJoin = late, tokenHash = U.Sha256Hex(token), joinedAt = U.Now(), lastSeen = U.Now() };
            Participants[np.id] = np;
            Tokens[np.tokenHash] = np.id;
            if (late) Audit("participant.lateJoin", new Dictionary<string, object> { { "id", np.id }, { "nickname", nick } });
            Changed(true);
            return np;
        }
        public Participant FindByToken(string token)
        {
            if (string.IsNullOrEmpty(token)) return null;
            int pid; Participant p;
            if (Tokens.TryGetValue(U.Sha256Hex(token), out pid) && Participants.TryGetValue(pid, out p) && !p.removed) return p;
            return null;
        }
        public object ParticipantView(Participant p)
        {
            return new Dictionary<string, object> { { "participantId", p.id }, { "nickname", p.nickname }, { "avatar", p.avatar }, { "team", R.teams.FirstOrDefault(t => p.teamId.HasValue && t.id == p.teamId.Value) }, { "lateJoin", p.lateJoin } };
        }

        // ---------- 作答 ----------
        public Dictionary<string, object> Submit(int pid, string questionId, string option, long now)
        {
            Func<bool, string, string, string, Dictionary<string, object>> res = (ok, code, msg, opt) =>
                new Dictionary<string, object> { { "ok", ok }, { "code", code }, { "message", msg }, { "option", opt }, { "questionId", questionId }, { "serverTime", U.Now() }, { "version", Version } };
            Participant p;
            if (!Participants.TryGetValue(pid, out p) || p.removed) return res(false, "not_participant", "找不到參賽者身分", null);
            var item = S.cursor >= 0 && S.cursor < R.plan.Count ? R.plan[S.cursor] : null;
            if (Phase != "QUESTION_OPEN" || item == null || S.paused) return res(false, "closed", S.paused ? "目前暫停中，暫不接受作答" : "本題已截止，答案未被接受", null);
            if (item.questionId != questionId) return res(false, "wrong_question", "題目已更換，答案未被接受", null);
            if (!new[] { "A", "B", "C", "D" }.Contains(option)) return res(false, "invalid_option", "選項無效", null);
            if (EndsAt.HasValue && now > EndsAt.Value) return res(false, "late", "已超過作答時間，答案未被接受", null);
            int attempt = Attempt(questionId);
            var key = Key(pid, questionId, attempt);
            Answer ex;
            if (Answers.TryGetValue(key, out ex)) return res(true, "duplicate", "已作答（重送不重複計分）", ex.option);
            var ans = new Answer { participantId = pid, questionId = questionId, attempt = attempt, option = option, correct = option == item.correct, elapsedMs = Math.Max(0, now - OpenedAt + S.elapsedBeforePause), acceptedAt = now };
            ans.points = IsWarmup(questionId) ? 0 : Scoring.AnswerPoints(ans.correct, ans.elapsedMs, SecondsFor(S.cursor));
            Answers[key] = ans;
            Changed(false);
            int eligible = Participants.Values.Count(x => !x.removed);
            if (eligible > 0 && CurrentAnswers().Count >= eligible) CloseQuestion(now);
            return res(true, "accepted", "已作答", option);
        }
        public List<Answer> CurrentAnswers()
        {
            if (S.cursor < 0 || S.cursor >= R.plan.Count) return new List<Answer>();
            var qid = R.plan[S.cursor].questionId; int att = Attempt(qid);
            return Answers.Values.Where(a => a.questionId == qid && a.attempt == att).ToList();
        }
        public bool IsWarmup(string id) { return id.StartsWith("WARMUP-") || R.plan.Any(q => q.questionId == id && q.warmup); }
        public HashSet<string> ScoredSet() { return new HashSet<string>(S.closed.Where(q => !S.voided.Contains(q) && !IsWarmup(q))); }
        public List<Answer> ScoredAnswers()
        {
            var sc = ScoredSet();
            return Answers.Values.Where(a => sc.Contains(a.questionId) && a.attempt == Attempt(a.questionId)).ToList();
        }

        // ---------- 流程 ----------
        public void AssignTeams(int? teamCount)
        {
            if (S.rosterLocked) throw new GameError("開賽後不可重新分組");
            var ps = Participants.Values.Where(p => !p.removed).ToList();
            if (teamCount.HasValue && (teamCount.Value < 1 || teamCount.Value > 24)) throw new GameError("隊伍數請選擇 1～24 隊");
            int n = teamCount.HasValue ? teamCount.Value : Math.Max(1, Math.Min(Scoring.AutoTeamCount(ps.Count), Math.Min(Math.Max(1, ps.Count), 24)));
            R.config.maxTeamSize = null;
            Regroup(ps, n);
        }
        public void SetTeamSize(int size)
        {
            if (S.rosterLocked) throw new GameError("開賽後不可重新分組");
            if (size < 1 || size > 100) throw new GameError("每組人數上限請輸入 1～100 的整數");
            R.config.maxTeamSize = size;
            var ps = Participants.Values.Where(p => !p.removed).ToList();
            Regroup(ps, Math.Max(1, (ps.Count + size - 1) / size));
        }
        void Regroup(List<Participant> ps, int n)
        {
            foreach (var p in Participants.Values) p.teamId = null;
            R.teams = Enumerable.Range(0, n).Select(i => U.TeamStyle(i, i + 1)).ToList();
            var shuffled = U.Shuffle(ps);
            for (int i = 0; i < shuffled.Count; i++) shuffled[i].teamId = R.teams[i % n].id;
            Audit("teams.assigned", new Dictionary<string, object> { { "teamCount", n }, { "participants", ps.Count } });
            Changed(true);
        }

        public void Start(long now)
        {
            if (Phase != "LOBBY") throw new GameError("場次已開始");
            if (R.plan.Count < Total) throw new GameError("題目不足：需要 " + Total + " 題，只有 " + R.plan.Count + " 題");
            if (!Participants.Values.Any(p => !p.removed)) throw new GameError("尚無參賽者");
            if (R.teams.Count == 0) AssignTeams(null);
            S.rosterLocked = true;
            R.startedAt = now;
            OpenQuestion(0, now);
        }
        void OpenQuestion(int i, long at)
        {
            S.cursor = i; S.phase = "QUESTION_OPEN"; S.explaining = false; S.paused = false; S.showLeaderboard = false;
            Adhoc = null; S.showDetails = false; S.explanationEndsAt = null; S.elapsedBeforePause = 0; OpenedAt = at;
            Schedule(at + SecondsFor(i) * 1000L, "close");
            Changed(true);
        }
        void CloseQuestion(long at)
        {
            if (Phase != "QUESTION_OPEN") return;
            var qid = R.plan[S.cursor].questionId;
            if (!S.closed.Contains(qid)) S.closed.Add(qid);
            S.phase = "REVEAL"; S.paused = false;
            S.explanationEndsAt = R.config.manualAdvance ? (long?)(at + R.config.explanationSeconds * 1000L) : null;
            if (R.config.manualAdvance || S.flags.autoPauseAfterReveal) { ClearTimer(); S.explaining = true; }
            else Schedule(at + R.config.revealSeconds * 1000L, "afterReveal");
            Changed(true);
        }
        void AfterReveal(long at)
        {
            S.explaining = false; Adhoc = null; ClearTimer();
            bool last = S.cursor >= Total - 1;
            bool roundEnd = RoundInfo(S.cursor)[3] == 1;
            if (last) { Finish(at); return; }
            if (R.config.manualAdvance) { OpenQuestion(S.cursor + 1, at); return; }
            if (roundEnd) { S.phase = "ROUND_END"; Changed(true); return; }
            int q = S.cursor + 1;
            bool lbDue = R.config.leaderboardEvery > 0 && q % R.config.leaderboardEvery == 0;
            if (lbDue) { S.phase = "LEADERBOARD"; Schedule(at + (R.config.transitionSeconds + R.config.leaderboardExtraSeconds) * 1000L, "open"); }
            else { S.phase = "TRANSITION"; Schedule(at + R.config.transitionSeconds * 1000L, "open"); }
            Changed(true);
        }
        void Finish(long at)
        {
            ClearTimer(); S.phase = "FINISHED"; S.paused = false; S.explaining = false; R.endedAt = at;
            Changed(true); Flush();
        }

        static int? NInt(Dictionary<string, object> d, string k) { var v = Obj.Num(d, k); return v.HasValue ? (int?)(int)v.Value : null; }

        /// <summary>老師指令</summary>
        public void Command(Dictionary<string, object> cmd, long now)
        {
            var type = Obj.Str(cmd, "type");
            Action<string, object> a = (t, d) => Audit("host." + t, d);
            var p = Phase;
            switch (type)
            {
                case "assignTeams": AssignTeams(NInt(cmd, "teamCount")); return;
                case "setTeamSize":
                    if (!Obj.IsInteger(Obj.Get(cmd, "maxTeamSize"))) throw new GameError("每組人數上限請輸入整數");
                    SetTeamSize(NInt(cmd, "maxTeamSize") ?? 0); return;
                case "moveParticipant":
                    {
                        if (S.rosterLocked) throw new GameError("開賽後不可換隊");
                        Participant pp; var tid = NInt(cmd, "teamId");
                        if (!Participants.TryGetValue(NInt(cmd, "participantId") ?? -1, out pp) || !R.teams.Any(t => t.id == tid)) throw new GameError("參賽者或隊伍不存在");
                        if (R.config.maxTeamSize.HasValue && Participants.Values.Count(x => !x.removed && x.id != pp.id && x.teamId == tid) >= R.config.maxTeamSize.Value) throw new GameError("此隊已達人數上限");
                        pp.teamId = tid; Changed(true); return;
                    }
                case "removeParticipant":
                    {
                        Participant pp;
                        if (!Participants.TryGetValue(NInt(cmd, "participantId") ?? -1, out pp)) throw new GameError("參賽者不存在");
                        pp.removed = true; Audit("participant.removed", new Dictionary<string, object> { { "id", pp.id }, { "nickname", pp.nickname } });
                        Changed(true); return;
                    }
                case "start": a("start", null); Start(now); return;
                case "pause":
                    {
                        if (S.paused || !(p == "QUESTION_OPEN" || p == "REVEAL" || p == "TRANSITION" || p == "LEADERBOARD")) return;
                        if (p == "REVEAL" && S.explaining) return;
                        S.remainingMs = EndsAt.HasValue ? Math.Max(0, EndsAt.Value - now) : 0;
                        if (p == "QUESTION_OPEN") S.elapsedBeforePause += now - OpenedAt;
                        EndsAt = null; S.paused = true;
                        a("pause", new Dictionary<string, object> { { "phase", p }, { "cursor", S.cursor } });
                        Changed(true); return;
                    }
                case "resume":
                    {
                        if (!S.paused) return;
                        S.paused = false;
                        long ms = S.remainingMs ?? 0; S.remainingMs = null;
                        a("resume", new Dictionary<string, object> { { "phase", p } });
                        if (p == "QUESTION_OPEN") { OpenedAt = now; Schedule(now + Math.Max(ms, 3000), "close"); }
                        else if (p == "REVEAL") Schedule(now + ms, "afterReveal");
                        else Schedule(now + ms, "open");
                        if (S.pending == null) { }
                        Changed(true); return;
                    }
                case "next":
                    if (S.paused) { Command(new Dictionary<string, object> { { "type", "resume" } }, now); return; }
                    if (p == "QUESTION_OPEN") { CloseQuestion(now); return; }
                    if (p == "REVEAL") { AfterReveal(now); return; }
                    if (p == "TRANSITION" || p == "LEADERBOARD" || p == "ROUND_END") { ClearTimer(); OpenQuestion(S.cursor + 1, now); return; }
                    if (p == "LOBBY") { Command(new Dictionary<string, object> { { "type", "start" } }, now); return; }
                    if (p == "FINISHED") { Command(new Dictionary<string, object> { { "type", "awards" } }, now); return; }
                    return;
                case "revealNow": if (p == "QUESTION_OPEN" && !S.paused) { a("revealNow", null); CloseQuestion(now); } return;
                case "skip":
                    {
                        if (p != "QUESTION_OPEN") throw new GameError("只有作答中的題目可以跳過");
                        var qid = R.plan[S.cursor].questionId;
                        if (!S.voided.Contains(qid)) S.voided.Add(qid);
                        a("skip", new Dictionary<string, object> { { "questionId", qid } });
                        S.paused = false; CloseQuestion(now); AfterReveal(now); return;
                    }
                case "showDetails":
                    if (p != "REVEAL") throw new GameError("公布答案後才能顯示詳解");
                    S.showDetails = Obj.Bool(cmd, "visible");
                    if (S.showDetails) S.showLeaderboard = false;
                    Changed(true); return;
                case "explain":
                    if (p != "REVEAL") throw new GameError("揭曉答案後才能暫停講解");
                    ClearTimer(); S.paused = false; S.explaining = true;
                    a("explain", new Dictionary<string, object> { { "cursor", S.cursor } });
                    Changed(true); return;
                case "extend":
                    {
                        if (p != "QUESTION_OPEN" || S.paused || !EndsAt.HasValue) throw new GameError("只有作答中的題目可以延長");
                        long add = Obj.Num(cmd, "seconds") == 10 ? 10000 : 5000;
                        EndsAt = EndsAt.Value + add;
                        a("extend", new Dictionary<string, object> { { "seconds", add / 1000 }, { "questionId", R.plan[S.cursor].questionId } });
                        Changed(true); return;
                    }
                case "reopen":
                    {
                        if (!(p == "REVEAL" || p == "TRANSITION" || p == "LEADERBOARD" || p == "ROUND_END")) throw new GameError("目前無法重開本題");
                        var qid = R.plan[S.cursor].questionId;
                        S.attempts[qid] = Attempt(qid) + 1; S.closed.Remove(qid); S.voided.Remove(qid);
                        a("reopen", new Dictionary<string, object> { { "questionId", qid }, { "attempt", S.attempts[qid] } });
                        OpenQuestion(S.cursor, now); return;
                    }
                case "void":
                    {
                        var qid = Obj.Str(cmd, "questionId");
                        if (!R.plan.Any(x => x.questionId == qid)) throw new GameError("題目不在本場次");
                        bool v = Obj.Bool(cmd, "voided");
                        if (v) { if (!S.voided.Contains(qid)) S.voided.Add(qid); } else S.voided.Remove(qid);
                        a(v ? "void" : "unvoid", new Dictionary<string, object> { { "questionId", qid } });
                        Changed(true); return;
                    }
                case "showLeaderboard":
                    if (p == "QUESTION_OPEN") throw new GameError("作答中無法顯示排行榜");
                    S.showLeaderboard = !S.showLeaderboard; Changed(true); return;
                case "finish":
                    if (p == "QUESTION_OPEN") CloseQuestion(now);
                    a("finish", new Dictionary<string, object> { { "cursor", S.cursor } });
                    Finish(now); return;
                case "awards":
                    if (p != "FINISHED") throw new GameError("請先結束比賽");
                    S.phase = "AWARDS"; Changed(true); return;
                case "abort":
                    ClearTimer(); S.phase = "ABORTED"; R.endedAt = now;
                    a("abort", new Dictionary<string, object> { { "cursor", S.cursor } });
                    Changed(true); Flush(); return;
                case "setOptions":
                    foreach (var k in new[] { "allowLateJoin", "hideNames", "soundEnabled", "showExplanationText", "autoPauseAfterReveal" })
                    {
                        if (!(Obj.Get(cmd, k) is bool)) continue;
                        bool b = (bool)Obj.Get(cmd, k);
                        if (k == "allowLateJoin") S.flags.allowLateJoin = b;
                        else if (k == "hideNames") S.flags.hideNames = b;
                        else if (k == "soundEnabled") S.flags.soundEnabled = b;
                        else if (k == "showExplanationText") S.flags.showExplanationText = b;
                        else S.flags.autoPauseAfterReveal = R.config.manualAdvance || b;
                    }
                    Changed(true); return;
                case "adhoc":
                    {
                        var kind = Obj.Str(cmd, "kind"); var val = Obj.Str(cmd, "value");
                        if (kind == "clear") Adhoc = null;
                        else if (kind == "url")
                        {
                            if (!Regex.IsMatch(val, "^https://\\S+$", RegexOptions.IgnoreCase)) throw new GameError("網址需為 https://");
                            Adhoc = new Dictionary<string, string> { { "kind", "url" }, { "value", val } };
                        }
                        else
                        {
                            if (!Regex.IsMatch(val, "^[^\\\\/]+\\.(png|jpe?g|webp|gif)$", RegexOptions.IgnoreCase) || !System.IO.File.Exists(Path.Combine(ImagesDir, val))) throw new GameError("圖片不存在");
                            Adhoc = new Dictionary<string, string> { { "kind", "image" }, { "value", val } };
                        }
                        Changed(true); return;
                    }
                case "setQuestionSeconds":
                    {
                        var qid = Obj.Str(cmd, "questionId");
                        int idx = R.plan.FindIndex(x => x.questionId == qid);
                        if (idx < 0) throw new GameError("題目不在本場次");
                        if (idx <= S.cursor) throw new GameError("只能修改尚未開放的題目");
                        var sec = Obj.Get(cmd, "seconds");
                        int? secs = null;
                        if (sec != null)
                        {
                            if (!Obj.IsInteger(sec) || Convert.ToInt64(sec) < R.config.minSeconds || Convert.ToInt64(sec) > R.config.maxSeconds) throw new GameError("秒數須為 " + R.config.minSeconds + "–" + R.config.maxSeconds);
                            secs = Convert.ToInt32(sec);
                        }
                        R.plan[idx].seconds = secs;
                        a("setQuestionSeconds", new Dictionary<string, object> { { "questionId", qid }, { "seconds", secs } });
                        Changed(true); return;
                    }
                default: throw new GameError("未知的指令");
            }
        }

        // ---------- 狀態輸出 ----------
        public class Boards { public List<Dictionary<string, object>> individuals; public List<Dictionary<string, object>> teams; public List<IndRow> all; public List<TeamRow> teamAll; }
        List<IndRow> cAll; List<TeamRow> cTeamAll; List<Dictionary<string, object>> cTeams; int boardSeq = -1;

        public Boards Leaderboards(int limit)
        {
            if (boardSeq != Sequence || cAll == null)
            {
                var ps = Participants.Values.ToList();
                var ans = ScoredAnswers(); var set = ScoredSet();
                cAll = Scoring.RankIndividuals(ps, ans, set);
                cTeamAll = Scoring.RankTeams(R.teams.Select(t => t.id), ps, ans, set);
                cTeams = cTeamAll.Select(t =>
                {
                    var ti = R.teams.First(x => x.id == t.teamId);
                    return new Dictionary<string, object> { { "teamId", t.teamId }, { "name", ti.name }, { "color", ti.color }, { "icon", ti.icon }, { "members", t.members }, { "correct", t.correct }, { "scoredQuestions", t.scoredQuestions }, { "accuracy", t.accuracy }, { "avgTimeMs", t.avgTimeMs }, { "rank", t.rank } };
                }).ToList();
                boardSeq = Sequence;
            }
            var inds = cAll.Take(limit).Select(r =>
            {
                var p = Participants[r.participantId];
                return new Dictionary<string, object> { { "participantId", p.id }, { "nickname", S.flags.hideNames ? "參賽者 " + p.joinOrder : p.nickname }, { "avatar", p.avatar },
                    { "teamId", p.teamId }, { "correct", r.correct }, { "points", r.points }, { "timeMs", r.timeMs }, { "rank", r.rank }, { "lateJoin", p.lateJoin } };
            }).ToList();
            return new Boards { individuals = inds, teams = cTeams, all = cAll, teamAll = cTeamAll };
        }

        public Dictionary<string, object> PublicState(string role, long now)
        {
            var item = S.cursor >= 0 && S.cursor < R.plan.Count ? R.plan[S.cursor] : null;
            bool hideQ = S.paused && Phase == "QUESTION_OPEN";
            object question = null;
            if (item != null && (Phase == "QUESTION_OPEN" || Phase == "REVEAL") && !hideQ)
            {
                var ri = RoundInfo(S.cursor);
                question = new Dictionary<string, object> { { "index", S.cursor + 1 }, { "total", Total }, { "roundNo", ri[0] }, { "roundIndex", ri[1] }, { "roundTotal", ri[2] },
                    { "questionId", item.questionId }, { "warmup", IsWarmup(item.questionId) }, { "stem", item.stem }, { "options", item.options }, { "topic", item.topic } };
            }
            object reveal = null;
            if (item != null && Phase == "REVEAL")
            {
                var dist = new Dictionary<string, int> { { "A", 0 }, { "B", 0 }, { "C", 0 }, { "D", 0 } };
                var cur = CurrentAnswers();
                foreach (var x in cur) if (dist.ContainsKey(x.option)) dist[x.option]++;
                var ex = item.explanation ?? new Explanation();
                Question bankQuestion;
                if (Store.Bank.ById.TryGetValue(item.questionId, out bankQuestion) && bankQuestion.stem == item.stem && bankQuestion.correct_option == item.correct)
                    ex = Bank.ToExplanation(bankQuestion);
                var exOut = S.flags.showExplanationText || role == "host" ? ex : new Explanation { verified = ex.verified, text = "", lawReference = ex.lawReference, lawExcerpt = ex.lawExcerpt, lawUrl = ex.lawUrl, referenceUrls = ex.referenceUrls, images = ex.images };
                reveal = new Dictionary<string, object> { { "correct", item.correct }, { "distribution", dist }, { "answeredCount", cur.Count }, { "voided", S.voided.Contains(item.questionId) }, { "explanation", exOut } };
            }
            bool needBoards = Phase == "LEADERBOARD" || Phase == "ROUND_END" || Phase == "FINISHED" || Phase == "AWARDS" || S.showLeaderboard || Phase == "REVEAL" || role == "host";
            var boards = needBoards ? Leaderboards(role == "host" ? 50 : 10) : null;
            var active = Participants.Values.Where(x => !x.removed).OrderBy(x => x.joinOrder).ToList();
            object questionBoard = null;
            if (item != null && Phase == "REVEAL")
            {
                var scored = new HashSet<string>();
                if (!IsWarmup(item.questionId) && !S.voided.Contains(item.questionId)) scored.Add(item.questionId);
                questionBoard = Scoring.RankIndividuals(active, CurrentAnswers(), scored).Select(r => {
                    var pp = Participants[r.participantId];
                    return new Dictionary<string, object> { { "participantId", pp.id }, { "nickname", S.flags.hideNames ? "參賽者 " + pp.joinOrder : pp.nickname }, { "avatar", pp.avatar }, { "teamId", pp.teamId },
                        { "correct", r.correct }, { "points", r.points }, { "timeMs", r.timeMs }, { "rank", r.rank }, { "lateJoin", pp.lateJoin } };
                }).ToList();
            }
            object roster = null;
            if (Phase == "LOBBY" && role != "player")
                roster = active.Skip(Math.Max(0, active.Count - 120)).Select(x => new Dictionary<string, object> { { "id", x.id }, { "nickname", S.flags.hideNames ? "參賽者 " + x.joinOrder : x.nickname }, { "avatar", x.avatar }, { "teamId", x.teamId } }).ToList();
            object champs = null;
            if ((Phase == "FINISHED" || Phase == "AWARDS") && boards != null)
            {
                var champ = boards.teamAll.FirstOrDefault(t => t.rank == 1);
                champs = champ == null ? new List<object>() : active.Where(x => x.teamId == champ.teamId && !x.lateJoin).Select(x => (object)new Dictionary<string, object> { { "nickname", S.flags.hideNames ? "參賽者 " + x.joinOrder : x.nickname }, { "avatar", x.avatar } }).ToList();
            }
            object adhoc = role == "player" ? null : Adhoc;
            return new Dictionary<string, object> {
                { "manualAdvance", R.config.manualAdvance }, { "explanationSeconds", R.config.explanationSeconds }, { "explanationEndsAt", Phase == "REVEAL" ? S.explanationEndsAt : null }, { "warmupCount", R.config.warmupCount }, { "showDetails", S.showDetails },
                { "sessionId", R.id }, { "code", R.code }, { "courseNo", R.courseNo }, { "courseTitle", R.courseTitle },
                { "phase", Phase }, { "paused", S.paused }, { "explaining", S.explaining }, { "version", Version }, { "sequence", Sequence },
                { "serverTime", now }, { "endsAt", S.paused ? null : EndsAt }, { "remainingMs", S.paused ? S.remainingMs : null },
                { "question", question }, { "reveal", reveal },
                { "answeredCount", Phase == "QUESTION_OPEN" || Phase == "REVEAL" ? CurrentAnswers().Count : 0 },
                { "participantCount", active.Count }, { "maxParticipants", Store.MaxParticipants }, { "teams", R.teams }, { "maxTeamSize", R.config.maxTeamSize },
                { "questionBoard", questionBoard }, { "leaderboard", boards == null ? null : boards.individuals }, { "teamBoard", boards == null ? null : boards.teams },
                { "showLeaderboard", S.showLeaderboard }, { "rosterLocked", S.rosterLocked }, { "allowLateJoin", S.flags.allowLateJoin },
                { "hideNames", S.flags.hideNames }, { "soundEnabled", S.flags.soundEnabled }, { "showExplanationText", S.flags.showExplanationText },
                { "adhoc", adhoc }, { "autoPauseAfterReveal", S.flags.autoPauseAfterReveal }, { "roster", roster }, { "championMembers", champs } };
        }

        public Dictionary<string, object> MyStatus(int pid)
        {
            var item = S.cursor >= 0 && S.cursor < R.plan.Count ? R.plan[S.cursor] : null;
            string mine = null;
            if (item != null) { Answer x; if (Answers.TryGetValue(Key(pid, item.questionId, Attempt(item.questionId)), out x)) mine = x.option; }
            var b = Leaderboards(0);
            var me = b.all.FirstOrDefault(r => r.participantId == pid);
            Participant p; Participants.TryGetValue(pid, out p);
            var tr = p != null && p.teamId.HasValue ? b.teamAll.FirstOrDefault(t => t.teamId == p.teamId.Value) : null;
            var currentPoints = 0; int? questionRank = null;
            if (item != null && Phase == "REVEAL") {
                var scored = new HashSet<string>();
                if (!IsWarmup(item.questionId) && !S.voided.Contains(item.questionId)) scored.Add(item.questionId);
                var row = Scoring.RankIndividuals(Participants.Values, CurrentAnswers(), scored).FirstOrDefault(x => x.participantId == pid);
                if (row != null) { currentPoints = row.points; questionRank = row.rank; }
            }
            return new Dictionary<string, object> { { "points", me == null ? 0 : me.points }, { "questionPoints", currentPoints }, { "questionRank", questionRank }, { "myAnswer", mine }, { "teamId", p == null ? null : p.teamId }, { "correct", me == null ? 0 : me.correct }, { "rank", me == null ? (int?)null : me.rank }, { "teamRank", tr == null ? (int?)null : tr.rank } };
        }

        public Dictionary<string, object> Monitor(long now)
        {
            var answered = new HashSet<int>(CurrentAnswers().Select(x => x.participantId));
            var ps = Participants.Values.Where(x => !x.removed).OrderBy(x => x.joinOrder).ToList();
            Func<Participant, bool> online = x => now - x.lastSeen < 6000;
            var item = S.cursor >= 0 && S.cursor < R.plan.Count ? R.plan[S.cursor] : null;
            return new Dictionary<string, object> {
                { "participants", ps.Select(x => new Dictionary<string, object> { { "id", x.id }, { "nickname", x.nickname }, { "avatar", x.avatar }, { "teamId", x.teamId }, { "lateJoin", x.lateJoin }, { "connected", online(x) }, { "answered", answered.Contains(x.id) } }).ToList() },
                { "connected", ps.Count(online) }, { "disconnected", ps.Count(x => !online(x)) },
                { "currentCorrect", item == null ? null : item.correct }, { "currentQuestionId", item == null ? null : item.questionId },
                { "cursor", S.cursor }, { "voided", S.voided },
                { "plan", R.plan.Select((x, i) => new Dictionary<string, object> { { "index", i + 1 }, { "questionId", x.questionId }, { "warmup", IsWarmup(x.questionId) }, { "roundNo", x.roundNo }, { "seconds", SecondsFor(i) }, { "customSeconds", x.seconds }, { "stem", x.stem.Length > 60 ? x.stem.Substring(0, 60) : x.stem }, { "closed", S.closed.Contains(x.questionId) } }).ToList() },
                { "config", R.config }, { "stageToken", R.stageToken }, { "startedAt", R.startedAt } };
        }
    }
}

// Models.cs
// 無人機知識王 ASP.NET 版：資料模型（C# 5，供 IIS App_Code 執行時編譯）
namespace Uqa
{
    public class Question
    {
        public string question_id = "";
        public int? course_no;
        public string topic = "";
        public int? round_no;
        public string stem = "";
        public string option_a = "", option_b = "", option_c = "", option_d = "";
        public string correct_option = "";
        public string answer_explanation = "", law_reference = "", law_excerpt = "", law_url = "", reference_urls = "", explanation_images = "";
        public bool explanation_verified;
        public string source_name = "", source_url = "", source_version = "", source_question_no = "";
        public int? time_limit_seconds;
        public bool active = true;
    }

    public class CustomGroup { public string name = ""; public string description = ""; public List<string> questionIds = new List<string>(); }

    public class GroupInfo { public string id; public string name; public string description; public bool auto; public int count; public int active; }

    public class Timing
    {
        public int answerSeconds = 20, revealSeconds = 5, transitionSeconds = 5, leaderboardExtraSeconds = 0, leaderboardEvery = 10, classMinutes = 50, minQuestionSeconds = 5, maxQuestionSeconds = 120;
    }

    public class CourseSettings { public int courseNo; public string title = ""; public List<int> rounds = new List<int>(); public int explainReserveMinutes; }

    public class AppSettings { public Timing timing = new Timing(); public List<CourseSettings> courses = new List<CourseSettings>(); }

    public class ConfigFile
    {
        public string hostPassword = "";
        public string githubRepository = "https://github.com/unron0830/uavquiz";
        public string sessionSecret = "";
        /// <summary>選填：對外網址，例如 http://192.168.1.23/quiz （QR Code 會用這個）</summary>
        public string publicBaseUrl = "";
        public int retentionDays = 365;
        public Timing timing = new Timing();
        public List<CourseSettings> courses = new List<CourseSettings>();
    }

    public class Explanation
    {
        public bool verified;
        public string text = "", lawReference = "", lawExcerpt = "", lawUrl = "";
        public List<string> referenceUrls = new List<string>();
        public List<string> images = new List<string>();
    }

    public class PlanItem
    {
        public bool warmup;
        public string questionId;
        public int roundNo;
        public int? seconds;
        public string stem;
        public Dictionary<string, string> options;
        public string correct;
        public string topic;
        public Explanation explanation;
    }

    public class SessionConfig
    {
        public int? maxTeamSize;
        public bool manualAdvance;
        public int explanationSeconds = 10;
        public int warmupCount;
        public int answerSeconds, revealSeconds, transitionSeconds, leaderboardExtraSeconds, leaderboardEvery, minSeconds, maxSeconds;
        public List<int> rounds = new List<int>();
        public int classMinutes = 50;
    }

    public class TeamInfo { public int id; public string name; public string color; public string icon; }

    public class Participant
    {
        public int id;
        public string nickname;
        public string avatar;
        public int? teamId;
        public int joinOrder;
        public bool lateJoin;
        public bool removed;
        public string tokenHash;
        public long joinedAt;
        [ScriptIgnore] public long lastSeen;
    }

    public class Answer
    {
        public int? points;
        public int participantId;
        public string questionId;
        public int attempt;
        public string option;
        public bool correct;
        public long elapsedMs;
        public long acceptedAt;
    }

    public class Flags
    {
        public bool allowLateJoin = true;
        public bool hideNames, autoPauseAfterReveal;
        public bool soundEnabled = true, showExplanationText = true;
    }

    public class Snapshot
    {
        public bool showDetails;
        public long? explanationEndsAt;
        public string phase = "LOBBY";
        public int cursor = -1;
        public bool paused, explaining, rosterLocked, showLeaderboard;
        public long? remainingMs;
        public List<string> voided = new List<string>();
        public List<string> closed = new List<string>();
        public Dictionary<string, int> attempts = new Dictionary<string, int>();
        public Flags flags = new Flags();
        public long elapsedBeforePause;
        public string pending;
    }

    public class SessionEvent { public long at; public string type; public object detail; }

    public class SessionRecord
    {
        public string format = "uqa-session-v1";
        public string id, code;
        public int courseNo;
        public string courseTitle;
        public bool demo;
        public List<string> groupIds = new List<string>();
        public List<string> groupNames = new List<string>();
        public long createdAt;
        public long? startedAt, endedAt;
        public string status;
        public string stageToken;
        public SessionConfig config;
        public List<PlanItem> plan = new List<PlanItem>();
        public List<TeamInfo> teams = new List<TeamInfo>();
        public List<Participant> participants = new List<Participant>();
        public List<Answer> answers = new List<Answer>();
        public Snapshot state = new Snapshot();
        public List<SessionEvent> events = new List<SessionEvent>();
    }

    public class GameError : Exception { public GameError(string m) : base(m) { } }
}

// QuestionFeedback.cs
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

// Records.cs
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

// Scoring.cs
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

// Settings.cs
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

// Store.cs
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

// Util.cs
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
