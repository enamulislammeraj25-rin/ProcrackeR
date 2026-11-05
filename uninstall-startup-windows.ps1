$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Tide Progress.lnk'
if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host 'Tide has been removed from Windows Startup.' -ForegroundColor Green
} else {
  Write-Host 'No Tide Startup shortcut was found.'
}
