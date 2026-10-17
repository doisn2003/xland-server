param([switch]$MobileOnly)
$ErrorActionPreference='Stop'
$server=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $server
$run=Get-Content -LiteralPath '.local/w3-run.json' -Raw|ConvertFrom-Json
$checks=Join-Path $run.evidence ('checks-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))
New-Item -ItemType Directory -Path $checks | Out-Null
$env:XLAND_EVIDENCE_DIR=$checks
$results=[System.Collections.Generic.List[object]]::new()
function Snapshot {
  $files=@(Get-ChildItem -LiteralPath (Join-Path $server 'scripts') -File)
  $files+=@(Get-ChildItem -LiteralPath (Join-Path $server '../xland-mobile/lib') -File -Recurse)
  $files+=@(Get-ChildItem -LiteralPath (Join-Path $server '../xland-mobile/test') -File -Recurse)
  $files+=@(Get-ChildItem -LiteralPath (Join-Path $server '../xland-mobile/tool') -File -Recurse)
  @($files|Sort-Object FullName|ForEach-Object{[pscustomobject]@{path=$_.FullName;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
}
$before=Snapshot
$before|ConvertTo-Json -Depth 5|Set-Content (Join-Path $checks 'source-before.json') -Encoding utf8
function Check([string]$name,[string]$exe,[string[]]$argv,[string]$cwd=$server){
 Set-Location -LiteralPath $cwd
 $started=[DateTime]::UtcNow.ToString('o')
 $ErrorActionPreference='Continue'
 & $exe @argv *> (Join-Path $checks ($name+'.log'))
 $code=$LASTEXITCODE
 $ErrorActionPreference='Stop'
 $results.Add([pscustomobject]@{name=$name;executable=$exe;arguments=$argv;workingDirectory=$cwd;startedUtc=$started;exitCode=$code})
 [IO.File]::WriteAllText((Join-Path $checks 'command-results.json'),($results|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
 Write-Output "$name exit=$code"
}
if(-not $MobileOnly){
Check 'lint' 'npm.cmd' @('run','lint')
Check 'typecheck' 'npm.cmd' @('run','typecheck')
Check 'runner-tests' 'node' @('--test','scripts/local-runner.test.mjs')
Check 'integration' 'node' @('scripts/test-postgres.mjs','integration')
Check 'contract' 'node' @('scripts/test-postgres.mjs','contract')
Check 'scenarios' 'node' @('scripts/test-postgres.mjs','scenarios')
Check 'narrow-runtime' 'node' @('--import','tsx','scripts/verify-narrow-runtime.ts')
Check 'demo-provider' 'node' @('scripts/verify-demo-provider.mjs')
}
$mobile=Join-Path $server '../xland-mobile'
$sdk='C:/Users/Admin/AppData/Local/XLandTools/flutter-3.47.5/bin'
Check 'dart-c-analyze' (Join-Path $sdk 'dart.bat') @('analyze','lib/domain','lib/data','lib/bootstrap','test/data','test/domain','test/bootstrap','tool') $mobile
Check 'flutter-c-tests' (Join-Path $sdk 'flutter.bat') @('test','--no-pub','--reporter','expanded','test/data','test/domain','test/bootstrap') $mobile
Set-Location -LiteralPath $server
$after=Snapshot
$after|ConvertTo-Json -Depth 5|Set-Content (Join-Path $checks 'source-after.json') -Encoding utf8
$changes=@(Compare-Object $before $after -Property path,sha256)
[pscustomobject]@{unchanged=($changes.Count -eq 0);changes=$changes}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $checks 'source-verification.json') -Encoding utf8
[IO.File]::WriteAllText((Join-Path $checks 'command-results.json'),($results|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$run|Add-Member -NotePropertyName latestChecks -NotePropertyValue $checks -Force
[IO.File]::WriteAllText((Join-Path $server '.local/w3-run.json'),($run|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
if(@($results|Where-Object exitCode -ne 0).Count){exit 1}
