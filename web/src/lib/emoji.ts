// A curated map of common GitHub-style :shortcode: -> unicode emoji. Kept small and
// dependency-free (the source analysis called for "a small curated common-set map"):
// enough to cover what shows up in meeting notes, not the full GitHub set. Unknown
// shortcodes are left untouched everywhere.
export const EMOJI: Record<string, string> = {
  smile: '😄',
  smiley: '😃',
  grin: '😁',
  laughing: '😆',
  joy: '😂',
  rofl: '🤣',
  wink: '😉',
  blush: '😊',
  thinking: '🤔',
  neutral_face: '😐',
  sweat_smile: '😅',
  cry: '😢',
  sob: '😭',
  angry: '😠',
  tada: '🎉',
  rocket: '🚀',
  fire: '🔥',
  star: '⭐',
  sparkles: '✨',
  boom: '💥',
  zap: '⚡',
  '100': '💯',
  heart: '❤️',
  broken_heart: '💔',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  '-1': '👎',
  ok_hand: '👌',
  clap: '👏',
  wave: '👋',
  pray: '🙏',
  muscle: '💪',
  eyes: '👀',
  point_right: '👉',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  check: '✔️',
  x: '❌',
  warning: '⚠️',
  question: '❓',
  exclamation: '❗',
  bulb: '💡',
  bell: '🔔',
  lock: '🔒',
  key: '🔑',
  mag: '🔍',
  gear: '⚙️',
  wrench: '🔧',
  hammer: '🔨',
  bug: '🐛',
  hourglass: '⏳',
  alarm_clock: '⏰',
  calendar: '📅',
  memo: '📝',
  pencil: '✏️',
  pushpin: '📌',
  paperclip: '📎',
  chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉',
  moneybag: '💰',
  email: '📧',
  phone: '📞',
  coffee: '☕',
  beer: '🍺',
  pizza: '🍕',
  sunny: '☀️',
  cloud: '☁️',
  snowflake: '❄️',
  no_entry: '⛔',
  recycle: '♻️',
  hankey: '💩',
  poop: '💩',
  ghost: '👻',
  robot: '🤖',
  construction: '🚧',
};

// Matches a :shortcode: token. Shortcodes are lowercase alphanumerics plus _, +, -
// (covers :+1: / :-1:). Case-insensitive match, lowercased lookup.
const SHORTCODE = /:([a-z0-9_+-]+):/gi;

function emojifySegment(text: string): string {
  return text.replace(SHORTCODE, (whole, code: string) => EMOJI[code.toLowerCase()] ?? whole);
}

// Segments that must be kept verbatim — a `:word:` inside any of these is NOT a
// shortcode and emojifying it would corrupt the note:
//   - fenced code blocks (``` / ~~~), incl. an unterminated fence to end-of-string
//   - inline code spans
//   - markdown link/image destinations `](url)` — the URL, not the label
//   - autolinks `<url>` and bare `http(s)://…` URLs
// Captured so they land at odd indices of the split; only the even (prose) indices
// are transformed. Note: this is intentionally a shortcode→unicode one-way transform,
// so a numeric shortcode like `:100:` in prose (e.g. "1:100:2") still converts — an
// accepted, documented quirk of shortcode emoji.
const PROTECTED = new RegExp(
  '(' +
    [
      '```[\\s\\S]*?```',
      '```[\\s\\S]*$',
      '~~~[\\s\\S]*?~~~',
      '~~~[\\s\\S]*$',
      '`[^`\\n]*`',
      '\\]\\([^)]*\\)',
      '<[^>\\s]+>',
      'https?:\\/\\/[^\\s<>)\\]]+',
    ].join('|') +
    ')',
  'g',
);

// Replace known :shortcode: tokens in a markdown string with their emoji, but never
// inside code or a URL (see PROTECTED). Transforms only the prose segments.
export function emojifyMarkdown(markdown: string): string {
  const parts = markdown.split(PROTECTED);
  return parts.map((segment, i) => (i % 2 === 0 ? emojifySegment(segment) : segment)).join('');
}

// Look up a single shortcode name (no surrounding colons); undefined if unknown.
export function emojiFor(code: string): string | undefined {
  return EMOJI[code.toLowerCase()];
}
