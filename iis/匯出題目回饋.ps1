param([string]$SitePath = (Join-Path $PSScriptRoot 'quiz'), [string]$OutputDirectory = (Join-Path $PSScriptRoot '回饋匯出'))
$ErrorActionPreference = 'Stop'
$siteRoot = (Get-Item -LiteralPath $SitePath).FullName
if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'api.ashx'))) { throw 'SitePath 必須指向本系統 quiz 網站根目錄。' }
$feedbackRoot = Join-Path $siteRoot 'App_Data\feedback'
if (-not (Test-Path -LiteralPath $feedbackRoot)) { Write-Host '目前沒有回饋資料夾。'; return }
$files = @(Get-ChildItem -LiteralPath $feedbackRoot -Filter '*.json' -File | Where-Object { $_.BaseName -match '^[a-f0-9]{32}$' })
if ($files.Count -eq 0) { Write-Host '目前沒有題目回饋。'; return }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$archive = Join-Path $OutputDirectory ('題目回饋_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff') + '.zip')
Compress-Archive -LiteralPath @($files.FullName) -DestinationPath $archive -CompressionLevel Optimal
Write-Host ('已匯出 ' + $files.Count + ' 筆回饋：' + $archive)
