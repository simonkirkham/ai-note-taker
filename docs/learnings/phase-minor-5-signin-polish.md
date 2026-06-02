# CHANGE-5 — Sign-in screen visual polish

**Shipped:** PR #109, merge `d3e8979`, deployed 2026-06-02. Frontend style-only.

## What changed
`SignInPage.tsx` went from a bare `<h1>` + default browser button to a centred, branded card: an "AI" badge, the wordmark title, a tagline, and a primary "Sign in with Google" button carrying the official Google "G" mark, with hover/focus-visible/disabled states and `prefers-reduced-motion` respected. Styles live in a new `.sign-in-page` region appended at the end of `App.css`. A new `SignInPage.test.tsx` asserts the title and button render and clicking calls `signIn`.

All colours come from existing design tokens (`--color-bg`, `--color-surface`, `--color-primary`, `--color-primary-bg`, `--color-text`, `--color-text-muted`, `--color-border`, `--radius`, `--transition`) so the screen reskins with any theme — the only literal colours are inside the Google brand SVG (a logo must use Google's own colours). The auth wiring (`useAuth().signIn`, OAuth, no-auth bypass) is byte-for-byte unchanged.

## Technical notes
- Stylist (`ui-ux-pro-max`) was run; no `design-system/MASTER.md` existed so there was nothing to reconcile against — it informed the card + SVG-mark + focus-ring approach.
- The `.sign-in-button[disabled]` style is forward-looking dead CSS: the real `signIn` does a full-page redirect, so there's no async window to reflect a disabled state. Harmless; Hawk noted it as acceptable.
- Appending the CSS in its own delimited EOF region was a deliberate concurrency move (three minor slices touched `App.css` at once) — see the shared note in [[phase-minor-6-collapsible-filters]].

## Process
- First-pass Hawk approval, no rework. The slice was small and the no-change constraint (auth untouched) made review fast.
