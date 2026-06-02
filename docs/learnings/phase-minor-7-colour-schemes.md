# CHANGE-7 — More colour schemes; drop duplicate Forest theme

**Shipped:** PR #112 (merge `1334630`) + follow-up PR #114 (merge `24068e7`, muted-contrast), deployed 2026-06-02. Frontend client-only.

## What changed
Removed the Forest theme (a near-duplicate of the default Teal) and added nine distinct palettes for **12 themes total** — light: Teal (`:root` default), Indigo, Rose, Amber, Violet, Sky, Sepia, Contrast; dark: Midnight, Slate, Carbon, Plum. Each non-default theme is a `[data-theme="key"]` block in `App.css` re-declaring the full token set; dark themes set their own semantic `--color-error`/`--color-error-bg`. `ThemePicker.tsx` lists them under Light/Dark `<optgroup>`s; `useTheme.ts` carries the type union + allow-list; `index.html`'s pre-mount bootstrap allow-list was updated to match. A stored or legacy `forest` value falls back to Teal via the existing unknown-value guard. `localStorage` key `note-taker-theme` is unchanged. No event/projection/API change.

## Prototype-first
The palette set was chosen from a standalone gallery prototype (`prototype/minor-7-colour-schemes` → `colour-schemes-prototype.html`) rendering the same mock UI under 13 candidates. The user's rule — "keep all that aren't very similar" — resolved to dropping only Forest (the lone Teal clone) and keeping everything else, with Indigo/Violet flagged as the closest surviving pair but both kept. `REFERENCE.md` on the prototype branch captured the confirmed hexes; the phase-doc "Confirmed palettes" tables are the authoritative source.

## Technical notes
- **Muted-text contrast was the one real gap.** Hawk found `--color-text-muted` on five light themes (Sepia 3.84, Indigo 4.26, Rose 4.40, Violet 4.41, Sky 4.46) fell below the 4.5:1 the acceptance criteria require — values transcribed faithfully from the approved palette table, so the table itself was the source of the shortfall. Fixed in PR #114 by darkening muted to `#475569`/`#4B5563`/`#6B5A45` (all now ~6–7:1); primary/background/border hues (the theme identity reviewed in the prototype) were left untouched, so only secondary caption text changed.
- **A picker chooses primary/background hues, not muted greys.** The contrast miss slipped through prototype review because the eye judges the theme by its loud colours; the quiet secondary text is exactly where AA failures hide. Worth a contrast pass on muted/border tokens as a standing check when adding palettes.
- Pre-existing table/CSS divergence: Midnight's `--color-error-bg` ships as `rgba(248,113,113,0.15)` while the table lists `#3F1D1D` (originated in CHANGE-2, locked into the table later). Left as-is; reconciled in the phase-doc table at Scribe.

## Process
Ran as one of three parallel minor slices — see the parallel-slice notes in [[phase-minor-6-collapsible-filters]]. The contrast fix landed as a separate small PR rather than amending the merged #112, since Hawk had pre-approved it as a follow-up.
