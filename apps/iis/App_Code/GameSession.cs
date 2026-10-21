using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

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
