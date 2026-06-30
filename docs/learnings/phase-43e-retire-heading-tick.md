# Phase 43-E — Retiring the heading-✓ "mark as discussed"

**Slice:** remove the legacy floating ✓ "mark as discussed" control on headings — the final slice of Phase 43, which gave notes a first-class **agenda**. PR #376, deploy run 28480430234, live. **Phase 43 complete.**

## The arc worth preserving: heading-as-topic → BUG-37/37b → separate agenda

The app spent three slices trying to make a **heading double as a discussion topic**, then removed it:

1. **Phase 7-B** added a floating ✓ on the active heading that struck it through to mark the topic "discussed" — conflating two different things: *"is this a heading?"* and *"is this a topic to track?"*.
2. **BUG-37** — the ✓ did nothing: `toggleStrike()` on a **collapsed caret** only sets a *stored mark* (strikes the next-typed char), never the existing heading text. Fix: range-select the block first.
3. **BUG-37b** — even after that, the ✓ was unclickable: the editor content (`.contentInput`, `position:relative` for inline images) painted **over** the absolutely-positioned button in the same stacking layer, swallowing the click. Fix: `z-index`. Both bugs were structurally **invisible to jsdom** (no layout/hit-testing) and only caught by a real-browser E2E.
4. **Phase 43** concluded the conflation itself was the defect. Topics-to-discuss became a **separate first-class agenda** (its own events, its own data, in the note header) — so a heading is just a heading again.

43-E deletes the whole heading-✓ mechanism: the floating control + `buttonY`/`updateButton`/`containerRef` wiring + `.discussedButton` CSS + `web/src/lib/headingDiscussed.ts` + its unit test + the `DiscussedTickJourney` E2E.

**Lesson — when a feature needs repeated bug-fixes to make a *conflated* model behave, the model is the bug.** Heading-as-topic took two non-obvious browser-only fixes and still felt wrong; the durable answer was to separate the two concepts, not to keep patching the overlay. The prototype-driven Phase 43 (separate agenda) made the old mechanism redundant, and retiring it leaves "one clear, predictable way to track topics."

## Clean-deletion notes

- **No migration.** Removing the control touches no parser/renderer — StarterKit's strike mark is intact, so old notes keep `~~struck~~` headings as ordinary markdown. Correctly, no migration code was added.
- **Trace every tendril before deleting.** `containerRef` existed *only* to position the floating button (decl + `updateButton` + the `ref` attr); image logic uses different refs — so it went with the button. Grepping `headingDiscussed|markHeadingDiscussed|discussedButton|buttonY|DiscussedTick|"Mark as discussed"` to zero across `web/src` + `tests/Browser.E2E` is what proved the removal complete (no orphaned class/ref/import).
- **A deleted E2E journey is safe to remove when it's self-contained** — `DiscussedTickJourney` used only shared `AppPage` helpers other journeys also use, so nothing else broke; the full solution built green under `-p:TreatWarningsAsErrors=true`.

## Phase 43 retrospective (5 slices, all clean)

Composing the agenda onto `NoteDetailView` (43-A decision) instead of a dedicated store paid off across the whole phase: **zero new tables, zero backfills, deploy-time neutral**, and each later slice (tick, edit/remove) was a small fold + handler with no infra. The two real catches were both **browser-only, jsdom-invisible** bugs found by Hawk (43-C Esc-cancel blur-on-unmount; the historical BUG-37b z-index) — reinforcing that inline-edit/overlay controls need the `editingRef`/`ActionsSection` guard pattern and, ideally, a real-browser check. The recurring **CS8631-under-`TreatWarningsAsErrors`** CI slip (43-A, 43-C) is now a run-pipeline guardrail: build backend locally with that flag.
