// 無人機知識王 ASP.NET 版：資料模型（C# 5，供 IIS App_Code 執行時編譯）
using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

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
