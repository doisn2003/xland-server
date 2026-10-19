$ErrorActionPreference = 'Stop'
$cServer = Split-Path $PSScriptRoot -Parent
if (Test-Path -LiteralPath (Join-Path $cServer '.local/p3-preview.lock')) { throw 'Stop the owned P3 instance before rebuilding its bundle; shared preview is untouched' }
$cContext = Get-Content -LiteralPath (Join-Path $cServer '.local/p3-context.json') -Raw | ConvertFrom-Json
$cSandbox = [IO.Path]::GetFullPath($cContext.sandbox)
$cExpected = [IO.Path]::GetFullPath((Join-Path $cServer '../xland-mobile/.local/p3')) + [IO.Path]::DirectorySeparatorChar
if (-not $cSandbox.StartsWith($cExpected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected build sandbox' }
$cFlutter = Join-Path $cContext.sdk 'bin/flutter.bat'
$env:FLUTTER_ROOT = $cContext.sdk
$cResults = @()
$cReportValue = ([bool]$cContext.reportMode).ToString().ToLowerInvariant()
$cReportDefine = "--dart-define=XLAND_REPORT_MODE=$cReportValue"
function Invoke-CFlutter([string]$Label, [string[]]$Arguments) {
    & $cFlutter @Arguments 2>&1 | Tee-Object -FilePath (Join-Path $cContext.evidence "$Label.log")
    $cCode = $LASTEXITCODE
    $script:cResults += @{ command = "flutter $($Arguments -join ' ')"; label = $Label; exit = $cCode }
    $script:cResults | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $cContext.evidence 'build-exits.json')
    if ($cCode -ne 0) { throw "$Label failed: exit $cCode (see evidence log)" }
}
Push-Location $cSandbox
try {
    Invoke-CFlutter 'sandbox-pub-get' @('pub','get','--offline')
    Invoke-CFlutter 'web-build' @('build','web','--debug','--no-pub','--no-web-resources-cdn','-t','lib/bootstrap/dev_main.dart',$cReportDefine,"--dart-define=XLAND_API_BASE_URL=http://127.0.0.1:$($cContext.apiPort)/api/v1", "--dart-define=XLAND_DEMO_MEDIA_BASE_URL=http://127.0.0.1:$($cContext.mediaPort)")
    Invoke-CFlutter 'android-feed-build' @('build','apk','--debug','--no-pub','--target-platform','android-x64','--android-project-arg=xlandNativeProof=true','-t','lib/bootstrap/native_feed_proof_main.dart',$cReportDefine,"--dart-define=XLAND_API_BASE_URL=http://10.0.2.2:$($cContext.apiPort)/api/v1", "--dart-define=XLAND_DEMO_MEDIA_BASE_URL=http://10.0.2.2:$($cContext.mediaPort)")
} finally { Pop-Location }
Push-Location $cServer
try { node scripts/p3-snapshot.mjs seal --feed-built; if ($LASTEXITCODE -ne 0) { throw 'Artifact seal failed' } } finally { Pop-Location }

if ($cContext.reportMode) {
    Push-Location $cSandbox
    try {
        Invoke-CFlutter 'android-report-build' @('build','apk','--debug','--no-pub','--target-platform','android-x64','--android-project-arg=xlandNativeProof=false','-t','lib/main.dart',$cReportDefine,"--dart-define=XLAND_API_BASE_URL=http://10.0.2.2:$($cContext.apiPort)/api/v1", "--dart-define=XLAND_DEMO_MEDIA_BASE_URL=http://10.0.2.2:$($cContext.mediaPort)")
        $cReportPath = [IO.Path]::GetFullPath((Join-Path $cSandbox '../artifacts/xland-phase3-report-debug-x64.apk'))
        Copy-Item -LiteralPath (Join-Path $cSandbox 'build/app/outputs/flutter-apk/app-debug.apk') -Destination $cReportPath
        @{path=$cReportPath;sha256=(Get-FileHash -LiteralPath $cReportPath -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $cReportPath).Length;sourceHash=$cContext.sourceHash;target='lib/main.dart';package='vn.xland.xland_mobile';platform='Android x64 emulator';reportMode=$true;requiresPrivateProofInput=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cContext.evidence 'android-report-artifact.json')
    } finally { Pop-Location }
}
