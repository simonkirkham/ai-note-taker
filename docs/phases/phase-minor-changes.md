# Phase Minor Changes — Tweaks backlog

**Goal:** A standing, unnumbered phase that captures small tweaks and changes that aren't worth a numbered phase of their own and aren't defects. Like the bugs phase, it has no learning theme and no fixed slice sequence — items are added as they surface and marked Done as they ship. Each change still goes through the normal pipeline: a spec/test where behaviour changes, then the change.

**What belongs here:** small, self-contained adjustments to existing behaviour or appearance — a copy change, a default tweaked, a control relabelled, a spacing fix. If it introduces genuinely new user-facing capability it's a **feature** ([docs/future-features.md](../future-features.md) → a numbered phase). If it's a defect, it's a **bug** ([docs/phases/phase-bugs.md](phase-bugs.md)). If it's a refactor, upgrade, or CI/infra item, it's a **technical improvement** ([docs/technical-improvements.md](../technical-improvements.md)).

**Learning surface:** none specific — this is polish and maintenance work.

---

## Summary

| Item | Summary | Status | Depends on |
|------|---------|--------|------------|
| CHANGE-1 | Single-spaced note lines by default | Done | — |
| CHANGE-2 | Theme selection (Teal / Forest / Midnight) | Done | — |
| CHANGE-3 | Home screen shows today's notes by default | Done | — |
| CHANGE-4 | To-do rows wrap cleanly with long text + note title | Done | — |
| CHANGE-5 | Sign-in screen visual polish | Done | — |
| CHANGE-6 | Collapsible "Filters" control for home tags | Done | — |
| CHANGE-7 | More colour schemes; drop duplicate Forest theme | Done | CHANGE-2 |
| CHANGE-8 | Theme picker + Sign out always visible without scrolling | Done | CHANGE-2 |
| CHANGE-9 | Restructure home Filters: Show-older + Tags inside, fix gap | Done | CHANGE-3, CHANGE-6 |
| CHANGE-10 | Refine home: hide tag labels, icon card/to-do actions, boxless filter tags, simpler calendar | Done | — |
| CHANGE-11 | Preview pull-out `»` becomes `«` when its panel is open | Done | — |
| CHANGE-12 | Drop home Notes divider; top-align with Today's Meetings | Done | — |
| CHANGE-13 | "Next occurrence" button inside a recurring-meeting note | Done | 9-F |
| CHANGE-14 | Rename transcription "Call audio" toggle to "Record screen-share audio" | Done | — |
| CHANGE-15 | Keyboard access for `FolderPreviewPanel` hover items — open a note via keyboard, not only mouse/drag (surfaced by the 19-F3 jsx-a11y gate; currently a justified scoped disable) | Done | — |
| CHANGE-16 | Pin `@tiptap/extension-link` directly in `web/package.json` — 19-J imports it but it is still transitive via StarterKit, so a future StarterKit bump dropping it would break the import (unmet 19-J acceptance criterion) | Done | — |
| CHANGE-17 | Case-insensitive tags — force all tags to lowercase; `Foo`/`foo` are one tag everywhere (add, dedupe, filter, index) | Done | — |
| CHANGE-18 | Tag-search box in the home Filters panel that filters the displayed tag pills (lists >8 tags) | Done | — |
| CHANGE-19 | Auto-show "older notes" when a tag filter is applied; revert when the filter is cleared | Done | — |
| CHANGE-20 | Search highlight uses the same word-level matcher as the gate — `MatchedTokens`/`MatchedTags` still pick displayed terms via FuzzySharp `Process.ExtractTop` (substring) while inclusion uses BUG-35's word-level rules; reuse `BestTokenScore` so the highlighted term/snippet always reflects why the note matched | Done | BUG-35 |
| CHANGE-21 | Label the active calendar source on the Home meetings list — `ICalendarClient.ProviderName` surfaced on `GET /calendar/{date}` as `provider`; a small "Outlook"/"Google Calendar" badge under the meetings heading (stub/unknown → no label) | Done | Phase 32 |
| CHANGE-22 | Analysis observability — `IDomainMetrics.AnalysisCompleted(ms)`/`AnalysisFailed()` (EMF `AnalysisDurationMs`/`AnalysisFailed`, dimensionless); `AnalyseNote` times the Bedrock call and logs the failing note id; `notetaker-analysis-failed` alarm + a "p50/p99 vs failures" dashboard widget. Covers manual + on-Stop auto-analyse; carries into the 33-B2 analysis service | Done | — |
| CHANGE-23 | Persist home list filters in the URL so Back from a note restores them — search query + selected tags + AND/OR mode + show-older move from `ListView` local state to `?q=&tag=&mode=&older=` via `useSearchParams`; filter writes use `replace`, opening a note pushes | Done | — |
| CHANGE-24 | Surface the "Move to workspace" control on the note detail page (not just the card) — reuse `MoveToWorkspaceMenu` in `NoteView`'s header next to Delete; gated on `hasContent` + other workspaces existing; moving navigates back to the workspace home (the note has left this workspace) | Done | 23-F |
| CHANGE-25 | Always-available calendar connect/change/disconnect — a gear "Calendar settings" toggle in the Meetings header opens an inline panel (Connect Google / Connect Outlook / Disconnect). Previously the connect buttons rendered **only** in the meetings-"unavailable" state, which the SSM fallback hides in prod → in-app connect was unreachable. Disconnect is optimistic + invalidates the connection/meetings queries. | Done | 34-C |
| CHANGE-26 | Outlook connect supports **work/school** M365 accounts + an account picker — default the MS tenant `consumers` (personal-only) → `common` (work + personal) in `buildMicrosoftAuthUrl` + `MicrosoftOAuthClient` + `MicrosoftCalendarClient`, and switch `prompt=consent` → `prompt=select_account` so a different account can be chosen even when the browser already has a Microsoft session. `MS_TENANT_ID`/`VITE_MS_TENANT_ID` still override. Requires the Entra app "Supported account types" = any-tenant + personal (already set). | Done | 34-C |
| CHANGE-27 | Redesign the note-detail Tags + Actions area as a **Command Bar** so the editor goes **full-width** (the fixed 320px sidebar is deleted). One slim bar under the title: tags as inline chips + autocomplete (left), an `✓ Actions · done/total` pill (right) that opens a **floating popover** checklist. Pill turns teal when all done; popover closes on outside-click/Esc, stays open on inner edits. Design locked via prototype `prototype/tags-actions-sidebar` (Command Bar). See confirmed GWT below. | Not Started | — |
| CHANGE-28 | Note **body text is too big** — editor `.contentInput` is 16px (1rem) / line-height 1.75. **Prototype** a smaller size, tighter line-height, alternate font(s), then apply. Appearance only. | Open | — |

