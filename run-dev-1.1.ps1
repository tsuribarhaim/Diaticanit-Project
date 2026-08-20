Set-Location "$PSScriptRoot\apps\web"

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if ($null -eq $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if ($null -eq $npmCommand) {
  throw "npm was not found in PATH. Install Node.js and reopen PowerShell."
}

& $npmCommand.Source run dev:3001
