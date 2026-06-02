# CHANGE-2 — Theme selection (Teal / Forest / Midnight)

**Shipped:** PR #102, deployed 2026-06-02.

## What changed
Three selectable colour themes, persisted across sessions, as pure CSS custom-property overrides:
- Teal stays on `:root` (default, no attribute); `[data-theme="forest"]` / `[data-theme="midnight"]` re-declare the same variables. The whole UI reskins through the cascade — no component references a literal themed colour.
- `useTheme` hook: reads/persists `localStorage['note-taker-theme']`, falls back to Teal for missing/unknown, applies via `document.documentElement.dataset.theme` (Teal deletes the attribute).
- `ThemePicker` (`<select>`) in a new `.sidebar-footer` group above Sign out.
- Inline bootstrap in `index.html` applies the saved theme **before React mounts** → no flash of default Teal on reload.

## Technical notes
- **Only the picker needs the theme value**, so a plain hook is enough — no Context, no App.tsx wiring. Simpler than the spec's "useTheme hook *or* ThemeContext" alternative.
- **Bootstrap ↔ hook must stay in sync**: same storage key, same valid set, and the "Teal = no `data-theme`" invariant is enforced in three places (hook `applyTheme`, the bootstrap only sets forest/midnight, tests assert `toBeUndefined()`).
- **Dark-mode audit / deliberate spec deviation:** the four flagged hardcoded backgrounds were tokenised via new `--color-error` / `--color-error-bg` / `--color-error-border` and `--color-banner` / `--color-banner-text`. The spec literally suggested mapping `.notification-banner-enable` to `--color-surface`, but that button is white-on-an-always-blue banner — `--color-surface` would render it dark-on-blue (~1.1:1) in Midnight. Tokenising the **banner pair** instead removes the literals while holding ~9.3:1 in all themes. Hawk agreed the deviation was correct. Lesson: a mechanical "tokenise every literal background" audit can break contrast — judge each by its container.

## Tests
`ThemePicker.test.tsx` (7): default Teal + no `data-theme`; select Forest/Midnight set & persist; select Teal clears the attribute; restore on mount; persist across remount; bad-value fallback. Full suite 208 green; typecheck + lint clean; prod `vite build` succeeds.

## Known small follow-ups (optional, from Hawk)
- No direct test that the inline bootstrap applies `data-theme` before mount (asserted only via the select value). Low risk — trivial inline script, verified present in `dist/index.html`.
- `.transcription-error` text shifted `#991b1b → #DC2626` (still ≥4.5:1) — a minor real visual change, not a no-op.
- `.transcription-analyse-error` / `.transcription-dot` still use literal `#ef4444` (not on the audit list; fine on dark).
