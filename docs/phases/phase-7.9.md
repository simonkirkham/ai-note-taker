# Phase 7.9 — UI Polish

**Goal:** A collection of targeted UX improvements that make the app feel faster and more intentional to use. No new events, no new aggregates — these are pure-frontend slices that build on what already exists.

**Learning surface:** Component-level autocomplete patterns in React; client-side ranking and relevance algorithms; accessible keyboard navigation in custom dropdowns.

---

## Slice order and dependencies

```
7.9-A  Tag autocomplete ── independent ──────────────────────────────────────────
```

---

## Slice 7.9-A — Tag autocomplete and suggestions

**Status:** Not Started

**Value:** Tag entry becomes fast and consistent. Typing the first few characters surfaces matching tags from the existing vocabulary so users don't create near-duplicates ("job-hunting" vs "JobHunting"). When the input is empty, the most-used tags appear as one-click shortcuts; notes that already have tags get a curated "Related" list derived from tag co-occurrence.

**Backend changes:** None. `GET /tags` already returns every tag with `noteCount` and `noteIds[]`. The frontend fetches this index once on mount and does all ranking client-side.

---

### How the suggestions work

**When the user is typing:**

1. **Prefix matches** — tags that begin with the typed prefix (case-insensitive), ordered by `noteCount` descending.
2. **Substring matches** — tags that contain but do not start with the prefix (case-insensitive), ordered by `noteCount` descending.

The two groups are shown in order (prefix first) with no heading. Together they form a deduplicated, ranked list. Already-applied tags on the current note are excluded at every step.

**When the input is empty (focus state):**

- **Common** — top 8 tags by `noteCount`, excluding already-applied tags. Shown with a "Common" heading.
- **Related** — shown only when the note already has at least one tag. Algorithm:
  1. Collect `noteIds` from every already-applied tag using the in-memory tag index.
  2. For every tag in the index, count how many of its `noteIds` overlap with that set.
  3. Remove already-applied tags and any tag with zero overlap.
  4. Sort descending by overlap count; take the top 5.
  - Shown with a "Related" heading, above Common.

**Keyboard behaviour:**

| Key | Action |
|-----|--------|
| `↓` / `↑` | Move highlight through the dropdown |
| `Tab` or `→` (when a suggestion is highlighted) | Complete the input with the highlighted tag |
| `Tab` (nothing highlighted, suggestions open) | Complete with the first suggestion |
| `Enter` | Submit the current input text (same as today) if nothing is highlighted; submit the highlighted suggestion if one is |
| `Escape` | Close the dropdown; do not change the input |

Mouse click on a suggestion submits that tag immediately (same as pressing Enter on it).

The dropdown closes after any submission and when focus leaves the input.

---

### Key implementation files

- `web/src/components/TagsSection.tsx` — rewrite to accept `allTags: TagIndexEntry[]`; add dropdown state; keyboard nav; Tab completion
- `web/src/hooks/useTagSuggestions.ts` — new hook: derives the ranked suggestion list from `(input, allTags, appliedTags)`; memoised with `useMemo`
- `web/src/components/NoteView.tsx` — pass `allTags` down to `<TagsSection />`; fetch from `getTags()` on mount (or receive from parent if already fetched)

---

### Scenarios

```
Scenario: Prefix match narrows suggestions
  Given existing tags include "JobHunting" and "JavaScript"
  When  I type "Job" in the tag input
  Then  "JobHunting" appears in the suggestion list
  And   "JavaScript" does not appear

Scenario: Substring match shown after prefix matches
  Given existing tags include "Hunting" and "JobHunting"
  When  I type "hunt" in the tag input
  Then  "Hunting" appears before "JobHunting" in the list
  And   both are visible

Scenario: Tab completes with the top suggestion
  Given "JobHunting" is the first suggestion
  When  I press Tab
  Then  the input is filled with "JobHunting"
  And   the dropdown closes
  And   the input is not yet submitted

Scenario: Tab submits the completed tag
  Given the input reads "JobHunting" after Tab-completion
  When  I press Tab again
  Then  "JobHunting" is added as a tag on the note
  And   the input clears

Scenario: Common tags shown on empty focus
  Given the note has no tags
  And   existing tags include "Work" (5 notes) and "Personal" (3 notes)
  When  I focus the tag input without typing
  Then  "Work" appears before "Personal" in the Common suggestions

Scenario: Related tags shown when note already has tags
  Given the note has tag "Project-Alpha"
  And   other notes tagged "Project-Alpha" also have tags "Design" and "Sprint"
  When  I focus the tag input without typing
  Then  "Design" and "Sprint" appear under a Related heading

Scenario: Already-applied tags excluded from all suggestion lists
  Given the note already has the tag "Work"
  When  I view suggestions (empty input or typing)
  Then  "Work" does not appear in the list

Scenario: Keyboard navigation moves the highlight
  Given the dropdown shows three suggestions
  When  I press ↓ twice
  Then  the third suggestion is highlighted

Scenario: Enter on a highlighted suggestion submits that tag
  Given the second suggestion "Design" is highlighted
  When  I press Enter
  Then  "Design" is added as a tag
  And   the input clears and the dropdown closes

Scenario: Escape closes the dropdown without changing the input
  Given the dropdown is open with input "Jo"
  When  I press Escape
  Then  the dropdown closes
  And   the input still reads "Jo"

Scenario: Clicking a suggestion submits it immediately
  Given "Design" appears in the suggestion list
  When  I click "Design"
  Then  "Design" is added as a tag and the dropdown closes
```

---

### Acceptance criteria

- [ ] Typing in the tag input shows a ranked dropdown (prefix matches above substring matches, each group sorted by `noteCount` desc)
- [ ] Tab on an open dropdown completes the input with the top (or highlighted) suggestion; pressing Tab again submits it
- [ ] `↑` / `↓` navigate the dropdown; highlighted item wraps at top/bottom
- [ ] Enter submits the highlighted suggestion (or the raw input if nothing is highlighted)
- [ ] Escape closes the dropdown without submitting
- [ ] Clicking a suggestion submits it
- [ ] Empty focus state shows Common (top 8 by count) and Related (top 5 by co-occurrence, only when note has tags)
- [ ] Already-applied tags never appear in suggestions
- [ ] `useTagSuggestions` is a pure function of `(input, allTags, appliedTags)` — no side effects, testable in isolation
- [ ] All existing `TagsSection` component tests remain green
- [ ] New component tests cover: prefix ranking, substring ranking, Tab completion, keyboard nav, Related algorithm, exclusion of applied tags

---
