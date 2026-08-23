param(
  [string]$BackupRoot = "C:\Private\AI Projects\Personal Health Companion\Backup",
  [int]$KeepDaily = 14
)

$ErrorActionPreference = "Stop"

function Get-CommandOrThrow([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue

  if ($null -eq $cmd -and $name -ieq "git") {
    $commonGitPaths = @(
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
    )

    foreach ($path in $commonGitPaths) {
      if (Test-Path -LiteralPath $path) {
        return [PSCustomObject]@{ Source = $path }
      }
    }
  }

  if ($null -eq $cmd) {
    throw "$name was not found in PATH."
  }
  return $cmd
}

function Ensure-Directory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

function Prune-OldEntries([string]$path, [int]$keep) {
  if (-not (Test-Path -LiteralPath $path)) {
    return
  }

  Get-ChildItem -Path $path |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $keep |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dateFolder = Get-Date -Format "yyyy-MM-dd"

$targetRoot = Join-Path $BackupRoot "daily\$dateFolder"
$codeDir = Join-Path $targetRoot "code"
$logsDir = Join-Path $targetRoot "logs"
$metaDir = Join-Path $targetRoot "meta"

Ensure-Directory $BackupRoot
Ensure-Directory $targetRoot
Ensure-Directory $codeDir
Ensure-Directory $logsDir
Ensure-Directory $metaDir

$gitCommand = Get-CommandOrThrow "git"

Push-Location $repoRoot
try {
  $bundlePath = Join-Path $codeDir ("diaticanit-all-{0}.bundle" -f $timestamp)
  & $gitCommand.Source bundle create $bundlePath --all

  $mirrorPath = Join-Path $BackupRoot "repo-mirror.git"
  if (Test-Path -LiteralPath $mirrorPath) {
    & $gitCommand.Source --git-dir $mirrorPath remote update --prune
  }
  else {
    & $gitCommand.Source clone --mirror $repoRoot $mirrorPath
  }

  $refsPath = Join-Path $metaDir ("git-show-ref-{0}.txt" -f $timestamp)
  $logPath = Join-Path $metaDir ("git-log-{0}.txt" -f $timestamp)
  & $gitCommand.Source show-ref | Out-File -FilePath $refsPath -Encoding utf8
  & $gitCommand.Source log --oneline --decorate -n 300 | Out-File -FilePath $logPath -Encoding utf8
}
finally {
  Pop-Location
}

$workspaceStorageRoot = Join-Path $env:APPDATA "Code\User\workspaceStorage"
if (Test-Path -LiteralPath $workspaceStorageRoot) {
  $copilotDirs = Get-ChildItem -Path $workspaceStorageRoot -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "GitHub.copilot-chat\transcripts")
  }

  foreach ($dir in $copilotDirs) {
    $sessionName = $dir.Name
    $copilotRoot = Join-Path $dir.FullName "GitHub.copilot-chat"

    $transcriptsPath = Join-Path $copilotRoot "transcripts"
    if (Test-Path -LiteralPath $transcriptsPath) {
      $transcriptsZip = Join-Path $logsDir ("copilot-transcripts-{0}-{1}.zip" -f $sessionName, $timestamp)
      Compress-Archive -Path (Join-Path $transcriptsPath "*") -DestinationPath $transcriptsZip -CompressionLevel Optimal
    }

    $debugLogsPath = Join-Path $copilotRoot "debug-logs"
    if (Test-Path -LiteralPath $debugLogsPath) {
      $debugLogsZip = Join-Path $logsDir ("copilot-debug-logs-{0}-{1}.zip" -f $sessionName, $timestamp)
      Compress-Archive -Path (Join-Path $debugLogsPath "*") -DestinationPath $debugLogsZip -CompressionLevel Optimal
    }
  }
}

$manifestPath = Join-Path $metaDir ("backup-manifest-{0}.txt" -f $timestamp)
@(
  "timestamp=$timestamp",
  "repoRoot=$repoRoot",
  "backupRoot=$BackupRoot",
  "targetRoot=$targetRoot",
  "bundleDir=$codeDir",
  "logsDir=$logsDir"
) | Out-File -FilePath $manifestPath -Encoding utf8

Prune-OldEntries -path (Join-Path $BackupRoot "daily") -keep $KeepDaily

Write-Host "Backup complete: $targetRoot"
