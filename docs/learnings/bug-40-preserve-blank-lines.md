# BUG-40 — preserving user blank lines in a markdown-backed editor

**Slice:** BUG-40 (PR #363, deploy #666 `70c87c4`). Frontend-only.

## The trap (reusable)

A rich-text field stored as **markdown** silently destroys a user's intentional vertical spacing. Markdown represents a paragraph break as exactly **one** blank line and has **no representation** for an empty paragraph or multiple consecutive blank lines. So a serialize→parse round-trip collapses every run of blank lines to one — the loss happens **client-side at serialize time**, not anywhere downstream (the API, events, projection, DynamoDB all faithfully store the already-condensed string). Any tiptap-markdown / prosemirror-markdown content field has this property. If users structure notes with blank lines, the storage format alone determines whether that survives.

## The fix

Override the paragraph node's markdown **serialize** to emit a single non-breaking space (`U+00A0`) line for an empty paragraph (`web/src/lib/blankLineParagraph.ts`):
- The ` ` line survives markdown-it's round-trip (kept as its own block) and tiptap normalises it back to a genuinely **empty** paragraph on reload — the user sees a real blank line, no visible character, and re-saving is idempotent.
- Registered by disabling StarterKit's bundled paragraph (`StarterKit.configure({ paragraph: false })`) and adding the extension. Only `serialize` is overridden; `parse`, commands, shortcuts inherit. `getMarkdownSpec` merges the override over tiptap-markdown's default, so parsing is untouched.

### The non-obvious refinement — guard on *last child*
Emit the placeholder **only when the empty paragraph is not the last child of its parent**. A *trailing* empty paragraph is the editor's caret affordance (tiptap keeps one after a list/blockquote/etc), not user structure. Without the guard:
- every note ending in a list/blockquote persisted a stray `U+00A0` line, and
- a fully-cleared note saved a non-breaking-space body instead of empty.

The prosemirror-markdown serialize signature is `(state, node, parent, index)` — `index === parent.childCount - 1` is the last-child test; `parent`-undefined falls back to "don't emit" (conservative). Trailing blanks are insignificant in markdown anyway, so dropping them matches norms. This edge only surfaced by **probing** list/blockquote/empty-doc cases after the happy path passed — Hawk flagged the cleared-note case; the stray-trailing-after-list case was found by writing the probe.

## Dependency note
Adding `@tiptap/extension-paragraph` to extend the base node: pin it **exactly** to the StarterKit-transitive version (`3.23.4`), matching the existing `@tiptap/extension-image` exact pin. A floated `^3.23.4` resolves up to a newer minor whose `peer @tiptap/core` conflicts with the pinned core → ERESOLVE (the known tiptap pinning trap in CLAUDE.md).

## Process lessons (this session)
- **Don't edit on `main` to "just reproduce".** The first instinct was to drop a probe test into the main checkout — the user (rightly) stopped it. Reproduction and any code go in a worktree; bugs get filed in `phase-bugs.md` first and run through the pipeline. The repro belongs *in* the slice's spec, not loose on main.
- **Fetch `origin/main` before branching.** Local `main` was diverged (stale doc commits) from a parallel-advanced `origin/main`; the slice branch inherited the stale commits and the PR went `CONFLICTING`. Fix: rebuild the slice cleanly onto `origin/main` (`git reset --hard origin/main` + cherry-pick only the slice commits) so the PR carries exactly its own files. Re-confirms the standing "fetch before planning" memory.
- **Scribe/doc edits from a clean `origin/main` worktree** when local `main` is diverged — never push the diverged local main.

## Verification gap (deferred, not fixed)
A blank-line note's card preview can carry a literal `U+00A0` (`MarkdownStripper.Strip` doesn't remove it). Harmless — downstream `string.IsNullOrWhiteSpace` treats `U+00A0` as whitespace, so a blank-only body still falls back cleanly. Left out to keep the fix frontend-only (a strip would widen to a backend deploy). File as a minor change if the preview gap is ever noticed.
