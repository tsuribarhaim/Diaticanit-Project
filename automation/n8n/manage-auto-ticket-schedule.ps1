# One place to control the nightly Auto Ticket Handling run.
#
#   .\manage-auto-ticket-schedule.ps1 status                 what is scheduled right now
#   .\manage-auto-ticket-schedule.ps1 stop                   pause EVERYTHING (Windows task + n8n schedule)
#   .\manage-auto-ticket-schedule.ps1 start                  resume both
#   .\manage-auto-ticket-schedule.ps1 set-time 02:00         Windows task at 02:00, n8n schedule 15 min later
#   .\manage-auto-ticket-schedule.ps1 install [02:00]       (re)create the Windows task (default 02:00)
#   Add  -Job analyst  to any command to manage the evening spec analyst instead (default 17:45).
#   .\manage-auto-ticket-schedule.ps1 run-now                fire a batch right now (same webhook as the schedule)
#
# Two triggers on purpose: the Windows task wakes the laptop and readies n8n + the bridge; n8n's
# own schedule (15 min later) starts the run; if n8n did not start it the Windows script fires the
# webhook itself after 20 min. The bridge refuses overlapping batches, so they can never double up.
param(
  [Parameter(Position = 0)][ValidateSet("status", "stop", "start", "set-time", "install", "run-now")][string]$Action = "status",
  [Parameter(Position = 1)][string]$Time = "",
  # night = the nightly fix run (default 02:00). analyst = the evening spec analyst (default 17:45, its n8n schedule is 15 min later).
  [ValidateSet("night", "analyst")][string]$Job = "night"
)

if ($Job -eq "analyst") {
  $taskName = "Daffy Spec Analyst"
  $env:JOB = "analyst"
  $webhookUrl = "http://localhost:5678/webhook/daffy-spec-analyst-manual"
  if (-not $Time) { $Time = "17:45" }
} else {
  $taskName = "Daffy Auto Ticket Handling"
  $env:JOB = "night"
  $webhookUrl = "http://localhost:5678/webhook/daffy-auto-ticket-handling-manual"
  if (-not $Time) { $Time = "02:00" }
}
$here = $PSScriptRoot
$runScript = Join-Path $here "run-auto-ticket-handling.ps1"
$n8nHelper = Join-Path $here "n8n-schedule.js"

function Test-Time($t) {
  if ($t -notmatch '^([01]?\d|2[0-3]):[0-5]\d$') { throw "Time must be HH:MM in 24h format, e.g. 02:00 (got '$t')" }
}
function Get-N8nTime($t) { ([datetime]::ParseExact($t, "H:mm", $null)).AddMinutes(15).ToString("HH:mm") }
function Invoke-N8n($cmdArgs) { & node $n8nHelper @cmdArgs; if ($LASTEXITCODE -ne 0) { throw "n8n helper failed ($cmdArgs)" } }

function Register-Task($t) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`" -Job $Job"
  $trigger = New-ScheduledTaskTrigger -Daily -At $t
  $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Wakes the laptop and readies n8n + the bridge for the nightly Auto Ticket Handling run; fires it itself if n8n's schedule did not. Manage with manage-auto-ticket-schedule.ps1." -Force | Out-Null
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    $at = ($task.Triggers | Select-Object -First 1).StartBoundary
    Write-Host ("Windows task : {0} | daily at {1} | next run {2} | wake-to-run {3}" -f $task.State, ([datetime]$at).ToString("HH:mm"), $info.NextRunTime, $task.Settings.WakeToRun)
  } else { Write-Host "Windows task : NOT INSTALLED (run: install)" }
  try { & node $n8nHelper status } catch { Write-Host "n8n schedule : could not read ($($_.Exception.Message))" }
  $bridge = $false
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect("127.0.0.1", 7891); $c.Close(); $bridge = $true } catch {}
  Write-Host ("Bridge       : {0}" -f $(if ($bridge) { "listening on 7891" } else { "NOT running (the Windows task starts it at run time)" }))
  $log = Join-Path $env:LOCALAPPDATA "Daffy\auto-ticket-trigger.log"
  if (Test-Path $log) { Write-Host "Last log lines ($log):"; Get-Content $log -Tail 5 | ForEach-Object { Write-Host "  $_" } }
}

switch ($Action) {
  "status" { Show-Status }
  "stop" {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Invoke-N8n @("disable")
    Write-Host "STOPPED: no nightly run will start until you run 'start'."
    Show-Status
  }
  "start" {
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Invoke-N8n @("enable")
    Write-Host "STARTED."
    Show-Status
  }
  "set-time" {
    Test-Time $Time
    if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { Register-Task $Time }
    else { Set-ScheduledTask -TaskName $taskName -Trigger (New-ScheduledTaskTrigger -Daily -At $Time) | Out-Null }
    Invoke-N8n @("set", (Get-N8nTime $Time))
    Write-Host ("Windows task now at {0}; n8n schedule at {1}." -f $Time, (Get-N8nTime $Time))
    Show-Status
  }
  "install" {
    Test-Time $Time
    Register-Task $Time
    Invoke-N8n @("set", (Get-N8nTime $Time))
    Invoke-N8n @("enable")
    Show-Status
  }
  "run-now" {
    Write-Host "Firing a batch now (the summary email is sent when it finishes)..."
    try { Invoke-WebRequest -Uri $webhookUrl -Method Post -UseBasicParsing -TimeoutSec 20 | Out-Null; Write-Host "Batch finished." }
    catch { if ($_.Exception.Message -match "timed out|timeout|Timeout") { Write-Host "Batch started and running in n8n." } else { throw } }
  }
}
