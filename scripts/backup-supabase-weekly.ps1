param(
  [string]$BackupRoot = "C:\Private\AI Projects\Personal Health Companion\Backup",
  [int]$KeepWeekly = 12
)

$ErrorActionPreference = "Stop"

function Ensure-Directory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

function Get-RequiredEnv([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
  }

  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $name"
  }

  return $value
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

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI not found in PATH."
}

$hasDocker = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$hasPgDump = $null -ne (Get-Command pg_dump -ErrorAction SilentlyContinue)
if (-not $hasDocker -and -not $hasPgDump) {
  throw "Weekly Supabase dump requires Docker Desktop or PostgreSQL client tools (pg_dump). Install one of them and run again."
}

$dateFolder = Get-Date -Format "yyyy-MM-dd"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$weeklyRoot = Join-Path $BackupRoot "weekly"
$targetRoot = Join-Path $weeklyRoot $dateFolder
$dbRoot = Join-Path $targetRoot "supabase"

Ensure-Directory $BackupRoot
Ensure-Directory $weeklyRoot
Ensure-Directory $targetRoot
Ensure-Directory $dbRoot

$environments = @(
  @{
    Name = "dev"
    ProjectRef = Get-RequiredEnv "SUPABASE_PROJECT_REF_DEV"
    Password = Get-RequiredEnv "SUPABASE_DB_PASSWORD_DEV"
  },
  @{
    Name = "staging"
    ProjectRef = Get-RequiredEnv "SUPABASE_PROJECT_REF_STAGING"
    Password = Get-RequiredEnv "SUPABASE_DB_PASSWORD_STAGING"
  }
)

foreach ($envSpec in $environments) {
  $envDir = Join-Path $dbRoot $envSpec.Name
  Ensure-Directory $envDir

  $schemaFile = Join-Path $envDir ("schema-{0}.sql" -f $timestamp)
  $dataFile = Join-Path $envDir ("data-{0}.sql" -f $timestamp)
  $rolesFile = Join-Path $envDir ("roles-{0}.sql" -f $timestamp)

  supabase db dump --project-ref $envSpec.ProjectRef --password $envSpec.Password --file $schemaFile
  if ($LASTEXITCODE -ne 0) {
    throw "Schema dump failed for $($envSpec.Name)."
  }

  supabase db dump --project-ref $envSpec.ProjectRef --password $envSpec.Password --data-only --use-copy --file $dataFile
  if ($LASTEXITCODE -ne 0) {
    throw "Data dump failed for $($envSpec.Name)."
  }

  supabase db dump --project-ref $envSpec.ProjectRef --password $envSpec.Password --role-only --file $rolesFile
  if ($LASTEXITCODE -ne 0) {
    throw "Role dump failed for $($envSpec.Name)."
  }
}

$manifestPath = Join-Path $targetRoot ("supabase-backup-manifest-{0}.txt" -f $timestamp)
@(
  "timestamp=$timestamp",
  "backupRoot=$BackupRoot",
  "targetRoot=$targetRoot",
  "environments=dev,staging"
) | Out-File -FilePath $manifestPath -Encoding utf8

Prune-OldEntries -path $weeklyRoot -keep $KeepWeekly

Write-Host "Supabase weekly backup complete: $targetRoot"