Open: CHANGE-27 (Command Bar — design locked, ready to implement), CHANGE-28 (notes body text — needs prototype).

New tweaks are appended as a one-line shipped record below once Done. The full spec/Value/Approach for each lived in this doc during the slice and remains in git history; the durable *why* (where any) is in the learnings archive. CHANGE-1 to CHANGE-4 were moved here from the former "Phase 13 — UI Polish II" once it was clear they were minor tweaks rather than a distinct phase.

---

## CHANGE-27 — Command Bar (confirmed design)

**Value:** the note-detail editor reclaims the full width (the 320px right sidebar dominated the screen and made tags+actions feel heavier than the note). Tags and actions move to one slim bar under the title; nothing pushes page height.

**Design (locked via prototype `prototype/tags-actions-sidebar`, "Command Bar"):**
1. Delete the `1fr 320px` grid in the note-detail layout → single full-width editor column.
2. A **Command Bar** sits directly under the title, above the tabs: one line, `space-between`.
   - **Left — Tags:** a tag glyph + inline removable chips (`× `), then a dashed `＋ Tag` ghost that becomes the existing tag combobox input (autocomplete, lowercase-normalised per CHANGE-17) on click. Many tags → the row scrolls horizontally; the bar stays one line.
   - **Right — Actions:** a pill `✓ Actions · {done}/{total}`. The count is always visible. Click → a floating popover (absolute, anchored to the pill, internal scroll, `max-height` capped) holding the checklist (toggle / delete) + an add-input.
3. **All-done state:** when `total > 0` and `open === 0`, the pill renders in primary-teal (icon + count), and the popover header count is teal too.
4. **Popover dismissal:** closes on click outside it and on `Esc`; clicks inside (toggle/add/delete) keep it open; it stays open after adding so several items can be entered.
5. Crisp inline SVG icons (tag / check / chevron / plus) — no emoji.
6. **Mobile** (narrow widths): the popover renders as a bottom sheet rather than a floating anchor.

**Implementation notes:** pure frontend relocation — reuse `TagsSection` combobox logic (`useTagSuggestions`, `onAdd`/`onRemove`) and `ActionsSection` data/mutations (`useActions`, `useActionMutations`) verbatim; no API, event-model, or projection changes. Remove the `<aside>` sidebar + grid in `NoteView`/`NoteTabs.module.css`; new `CommandBar`/actions-popover components. Optimistic updates retained (tag pill + action toggle reflect immediately; pill count derives from the same query so it moves optimistically). No `localStorage`.

