# Run these once in PowerShell to set project refs/passwords for scripted pushes.
# Replace placeholders before running.

[Environment]::SetEnvironmentVariable("SUPABASE_PROJECT_REF_DEV", "your-dev-project-ref", "User")
[Environment]::SetEnvironmentVariable("SUPABASE_DB_PASSWORD_DEV", "your-dev-db-password", "User")

[Environment]::SetEnvironmentVariable("SUPABASE_PROJECT_REF_STAGING", "your-staging-project-ref", "User")
[Environment]::SetEnvironmentVariable("SUPABASE_DB_PASSWORD_STAGING", "your-staging-db-password", "User")
