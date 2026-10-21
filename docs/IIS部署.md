# IIS 部署說明

## 1. 啟用 Windows 功能

啟用 Internet Information Services（IIS）、管理主控台、靜態內容、預設文件，以及「應用程式開發功能」內的 ASP.NET 4.8、.NET Extensibility 4.8、ISAPI Extensions、ISAPI Filters。需有 .NET Framework 4.8。

## 2. 複製網站與建立 IIS 應用程式

將整份 `iis` 複製到自己的位置，例如 `D:\Sites\UavQuiz`。網站實體根目錄必須指向其中的 `quiz`，不要把整個原始碼專案設為網站根目錄。

建立專用應用程式集區，例如 `UavQuiz`，使用 .NET CLR v4.0、整合式管線、ApplicationPoolIdentity。建立站台或將 `quiz` 轉換成應用程式，指定該集區。建議一個部署站台一個專用集區，停用 Web Garden（最大工作處理序設為 1），避免多個處理序同時寫入 JSON。

## 3. 第一次進入後台：設定精靈

完成下方第 4 步的 IIS 權限設定後，第一次開啟 `#/host`，系統會自動顯示「歡迎！首次設定主持後台」。管理者在伺服器本機開啟網站的 `App_Data/setup-token.txt`，取得一次性設定碼，輸入設定精靈，再設定 12–128 字元密碼、確認密碼及選填對外網址。設定碼於首次 API 請求時自動產生，不會透過 API 提供，IIS 也會禁止外部下載。

完成後設定碼會刪除，設定介面不再接受修改。這能避免公開網站被其他人搶先設定。公網使用設定精靈時應先配置 HTTPS；勿將設定碼貼到 GitHub。

以下是**替代方式**：若管理者已先執行部署腳本，第一次網頁會直接顯示一般登入畫面。

### 替代方式：本機腳本設定密碼

在**伺服器本機**開啟 PowerShell，進入複製後的 `iis` 目錄：

```powershell
.\首次設定.ps1
```

輸入至少 12 字元的主持人密碼，輸入學生實際可連線的對外網址（含子目錄），例如 `https://quiz.example.org/quiz`。腳本會產生獨立的隨機 sessionSecret，寫入 `quiz/App_Data/config.json`，不會顯示密碼。

若電腦的執行原則阻擋腳本，先檢查腳本內容，依組織的執行原則處理；也可自行複製 `config.example.json` 為 `config.json`，設定 hostPassword（至少 12 字元）及 sessionSecret（至少 32 字元的獨立隨機值）。不要使用範例文字或重複其他站台金鑰。

`publicBaseUrl` 留空時依瀏覽器所在網址產生 QR Code；用 localhost 開啟後台時，手機掃碼也會得到 localhost，因此活動時請以學生可連線的網址操作，或正確設定 publicBaseUrl。

`githubRepository` 預設連到本專案，可由自行維護的分支管理者修改。不要把密碼、設定檔或學生紀錄提交到 GitHub；設定檔已列入 .gitignore，但 zip 發布前仍需檢查。

## 4. 設定資料夾權限

使用系統管理員 PowerShell（調整實際路徑與集區名稱）：

```powershell
.\設定資料夾權限.ps1 -SitePath 'D:\Sites\UavQuiz\quiz' -PoolName 'UavQuiz'
```

網站本身只給讀取／執行權限，App_Data 需要修改權限。圖片目錄提供讀取即可。請勿給 Everyone 完全控制。

設定完成後回收該應用程式集區，使新設定生效。網站第一次呼叫 api.ashx 時自動編譯 C#，可能需要稍候。

## 5. 網路與驗證

設定 IIS binding、DNS／IP、HTTPS 憑證與需要的 Windows 防火牆輸入規則。使用者連到的是自己的主機；不需要連作者主機，不使用 GitHub Pages 執行後端。

1. `#/host`：可用自己的密碼登入，選到四種題庫。
2. 建立測試場次、開啟投影；手機掃碼與手動輸入代碼都可加入。
3. 使用不同手機／瀏覽器測試作答、排名、講解、下一題與頒獎。
4. 回饋後重新整理，確認回饋可保留；點 GitHub 回報，確認只是草稿，未自動送出。
5. 確認外部不能下載 `/App_Data/config.json`（應被 IIS 阻擋）。

## 6. 備份、更新與回饋

備份整個 App_Data 與自己修改過的圖片。`records/` 是場次與學生資料，`avatars/` 是上傳頭像，`feedback/` 是逐筆 JSON 回饋，`questions.json` 是題庫。各站的資料留在各站，作者無法遠端收集。

更新時先備份並停止集區，更新 index.html、assets、api.ashx、web.config；保留 config.json、records、avatars、feedback。題庫與圖片僅在確定要更新時另外替換，避免覆蓋自己的校訂。再啟動集區並測試。

回饋可由後台匯出，也可執行 `匯出題目回饋.ps1`，只匯出回饋，不包含 config。將問題回報到 GitHub 時勿附上含姓名、學號、密碼、Cookie 或存取憑證的完整伺服器備份。

本專案不提供雲端代管。若需 100 人正式競賽，建議 Windows Server IIS；Windows 10／11 請先評估 IIS 同時請求限制與現場網路。
