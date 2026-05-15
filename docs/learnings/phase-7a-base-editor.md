---
name: phase-7a-base-editor
description: TipTap WYSIWYG editor integration — uncontrolled editor pattern, stale-closure fix, type augmentation, regex ordering, markdown stripping
metadata:
  type: project
---

# Phase 7-A Learnings — Base editor, markdown storage, stripped preview

## 1. Always set `immediatelyRender: false` in TipTap v3

TipTap v3's `useEditor` defaults to `immediatelyRender: true`, which generates a React 18 hydration mismatch warning in strict mode even in non-SSR apps. Always set it:

```tsx
const editor = useEditor({
  immediatelyRender: false,
  extensions: [...],
});
```

**Done:** Added to `NoteEditor.tsx`. Should be in any future TipTap component from the start.

---

## 2. `tiptap-markdown` requires a manual TypeScript module augmentation

`tiptap-markdown` does not augment `@tiptap/core`'s `Storage` interface, so `editor.storage.markdown` is unknown to TypeScript. The fix is a project-local `.d.ts` file — not a cast:

```ts
// web/src/tiptap.d.ts
import "@tiptap/core";
declare module "@tiptap/core" {
  interface Storage {
    markdown: { getMarkdown: () => string };
  }
}
```

TypeScript picks this up automatically from `src/` without an explicit import. Extend it as more TipTap extensions are added (e.g., Strike storage in 7-B).

**Done:** `web/src/tiptap.d.ts` created. No more `cast-through-unknown`.

---

## 3. TipTap editor pattern: uncontrolled with `key`, guarded by loading state

TipTap/ProseMirror manages its own internal state. Attempting to sync external React state via `useEffect` + `editor.commands.setContent()` creates update loops and fights the editor's internal state machine. The correct pattern:

1. Guard: render `NoteEditor` only after content has loaded (`loadingDetail === false`) — ensures the editor mounts with the correct initial value
2. Key: use `key={noteId}` so React remounts the editor (with fresh content) when the user switches notes
3. Let it be uncontrolled: `content` prop is used only at construction time; `onChange` keeps the parent's state in sync for the blur handler

Do NOT add a `useEffect` to call `editor.commands.setContent()` reactively.

---

## 4. Stale closure risk: replace `e.currentTarget.value` reads with a ref

The old `<textarea onBlur={(e) => editContent(noteId, e.currentTarget.value)} />` read the DOM value directly — always current. When replaced with a component that updates React state via `onChange`, the `onBlur` closure can capture stale state due to React 18 event batching.

**Fix pattern:** maintain a `ref` that mirrors state and is updated synchronously in `onChange`:

```tsx
const contentRef = useRef("");
// in onChange:
onChange={(md) => { contentRef.current = md; setContent(md); }}
// in onBlur:
onBlur={() => editContent(noteId, contentRef.current)}
```

**Rule:** whenever a `onChange`/`onBlur` pair is introduced and `onBlur` needs the latest value, use a ref — do not close over React state.

---

## 5. StripMarkdown regex ordering and completeness

The regex pipeline must respect markdown precedence to avoid partial stripping:

1. **Bold (`**`) before italic (`*`)** — otherwise bold regex leaves a `*` that the italic regex then strips incorrectly
2. **Task items (`- [x]`) before bullets (`- `)** — task pattern is more specific; it must match first
3. **Always include ordered lists (`1. item`)** — TipTap's StarterKit includes `OrderedList` by default; without a `^\s*\d+\.\s+` regex, numbered lists appear verbatim in card previews

All regexes should be `static readonly` with `RegexOptions.Compiled` on any method called per-request in a Lambda handler.

---

## 6. TipTap unit testing: mock the editor component as a textarea stub

TipTap/ProseMirror requires a real browser layout engine and doesn't initialise correctly in jsdom. The correct strategy:

- Unit tests: `vi.mock('../components/NoteEditor', ...)` with a `<textarea>` stub that mirrors the props contract (`value`, `onChange`, `onBlur`). Existing save-on-blur and content-load tests continue to pass unchanged.
- Browser/E2E: verify real keyboard shortcuts and editor behaviour in Playwright or manual testing post-deploy.

Do not attempt to render a real TipTap editor in Vitest/jsdom.

---

## Done actions applied this slice

All immediately applicable — no TODOs remaining for human.
