Set-Location "$PSScriptRoot\apps\web"
$existingListener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $existingListener) {
	Write-Host "A server is already listening on port 3000 (PID $($existingListener.OwningProcess))."
	Write-Host "If you need to restart, stop the running server first, then run this script again."
	exit 0
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if ($null -eq $npmCommand) {
	$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if ($null -eq $npmCommand) {
	throw "npm was not found in PATH. Install Node.js and reopen PowerShell."
}

& $npmCommand.Source run serve:lan
