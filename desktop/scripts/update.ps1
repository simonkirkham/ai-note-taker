# Update the installed AI Note Taker desktop app by PULLING the latest published installer
# from GitHub Releases - no local build. Version-checks first (tiny build-sha.txt) and only
# downloads the 82 MB installer when it's actually newer. Download -> close app -> silent
# install -> relaunch. Requires the GitHub CLI (`gh`). Run from desktop/: `npm run update`.
$ErrorActionPreference = 'Stop'

$repo = 'simonkirkham/ai-note-taker'
$dir = Join-Path $env:TEMP 'ainote-update'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Records the commit SHA we last installed, so we can skip a re-download when unchanged.
$stateFile = Join-Path $env:LOCALAPPDATA 'ai-note-taker-update\installed-sha.txt'

# 1. Pull just the tiny SHA marker and compare to what we last installed. A release without
# the marker (older release, or a download hiccup) -> treat as unknown and fall back to a
# normal install rather than erroring out.
$shaPath = Join-Path $dir 'build-sha.txt'
Remove-Item $shaPath -ErrorAction SilentlyContinue
$publishedSha = ''
try {
  gh release download desktop-latest --repo $repo --pattern 'build-sha.txt' --dir $dir --clobber 2>$null
  if (Test-Path $shaPath) { $publishedSha = (Get-Content $shaPath -Raw).Trim() }
} catch {
  $publishedSha = ''
}
$installedSha = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { '' }

# Skip only when we have a KNOWN published SHA that matches what we installed.
if ($publishedSha -and $publishedSha -eq $installedSha) {
  Write-Host "Already up to date (build $($publishedSha.Substring(0, [Math]::Min(7, $publishedSha.Length)))). Nothing to download."
  return
}

# 2. Newer (or unknown) build - pull the installer and install it.
Get-ChildItem $dir -Filter '*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force
$label = if ($publishedSha) { $publishedSha.Substring(0, [Math]::Min(7, $publishedSha.Length)) } else { 'latest' }
Write-Host "Build $label available - downloading installer..."
gh release download desktop-latest --repo $repo --pattern '*.exe' --dir $dir --clobber

$exe = Get-ChildItem $dir -Filter '*.exe' | Select-Object -First 1
if (-not $exe) { throw 'No installer (.exe) found in the desktop-latest release.' }

Write-Host 'Closing the running app (if any)...'
# Process name tracks electron-builder.json productName; shortcut below tracks nsis.shortcutName.
Get-Process 'AI Note Taker' -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Installing $($exe.Name) (silent)..."
Start-Process -FilePath $exe.FullName -ArgumentList '/S' -Wait

# Record the installed SHA only after a successful install, so a failed run retries next time.
# Skip when the published SHA was unknown (marker absent) - leave the state so the next run
# re-checks once a marker-bearing release exists.
if ($publishedSha) {
  New-Item -ItemType Directory -Force -Path (Split-Path $stateFile) | Out-Null
  Set-Content -Path $stateFile -Value $publishedSha -Encoding ascii
}

# /S installs silently but does not relaunch - open the installed app via its shortcut.
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI Note Taker.lnk'
if (Test-Path $shortcut) {
  Start-Process $shortcut
  Write-Host 'Done - AI Note Taker updated and relaunched.'
} else {
  Write-Host 'Done - AI Note Taker updated. Launch it from the Start menu.'
}
