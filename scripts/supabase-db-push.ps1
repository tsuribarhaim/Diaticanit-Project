param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev", "staging")]
  [string]$Environment
)

$projectRefEnv = "SUPABASE_PROJECT_REF_{0}" -f $Environment.ToUpperInvariant()
$dbPasswordEnv = "SUPABASE_DB_PASSWORD_{0}" -f $Environment.ToUpperInvariant()

$projectRef = [Environment]::GetEnvironmentVariable($projectRefEnv, "User")
if ([string]::IsNullOrWhiteSpace($projectRef)) {
  $projectRef = [Environment]::GetEnvironmentVariable($projectRefEnv, "Process")
}

$dbPassword = [Environment]::GetEnvironmentVariable($dbPasswordEnv, "User")
if ([string]::IsNullOrWhiteSpace($dbPassword)) {
  $dbPassword = [Environment]::GetEnvironmentVariable($dbPasswordEnv, "Process")
}

if ([string]::IsNullOrWhiteSpace($projectRef)) {
  throw "Missing $projectRefEnv. Set it as a user environment variable."
}

if ([string]::IsNullOrWhiteSpace($dbPassword)) {
  throw "Missing $dbPasswordEnv. Set it as a user environment variable."
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw "Supabase CLI is not installed. Install it first: https://supabase.com/docs/guides/cli"
}

Set-Location "$PSScriptRoot\.."

supabase link --project-ref $projectRef --password $dbPassword
if ($LASTEXITCODE -ne 0) {
  throw "supabase link failed for environment '$Environment'."
}

supabase db push
if ($LASTEXITCODE -ne 0) {
  throw "supabase db push failed for environment '$Environment'."
}

Write-Host "Supabase migrations pushed successfully to $Environment ($projectRef)."
