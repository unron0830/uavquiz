using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
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
