param(
  [string]$BenchmarkId = "",
  [string]$AudioDir = "",
  [int]$MaxFiles = 10
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir
$pythonExe = Join-Path (Split-Path -Parent $backendDir) ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
  Write-Error "Python executable not found at $pythonExe"
  exit 1
}

Set-Location $backendDir

$cmd = @("scripts/benchmark_replay.py")
if ($BenchmarkId -ne "") { $cmd += @("--benchmark-id", $BenchmarkId) }
if ($AudioDir -ne "") { $cmd += @("--audio-dir", $AudioDir) }
if ($MaxFiles -gt 0) { $cmd += @("--max-files", "$MaxFiles") }

& $pythonExe $cmd
