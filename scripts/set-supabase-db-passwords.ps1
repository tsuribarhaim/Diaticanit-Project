function ConvertTo-PlainText([SecureString]$secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$devSecure = Read-Host "Enter DEV Supabase DB password" -AsSecureString
$stagingSecure = Read-Host "Enter STAGING Supabase DB password" -AsSecureString

$devPlain = ConvertTo-PlainText $devSecure
$stagingPlain = ConvertTo-PlainText $stagingSecure

[Environment]::SetEnvironmentVariable("SUPABASE_DB_PASSWORD_DEV", $devPlain, "User")
[Environment]::SetEnvironmentVariable("SUPABASE_DB_PASSWORD_STAGING", $stagingPlain, "User")

Write-Host "Saved: SUPABASE_DB_PASSWORD_DEV"
Write-Host "Saved: SUPABASE_DB_PASSWORD_STAGING"