**GWT scenarios:**
- **Full-width editor:** Given a note is open, When it renders, Then the editor spans the full content width and no 320px sidebar exists.
- **Tags visible + add:** Given a note has tags, When the bar renders, Then each tag shows as a chip with a remove ×; When I click `＋ Tag` and type, Then the autocomplete suggests existing tags and Enter adds the (lowercased) tag as a chip optimistically.
- **Remove tag:** Given a tag chip, When I click its ×, Then the chip disappears immediately (optimistic) and reconciles on the server response.
- **Actions count always visible:** Given a note with N actions (M done), When the bar renders, Then the pill reads `✓ Actions · M/N` without opening anything.
- **Open/close popover:** Given the pill, When I click it, Then the actions popover opens anchored to it; When I click outside the popover or press Esc, Then it closes; When I click a checkbox/add/delete inside it, Then it stays open.
- **Toggle + add + delete:** Given the popover is open, When I tick an item, Then it strikes through and the pill count updates; When I add an item, Then it appears and the popover stays open; When I delete an item, Then it is removed optimistically.
- **All-done state:** Given all actions are complete (`total > 0`), When the last one is ticked, Then the pill and popover-header count render in primary-teal; When one is reopened, Then they revert to neutral.

**Acceptance criteria:**
- Editor is full-width on the note-detail screen; the right sidebar is removed.
- Tag add/remove and action toggle/add/delete are optimistic (BDD must assert the optimistic update).
- Pill count is always visible and updates without opening the popover.
- Popover closes on outside-click and Esc; stays open on inner interactions and after adding.
- All-done teal state toggles correctly with `open === 0 && total > 0`.
- No backend/event-model/projection change; existing tag + action endpoints reused.

Confirmed UX detail captured in the prototype's `web/src/prototype/REFERENCE.md` (on `prototype/tags-actions-sidebar`). Real implementation rebuilds fresh on a `slice/` branch from these GWTs — it does not copy prototype code.

---

## Shipped

Each line: **item — what shipped — PR / deploy.** Learnings (where captured) are in [docs/learnings/_archive.md](../learnings/_archive.md).

- **CHANGE-26** — Outlook connect now works for **work/school** M365 accounts and shows an account picker. MS tenant default `consumers` (personal-only) → `common` (work + personal) across `buildMicrosoftAuthUrl` + `MicrosoftOAuthClient` + `MicrosoftCalendarClient` (all three must agree or refresh → `invalid_grant`); `prompt=consent` → `prompt=select_account`. `MS_TENANT_ID`/`VITE_MS_TENANT_ID` still override. No secret needed — the Entra app was already "Any Entra ID Tenant + Personal Microsoft accounts". New `microsoftAuthUrl.test.ts` guards tenant + prompt + offline_access. PR #342, deployed 2026-06-25.

