# Learnings: 11-A — Tag autocomplete

- `useTagSuggestions` returned Related and Common lists without deduplication. A tag with high co-occurrence AND high noteCount could appear in both groups, producing duplicate React `key` props and undefined reconciliation behaviour. The tests deliberately sized allTags to prevent overlap, which masked the production bug entirely. **Action:** Added "a tag qualifying for both Related and Common appears exactly once" test to `TagsSection.test.tsx`; deduplication fixed in `useTagSuggestions` via a `relatedTags: Set<string>` exclusion — Done.

- WAI-ARIA combobox pattern requires `role="combobox"`, `aria-controls` pointing to the listbox `id`, `aria-activedescendant` pointing to the highlighted option's `id`, and `role="option"` elements with stable `id` attributes. Without `aria-activedescendant`, screen readers cannot announce the highlighted suggestion on `ArrowDown`. **Action:** Added "custom dropdown: must wire role=combobox, aria-controls, aria-activedescendant, id on listbox and each option" row to the React/TypeScript code smells table in the refactor skill — Done.

- Group headings nested inside `<li role="option">` are announced as part of the option value by screen readers (e.g. "option: Related Design") and are accidentally submittable on click. The WAI-ARIA grouped listbox pattern uses separate `<li role="presentation">` siblings for headings. **Action:** Added a test for the heading-as-presentation-sibling pattern; component refactored to `flatMap` — Done.

- When writing tests that deliberately avoid a data configuration (e.g. "sized allTags to prevent Related+Common overlap"), always add a companion test that forces the avoided case. A comment explaining why data was sized a certain way is a signal that the edge case needs its own test. **Action:** Companion overlap-dedup test added — Done.

- The `react-hooks/set-state-in-effect` lint failure on PR #77 required a hotfix PR (#80) after merge. `npm --prefix web run lint` is already item 4 in Pip's pre-PR checklist (per phase-10c learnings), but the hotfix was needed anyway because #77 merged before the pattern was documented. No new action required — Documented.

## Applied status

| Learning | Status |
|---|---|
| 1. Related+Common dedup | Applied — `useTagSuggestions.ts` filter + `TagsSection.test.tsx` overlap test |
| 2. WAI-ARIA combobox attributes | Applied — refactor skill SKILL.md React/TS smells table updated |
| 3. Group headings as sibling li | Applied — `TagsSection.tsx` `flatMap` refactor + heading rendering updated |
| 4. Companion test for avoided edge cases | Applied — overlap-dedup test added to `TagsSection.test.tsx` |
| 5. Lint gate on PR #77 | Documented — lint already in pre-PR checklist; hotfix was for a pre-existing merged commit |
