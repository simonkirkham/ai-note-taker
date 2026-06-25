# Prototype REFERENCE — CHANGE-28 notes body text size

Branch: `prototype/notes-text-typography` (reference only, never merged).

## Chosen setting (user-approved)

| Property | Today | **Chosen** |
|----------|-------|-----------|
| Font family | Plus Jakarta Sans | **Plus Jakarta Sans (unchanged)** |
| Font size | 16px (1rem) | **14px (0.875rem)** |
| Line height | 1.75 | **1.7** |

The font does NOT change — only the body text size and line-height come down.

## Where it applies

`web/src/components/NoteEditor.module.css` → `.contentInput`:
- `font-size: 1rem;` → `font-size: 0.875rem;`
- `line-height: 1.75;` → `line-height: 1.7;`

Nothing else changes:
- Paragraphs stay single-spaced (`.contentInput p { margin: 0 }`, CHANGE-1).
- Headings keep their existing margin overrides and inherit/scale from the new base (browser-default `em`-relative heading sizes scale down proportionally — no separate heading rule needed).
- `font-family: inherit` stays (Plus Jakarta Sans from `body`).

## Scope

Pure CSS appearance tweak — no event model, API, projection, or component-logic change. Only the two `.contentInput` values. Update any test that asserts the old values (none expected — these are vendor-style CSS, not asserted in unit tests).
