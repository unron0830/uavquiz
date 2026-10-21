param([string]$SitePath = (Join-Path $PSScriptRoot 'quiz'))
$ErrorActionPreference = 'Stop'
$root = (Get-Item -LiteralPath $SitePath).FullName
$file = Join-Path $root 'App_Data/config.json'
if (Test-Path -LiteralPath $file) { throw 'config.json 已存在，請由管理者備份後自行修改，避免覆蓋現有設定。' }
$cfg = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'App_Data/config.example.json') | ConvertFrom-Json
$secure = Read-Host '請設定主持人密碼（至少 12 字元）' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ([string]::IsNullOrWhiteSpace($password) -or $password.Length -lt 12 -or $password.Length -gt 128) { throw '密碼須為 12–128 字元，且不可全部為空白。' }
$cfg.hostPassword = $password
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$cfg.sessionSecret = [Convert]::ToBase64String($bytes)
$url = Read-Host '此站對外網址（含子目錄，例如 https://quiz.example.org/quiz；可留空）'
if ($url -and $url -notmatch '^https?://') { throw '網址必須以 http:// 或 https:// 開頭。' }
$cfg.publicBaseUrl = $url.TrimEnd('/')
$cfg | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $file -Encoding UTF8
$password = $null; $cfg.hostPassword = $null
Write-Host '設定完成。請設定 IIS 權限並回收應用程式集區。不要將 config.json 上傳 GitHub。'
