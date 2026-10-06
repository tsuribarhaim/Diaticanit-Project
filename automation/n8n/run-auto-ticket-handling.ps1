# Triggered by the Windows scheduled task "Daffy Auto Ticket Handling" (manage with
# manage-auto-ticket-schedule.ps1).
#
# Why this exists: n8n runs inside Docker and its in-process timer is not reliable when the
# laptop sleeps (confirmed 2026-10-06 - a 9:00 run was missed after hours in Modern Standby).
# Task Scheduler can wake the machine and runs a missed start as soon as it is available.
#
# What it does:
#   1. waits for n8n and makes sure the bridge is running (starts it if needed)
#   2. waits until -FallbackAfterMinutes after it started (n8n's own schedule is set 15 min
#      after this task, so it normally fires inside that window)
#   3. if n8n did NOT start a run since this script started, fires the same webhook itself
#
# -Probe: checks n8n / the bridge / the n8n API only; never waits, never fires a run.
# -Job night (default): the nightly Auto Ticket Handling run. -Job analyst: the evening spec analyst.
param([switch]$Probe, [int]$FallbackAfterMinutes = 20, [ValidateSet("night", "analyst")][string]$Job = "night")

$ErrorActionPreference = "Continue"
$bridgeDir = Join-Path $PSScriptRoot "bridge"
if ($Job -eq "analyst") {
  $webhook = "http://localhost:5678/webhook/daffy-spec-analyst-manual"
  $workflowId = "pKppGftX2H6ZtLr0"
} else {
  $webhook = "http://localhost:5678/webhook/daffy-auto-ticket-handling-manual"
  $workflowId = "laS2Rbh58PsmS3DB"
}
$logDir = Join-Path $env:LOCALAPPDATA "Daffy"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "auto-ticket-trigger.log"
$startedAt = (Get-Date).ToUniversalTime()

function Write-Log($msg) { "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg | Add-Content -Path $log -Encoding utf8 }
function Test-Port($port) {
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}

$apiKey = $null
$envFile = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -like "N8N_API_KEY=*" } | Select-Object -First 1
  if ($line) { $apiKey = $line.Substring("N8N_API_KEY=".Length).Trim('"', "'", " ") }
}

# True when n8n recorded (or is running) an execution of the workflow that started after $startedAt.
function Test-N8nRanSince {
  if (-not $apiKey) { return $null }
  try {
    $h = @{ "X-N8N-API-KEY" = $apiKey }
    foreach ($status in @("running", $null)) {
      $uri = "http://localhost:5678/api/v1/executions?workflowId=$workflowId&limit=5" + $(if ($status) { "&status=$status" } else { "" })
      $r = Invoke-RestMethod -Uri $uri -Headers $h -TimeoutSec 15
      foreach ($e in $r.data) { if ($e.startedAt -and ([datetime]$e.startedAt).ToUniversalTime() -ge $startedAt) { return $true } }
    }
    return $false
  } catch { Write-Log ("could not read n8n executions: " + $_.Exception.Message); return $null }
}

Write-Log ("start (job={0}, probe={1}, fallback after {2} min)" -f $Job, $Probe.IsPresent, $FallbackAfterMinutes)

# After a wake from standby Docker/WSL can take a few minutes to answer - wait up to 10 minutes.
$n8nUp = $false
for ($i = 0; $i -lt 60; $i++) {
  try { if ((Invoke-WebRequest -Uri "http://localhost:5678/healthz" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { $n8nUp = $true; break } } catch {}
  Start-Sleep -Seconds 10
}
if (-not $n8nUp) { Write-Log "FAILED: n8n did not answer on :5678 within 10 minutes (is Docker Desktop running?)"; exit 1 }
Write-Log "n8n is up"

if (-not (Test-Port 7891)) {
  Write-Log "bridge not listening on 7891 - starting it"
  Start-Process -FilePath "node" -ArgumentList "server.js", ".env.local" -WorkingDirectory $bridgeDir -WindowStyle Hidden
  for ($i = 0; $i -lt 15 -and -not (Test-Port 7891); $i++) { Start-Sleep -Seconds 2 }
}
if (-not (Test-Port 7891)) { Write-Log "FAILED: bridge still not listening on 7891"; exit 1 }
Write-Log "bridge is up"

if ($Probe) {
  $ran = Test-N8nRanSince
  Write-Log ("probe ok - n8n API readable: {0} - not waiting, not firing" -f ($null -ne $ran))
  exit 0
}

# Give n8n's own schedule its window to start the run.
$deadline = $startedAt.AddMinutes($FallbackAfterMinutes)
while ((Get-Date).ToUniversalTime() -lt $deadline) {
  if ((Test-N8nRanSince) -eq $true) { Write-Log "n8n's own schedule started the run - nothing more to do"; exit 0 }
  Start-Sleep -Seconds 30
}
if ((Test-N8nRanSince) -eq $true) { Write-Log "n8n's own schedule started the run - nothing more to do"; exit 0 }

Write-Log "n8n did not start a run in time - firing the webhook as a fallback"
# The webhook only answers when the whole batch finishes, which can take much longer than we
# need to wait; n8n keeps running after we disconnect, so a short timeout here is expected.
try {
  Invoke-WebRequest -Uri $webhook -Method Post -UseBasicParsing -TimeoutSec 30 | Out-Null
  Write-Log "webhook answered (batch already finished)"
} catch {
  if ($_.Exception.Message -match "timed out|timeout|Timeout") { Write-Log "webhook fired (batch running in n8n)" }
  else { Write-Log ("FAILED calling webhook: " + $_.Exception.Message); exit 1 }
}
exit 0
