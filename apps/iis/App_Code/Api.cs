using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web;

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
