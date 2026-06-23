# Update the installed AI Note Taker desktop app by PULLING the latest published installer
# from GitHub Releases — no local build. Download → close app → silent install → relaunch.
# Requires the GitHub CLI (`gh`) installed and authenticated. Run from desktop/: `npm run update`.
$ErrorActionPreference = 'Stop'

$repo = 'simonkirkham/ai-note-taker'
$dir = Join-Path $env:TEMP 'ainote-update'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Get-ChildItem $dir -Filter '*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Host 'Downloading the latest published installer (release: desktop-latest)...'
gh release download desktop-latest --repo $repo --pattern '*.exe' --dir $dir --clobber

$exe = Get-ChildItem $dir -Filter '*.exe' | Select-Object -First 1
if (-not $exe) { throw 'No installer (.exe) found in the desktop-latest release.' }

Write-Host 'Closing the running app (if any)...'
Get-Process 'AI Note Taker' -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Installing $($exe.Name) (silent)..."
Start-Process -FilePath $exe.FullName -ArgumentList '/S' -Wait

# /S installs silently but does not relaunch — open the installed app via its shortcut.
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI Note Taker.lnk'
if (Test-Path $shortcut) {
  Start-Process $shortcut
  Write-Host 'Done — AI Note Taker updated and relaunched.'
} else {
  Write-Host 'Done — AI Note Taker updated. Launch it from the Start menu.'
}
