// CHANGE-47: getting a transcript out of the app as a file.

// Characters Windows refuses in a file name (macOS refuses only "/" and ":", a subset). Control
// characters are refused too; they are dropped by char code because a regex range over them trips
// no-control-regex. Each refused character becomes a space and runs of spaces collapse, so
// "Q3: plan" becomes "Q3 plan" rather than "Q3plan".
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

// Windows refuses a file name over 255 characters. The title is cut well short of that so the
// date and " transcript.txt" always survive.
const MAX_TITLE_LENGTH = 150;

// Firefox and Safari have saved empty files when the object URL was revoked straight after the
// click; a minute is far longer than any browser takes to start reading a local Blob.
const REVOKE_AFTER_MS = 60_000;

function stripControlCharacters(text: string): string {
  return Array.from(text, (ch) => (ch.charCodeAt(0) < 0x20 ? " " : ch)).join("");
}

export function transcriptFileName(title: string, date: string): string {
  const safeTitle = stripControlCharacters(title).replace(UNSAFE_FILE_NAME_CHARS, " ").replace(/\s+/g, " ").trim();
  const shortTitle = Array.from(safeTitle).slice(0, MAX_TITLE_LENGTH).join("").trim();
  const parts = shortTitle === "" ? ["Transcript", date] : [shortTitle, date, "transcript"];
  return `${parts.filter((part) => part !== "").join(" ")}.txt`;
}

export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
