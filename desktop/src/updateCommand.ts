// 53-A — the command the update notice copies. Owned by the desktop shell so the page cannot
// choose what lands on a clipboard the user may paste into PowerShell. The page shows the same
// text (web/src/components/UpdateNotice.tsx); publish.spec.ts keeps the two identical.
// Works from any PowerShell window: downloads the published update script and runs it only if
// the download succeeded.
export const UPDATE_COMMAND =
  '$f="$env:TEMP\\ainote-update.ps1"; irm https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/update.ps1 -OutFile $f; if ($?) { powershell -ExecutionPolicy Bypass -File $f }';