- **CHANGE-1** — Single-spaced note lines (`.content-input p { margin: 0 }`; pure styling, no event change). PR #98, deployed 2026-06-02.
- **CHANGE-2** — Theme selection (Teal / Forest / Midnight). PR #102, deployed 2026-06-02.
- **CHANGE-3** — Home screen defaults to today's notes. PR #101, deployed 2026-06-02.
- **CHANGE-4** — To-do rows wrap cleanly with long text + note title (prototype `prototype/todo-row-wrap`, implemented verbatim). PR #104, deployed 2026-06-02.
- **CHANGE-5** — Sign-in screen visual polish. PR #109, deployed 2026-06-02.
- **CHANGE-6** — Collapsible "Filters" control for home tags. PR #111, deployed 2026-06-02.
- **CHANGE-7** — 12 themes (8 light, 4 dark); Forest dropped as a Teal duplicate. PR #112 + contrast follow-up #114, deployed 2026-06-02.
- **CHANGE-8** — Theme picker + Sign out always visible without scrolling. PR #119, deployed 2026-06-02.
- **CHANGE-9** — Restructured home Filters (Option D: rich collapsed summary + Tags/Other groups). PR #121, deployed 2026-06-02.
- **CHANGE-10** — Home refinement: icon card/to-do actions, hidden tag labels, boxless filter tags, lighter calendar (6 confirmed changes). PR #129, deployed 2026-06-02.
- **CHANGE-11** — Preview pull-out `»`↔`«` reflecting panel open state. PR #126, deployed 2026-06-02.
- **CHANGE-12** — Dropped home Notes divider; top-aligned with Today's Meetings. PR #123, deployed 2026-06-02. (Branch/commit keep "minor-10"; renumbered CHANGE-12 at Scribe after a concurrent-session numbering collision.)
- **CHANGE-13** — "Next occurrence" control inside a recurring-meeting note (option 1: reverse lookup on `CalendarLinkView`). PR #162, deployed 2026-06-04.
- **CHANGE-14** — Transcription audio toggle relabelled "Call audio" → "Record screen-share audio". PR #164, deployed 2026-06-04.
- **CHANGE-15** — `FolderPreviewPanel` note rows converted from click/drag-only `<li>` to real `<button>` (keyboard-openable, `:focus-visible` ring, drag-to-move preserved); scoped jsx-a11y disable removed. PR #247, deployed 2026-06-11.
- **CHANGE-16** — `@tiptap/extension-link` promoted from transitive (via starter-kit) to a direct `^3.23.4` dependency, closing the unmet 19-J acceptance criterion. Manifest-only, no behaviour change. PR #283, deployed 2026-06-13.
- **CHANGE-18** — Tag-search box in the home Filters panel (`tag-filter-search`); renders only when `tags.length > 8`, narrows displayed pills case-insensitively, view-only (selection/note-filtering unaffected). Local state in `TagFilter`. PR #313, deployed 2026-06-22.
- **CHANGE-19** — Auto-show older notes when a tag filter is applied; clearing reverts only the auto-enable. Explicit `olderAutoEnabled` flag distinguishes filter-driven from user-driven, so a manual untick or pre-existing "older ON" preference is respected. State set in user-action handlers (not a `useEffect`). PR #313, deployed 2026-06-22.
- **CHANGE-17** — Case-insensitive tags. `TagNormalization.Normalize` (`Trim().ToLowerInvariant()`) applied in the `Note` aggregate and every tag-bearing projection fold; events unversioned (value-only). PR #308 + E2E #309, deployed 2026-06-22. **The mandatory prod projection rebuild was initially missed** — 6 legacy mixed-case tags (incl. a split `Crosslake`/`crosslake`) lingered until `POST /admin/projections/rebuild` was run 2026-06-22; post-rebuild scan confirmed 0 mixed-case rows, `Crosslake` merged into `crosslake`. See [_minor-log](../learnings/_minor-log.md).
- **CHANGE-20** — Search highlight reuses the gate's word-level matcher. Extracted `TermTokenScore` as the single definition of "term matches token", shared by the inclusion gate (`BestTokenScore`) and the highlight/snippet path (`TopMatches`); `MatchedTokens`/`MatchedTags` rank by it instead of FuzzySharp `Process.ExtractTop`. Tags tokenized in the highlight path to match the gate (a note admitted on the second word of a multi-word tag now highlights that word). Removed dead `TokenMatchThreshold`/`MinTokenLength`. Backend-only, query-time — no rebuild. PR #314, deployed 2026-06-22.
- **CHANGE-23** — Home list filters (search query, selected tags, AND/OR mode, show-older) moved from `ListView` local state into URL query params (`?q=&tag=&mode=&older=`) via `useSearchParams`; filter writes use `replace`, opening a note pushes — so browser Back restores the populated filters (also makes filtered views reloadable/shareable). New shared `renderWithRouter` test helper (ListView now needs a Router); `UrlFilters.test.tsx` proves restore+write for all four. PR #333, deployed 2026-06-24. **The first E2E (`SearchBackNavigationJourney`) flaked the deploy gate** — it opened the note from `/notes/search` (an ungated async projection) so a just-created note lagged the reload window (deploy #633 red); re-cut as `FilterBackNavigationJourney` driving the *gated* home-card list via the show-older filter (PR #334, deploy #634 green). See [phase-23-url-filters-back](../learnings/phase-23-url-filters-back-navigation.md).
- **CHANGE-25** — Always-available "Calendar settings" gear in the Meetings header opens an inline panel: Connect Google / Connect Outlook / Disconnect. Closes the gap where the connect buttons rendered **only** in the meetings-"unavailable" state, which the global SSM fallback hides in prod — so in-app calendar connect (the whole point of Phase 34) was unreachable. Disconnect is optimistic (clears the "Connected as" header immediately) + invalidates the connection/meetings queries; status line reads "Connected as …" / "Using {provider}" (fallback-served) / "No calendar connected". Frontend-only — the connect/disconnect endpoints already existed (34-A/B/C). PR #338, deployed 2026-06-24.
