param(
  [string]$TaskName = "Diaticanit Weekly Supabase Backup",
  [ValidateSet("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")]
  [string]$DayOfWeek = "Sunday",
  [string]$RunAt = "03:00"
)

$backupScript = Join-Path $PSScriptRoot "backup-supabase-weekly.ps1"
if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Supabase weekly backup script not found at $backupScript"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $DayOfWeek -At $RunAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Weekly Supabase DB backup (schema/data/roles) for dev and staging." -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Schedule: $DayOfWeek at $RunAt"
Write-Host "Task action: $backupScript"
