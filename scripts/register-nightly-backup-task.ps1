param(
  [string]$TaskName = "Diaticanit Nightly Backup",
  [string]$RunAt = "23:00"
)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupScript = Join-Path $PSScriptRoot "backup-to-gdrive.ps1"

if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Backup script not found at $backupScript"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $RunAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Nightly backup of code and Copilot logs to Google Drive synced folder." -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName at $RunAt"
Write-Host "Task action: $backupScript"
Write-Host "Repository root: $repoRoot"
