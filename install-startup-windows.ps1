# Tide: create a Windows Startup shortcut for the hosted PWA.
# Run once after you have deployed Tide over HTTPS and installed it in Edge/Chrome.

$ErrorActionPreference = 'Stop'
$appUrl = Read-Host 'Paste your hosted Tide URL (https://...)'
if (-not ($appUrl -match '^https://')) {
  Write-Host 'Please use the HTTPS URL of your hosted Tide app.' -ForegroundColor Yellow
  exit 1
}

$edgeCandidates = @(
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)
$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = ($edgeCandidates + $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
if (-not $browser) {
  Write-Host 'Could not find Microsoft Edge or Google Chrome. Install one and run this script again.' -ForegroundColor Red
  exit 1
}

$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Tide Progress.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $browser
$shortcut.Arguments = "--app=`"$appUrl`""
$shortcut.WorkingDirectory = Split-Path $browser
$shortcut.Description = 'Open Tide Daily Progress when Windows starts'
$shortcut.Save()

Write-Host "Done. Tide will open when you sign in to Windows." -ForegroundColor Green
Write-Host "Shortcut: $shortcutPath"
