# Builds a signed release and the latest.json the updater reads.
#
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -BaseUrl https://github.com/<owner>/<repo>/releases/download/v0.1.1
#
# Before the first release: put the address of latest.json in src-tauri\tauri.conf.json
# (plugins.updater.endpoints), e.g.
#   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
# and raise "version" there for every release.
#
# The signing key lives outside the project, in %USERPROFILE%\.tauri\tessera.key
# (made with: npx tauri signer generate -w %USERPROFILE%\.tauri\tessera.key).
# Losing it means installed copies can no longer be updated; keep a copy somewhere safe.
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$Notes = ""
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$key = Join-Path $env:USERPROFILE '.tauri\tessera.key'
if (-not (Test-Path $key)) { throw "Signing key not found: $key" }

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
Push-Location $root
try {
  npx tauri build --config '{"bundle":{"createUpdaterArtifacts":true}}'
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
} finally {
  Pop-Location
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$conf = Get-Content (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = $conf.version
$nsis = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$setup = Get-ChildItem $nsis -Filter "Tessera_${version}_x64-setup.exe" | Select-Object -First 1
$sig = Get-Content "$($setup.FullName).sig" -Raw

$latest = [ordered]@{
  version  = $version
  notes    = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{ signature = $sig.Trim(); url = "$($BaseUrl.TrimEnd('/'))/$($setup.Name)" }
  }
}
$out = Join-Path $nsis 'latest.json'
$latest | ConvertTo-Json -Depth 5 | Set-Content -Path $out -Encoding utf8
Write-Host "Upload these two files to the release:"
Write-Host "  $($setup.FullName)"
Write-Host "  $out"
