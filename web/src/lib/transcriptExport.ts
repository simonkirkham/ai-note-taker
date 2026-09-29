// CHANGE-47: getting a transcript out of the app as a file.

// Characters Windows refuses in a file name (macOS refuses only "/" and ":", a subset). Control
// characters are refused too; they are dropped by char code because a regex range over them trips
// no-control-regex. Each refused character becomes a space and runs of spaces collapse, so
// "Q3: plan" becomes "Q3 plan" rather than "Q3plan".
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

function stripControlCharacters(text: string): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 0x20 ? " " : ch)).join("");
}

export function transcriptFileName(title: string, date: string): string {
  const safeTitle = stripControlCharacters(title).replace(UNSAFE_FILE_NAME_CHARS, " ").replace(/\s+/g, " ").trim();
  const parts = safeTitle === "" ? ["Transcript", date] : [safeTitle, date, "transcript"];
  return `${parts.filter((part) => part !== "").join(" ")}.txt`;
}

export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked on the next task, not synchronously: some browsers start reading the Blob only
  // after click() returns, and revoking first yields an empty or failed download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
