# CHANGE-23 — URL-backed home filters + the E2E that flaked the gate

**Slice:** persist home list filters (search query, selected tags, AND/OR mode, show-older) in the URL so browser Back from a note restores them.
**PRs:** #333 (feature), #334 (E2E fix). **Deploys:** #633 (red, E2E gate), #634 (green).

## What shipped

| Aspect | Detail |
|--------|--------|
| Mechanism | All four filters derived from `useSearchParams`; setters write back via one `writeFilters` helper with `{ replace: true }`. Opening a note pushes; filter edits replace. Back replays the prior URL → filters re-hydrate. |
| Params | `?q=` (query), repeated `?tag=` (selected tags), `?mode=OR` (omitted = AND default), `?older=1`. Unrelated params preserved on every write. |
| CHANGE-19 kept | `nextOlderForSelection` returns the next show-older value so tags + older write in **one** `writeFilters` call (two sequential `setSearchParams` would clobber). `olderAutoEnabled` stays React-local. |
| Scope | `ListView` only; no backend, no event-model, no projection. Filters are per-view — App nav handlers route to bare paths, so switching folder/Home clears them; Back still restores via history. |

## Lesson 1 — a shared component that newly reads the URL breaks every isolation test at once

`ListView` did not depend on a Router before; adding `useSearchParams` made every test that renders it in isolation throw "useSearchParams must be used within a Router" — 54 failures across 6 files. The shared `render` helper could **not** simply wrap everything in a `MemoryRouter`: `Sidebar`/`WorkspaceSwitcher` tests already supply their own router → nesting two Routers throws. Fix: a dedicated `renderWithRouter` export (opt-in), aliased `as render` in the ListView-only suites, kept separate where a test also renders `<App/>` (which has its own `BrowserRouter`).

**Takeaway:** when a widely-rendered component starts consuming a context (Router, a new Provider), grep every test that renders it in isolation *before* implementing — the test-harness change is part of the slice, not an afterthought.

## Lesson 2 — don't prove a URL round-trip through an *ungated* async projection

The first E2E opened the just-created note **from search results** (`/notes/search`), then pressed Back. The search read is a projector-built read **with no consistency gate** (unlike `/notes/cards`), so a note written seconds earlier lagged past the 32s reload-tolerant window → deploy #633 red. The feature code was fine; all unit + integration tests passed. PR CI never runs E2E, so it only surfaced in the deploy gate.

The fix wasn't "wait longer" (an ungated read has no token to converge on) — it was **choosing a different vehicle**: the **show-older** filter filters the *gated* home-card list client-side, so the proof needs zero async-search dependency. Create note → tick show-older (`?older=1`) → open the (still-visible, gated) card → Back → re-open the Filters panel → checkbox still ticked.

Two sub-points that mattered:
- **After Back, the Filters panel re-collapses** (`filtersOpen` is React-local, not URL-backed) even though the filter is still active (URL-derived). The journey must re-open the panel before asserting the control's state — the *filter* survived, the *panel UI* didn't.
- The unit specs already cover the URL read/write mechanics of all four filters; the E2E only needs to prove the **one** thing jsdom can't — a real history-back + remount cycle. Pick the cheapest deterministic filter for that, not the most "realistic" one.

**Takeaway (generalises):** to E2E-prove a navigation/URL behaviour, drive it through a **gated** read or pure client-side state. Reserve ungated async reads (search) for tests that can warm/drain the projector first — never as the incidental "how do I click into the thing" step.

## Cost

Feature implementation was clean and one-pass. The entire avoidable cost was the E2E re-cut: one red deploy (#633) + a fix PR + a second deploy (#634). Would have been caught by asking "does any step in this journey depend on an ungated projection returning a fresh write?" before writing it.
