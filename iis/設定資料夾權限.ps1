param([Parameter(Mandatory=$true)][string]$SitePath, [Parameter(Mandatory=$true)][string]$PoolName)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '請以系統管理員 PowerShell 執行。' }
$siteRoot = (Get-Item -LiteralPath $SitePath).FullName
$dataRoot = Join-Path $siteRoot 'App_Data'
if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'api.ashx')) -or -not (Test-Path -LiteralPath $dataRoot)) { throw 'SitePath 必須指向本系統 quiz 網站根目錄。' }
$account = 'IIS AppPool\' + $PoolName
& icacls.exe $siteRoot /grant "${account}:(OI)(CI)RX"
if ($LASTEXITCODE -ne 0) { throw '網站讀取權限設定失敗，請確認集區名稱。' }
& icacls.exe $dataRoot /grant "${account}:(OI)(CI)M"
if ($LASTEXITCODE -ne 0) { throw 'App_Data 修改權限設定失敗。' }
Write-Host '已設定指定集區的網站讀取權限與 App_Data 修改權限。'
