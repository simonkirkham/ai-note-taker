---
name: frontend-react
description: Project-specific React/TypeScript conventions for the web/ frontend. Covers component structure, hooks rules, optimistic state, CSS Modules styling (design tokens, theming, the App.css→modules migration), accessibility, security, performance, imports, and test guidance. Load before writing or reviewing any file in web/src/.
---

# Frontend / React Skill

## When to load

Load before writing or reviewing any `.tsx` / `.ts` file in `web/src/`. This skill covers code conventions — for visual polish, load `ui-ux-pro-max` instead.

## Project-specific rules

**Component naming and structure**
- PascalCase for components; filename must match the exported component name (`NoteCard.tsx` for `export function NoteCard`).
- Prefer small, focused components over large monoliths — compose from smaller pieces.
- Function components only; no class components.

**Hooks**
- Follow the Rules of Hooks: call unconditionally and in the same order.
- Keep `useEffect` dependency arrays complete — do not suppress ESLint warnings with `// eslint-disable`.
- Encapsulate shared logic in custom hooks.

**TypeScript**
- `"strict": true` is on — no `any` without a documented reason.
- Use discriminated unions for variant state (e.g. `{ kind: "note"; noteId: string } | { kind: "list" }`).

**State and data flow**
- **Optimistic UI updates are mandatory** (CLAUDE.md). A mutation handler updates local state immediately and reconciles on error — never gate the UI on the API response. When adding a new async mutation, mirror the optimistic-first pattern of the nearest existing handler in the same component.
- **A failed optimistic update must be surfaced to the user, never rolled back silently.** When the request fails, undo the local change *and* show the failure (inline message, banner, or toast) so the user knows their action didn't take and can retry. A silent rollback is worse than no optimism — the action appears to vanish. *(Note: there is no general toast/notification primitive yet — only the full-screen `SessionExpiredBanner`. A reusable inline-error/toast component is a known gap; until it exists, surface failures with the nearest available mechanism.)*
- API access goes through the wrappers in `web/src/api.ts`; components do not call `fetch` directly.

**Accessibility**
- Use semantic HTML; prefer native controls over `div` + `onClick`.
- Add `aria-label` to icon buttons and any interactive element without visible text.
- Keyboard navigation must work: `Tab` to reach, `Enter`/`Space` to activate.

**Styling / CSS** — *the standard is **CSS Modules**. A migration is in progress (see below).*
- **New or substantially-changed components use a co-located CSS Module.** `NoteCard.tsx` ships with `NoteCard.module.css` in the same folder; import it as `import styles from "./NoteCard.module.css"` and reference classes as `styles.card`. Vite supports this natively — no new dependency. Scoping is automatic; class collisions cannot happen.
- **Local class names inside a module are `camelCase`** (`styles.cardHeader`, `styles.isActive`) — they are accessed as JS properties, so camelCase reads naturally and avoids `styles["card-header"]` bracket syntax.
- **Two global stylesheets only**, imported once at the app root:
  - `web/src/styles/tokens.css` — the `:root` design tokens and every `[data-theme="…"]` theme block.
  - `web/src/styles/global.css` — reset and bare-element base styles (`body`, `a`, `button` defaults) only.
  No other global CSS. A component never adds a global rule.
- **Design tokens are CSS custom properties.** Colours, `--radius`, and `--transition` are defined as `--*` variables (today in `App.css`, moving to `tokens.css`). Module rules reference them with `var(--…)` — **never hard-code a colour, radius, or transition value.** A literal `#0D9488` in a module is a bug: it breaks theming and the cascade.
- **A `--space-*` spacing scale does not exist yet** — define one (e.g. `--space-1: 4px` … `--space-6: 48px`) in `tokens.css` as part of the migration, then forbid hard-coded margins/padding the same way. Until those tokens exist, the no-hard-code rule covers colour/radius/transition only.
- **Theming is token override, nothing else.** Each theme is a `[data-theme="…"]` block in `tokens.css` that re-declares the *same* token set; `useTheme` sets `data-theme` on the root and the whole UI reskins through the cascade. Adding a theme means adding one `[data-theme]` block — no per-component theme rules.
- **Theme is applied *before* React mounts to avoid a flash (FOUC).** An inline `<script>` in `web/index.html` reads the saved theme from `localStorage` and sets `data-theme` on `documentElement` before the bundle loads, so a non-default-theme user never sees a teal flash. **Footgun:** that script hardcodes its own list of valid theme names — when you add or rename a theme in `useTheme`, you must update the `index.html` script too, or the new theme gets the FOUC bug on first load. *(Future nicety: the bootstrap only honours a saved choice; it could fall back to `prefers-color-scheme` for first-time visitors with no stored theme.)*
- **Compose conditional classes with `clsx`** — `className={clsx(styles.card, isActive && styles.isActive)}`. `clsx` is the standard CSS-Modules pairing; add it as a `web/` dependency if not present.
- **Responsive is mobile-first** (base styles, then `min-width` media queries) and **honours `prefers-reduced-motion`**.
- **No `!important` in your own modules** — restructure the selector to win specificity instead. The one carve-out is overriding a third-party library's injected styles (e.g. Tiptap): keep those vendor overrides isolated in a clearly-labelled block/file so the exception is obvious, never scattered through component modules.
- **Every class defined in a module must be referenced** via `styles.x` in its component; an unreferenced class is dead and should not be committed.

**CSS migration status** *(legacy → CSS Modules)*
- `web/src/App.css` is the **legacy** global stylesheet (flat kebab-case BEM-ish classes). It is being retired, not extended.
- **Do not add new rules to `App.css`.** New styling goes in a CSS Module.
- **When you substantially touch a component still styled by `App.css`, migrate it** in the same PR: move its rules into a co-located `*.module.css`, convert class names to camelCase, swap the JSX `className` strings to `styles.*`, and delete the migrated rules (and any now-dead selectors) from `App.css`.
- The tokens/reset blocks currently at the top of `App.css` move to `styles/tokens.css` and `styles/global.css` as part of the first migration PR. Full migration is planned as a near-term dedicated effort — until then the codebase is a deliberate hybrid.

**Linting and formatting**
- ESLint flat config is in `web/eslint.config.js` using `typescript-eslint@^8` — do not add `.eslintrc.*` files.
- Prettier config is in `web/.prettierrc` (`singleQuote`, `trailingComma: "es5"`, `printWidth: 100`).
- `lint-staged` runs ESLint + Prettier on staged files via the `.githooks/pre-commit` hook.

**Testing**
- Component unit tests use **Vitest + React Testing Library + jsdom**, kept centrally in `web/src/__tests__/` (one `*.test.tsx` per component). Run with `npm --prefix web test`. Assert on user-visible behaviour, not internals; mock network via the handlers in `web/src/test/`.
- End-to-end journeys use **Playwright (C#)** in `tests/Browser.E2E/` (BDD-style, gated on `FRONTEND_URL`). When adding a new user journey, add or extend a journey there.
- New or changed components ship with a matching `__tests__/*.test.tsx`; new user journeys ship with a `Browser.E2E` journey.

**No comments**
- Same rule as the C# codebase: no comments unless the WHY is non-obvious.

## Broader conventions (industry standards adopted here)

Conventions drawn from established style guides (Airbnb, Google, GitHub Primer) and current React/Vite practice. New code follows these; existing code migrates opportunistically.

| Area | Standard |
|---|---|
| **Component files** | One component per file; co-locate `Component.tsx` with its `Component.module.css`. Test files live centrally in `web/src/__tests__/` (see *Testing*). Prefer **named exports**; avoid barrel `index.ts` re-export files (they hurt tree-shaking and invite circular deps). |
| **Imports** | Order builtin → external → internal. *(Proposed — not yet enforced: add `eslint-plugin-import` to automate the ordering, and configure an `@/` path alias in Vite `resolve.alias` + tsconfig `paths` to replace deep `../../..` chains. Until then, follow the ordering manually and keep relative paths.)* |
| **Prop & event naming** | Boolean props read as predicates (`isOpen`, `hasError`, `shouldFocus`). The callback **prop** is `onX` (`onSelect`); the handler **implementation** is `handleX` (`handleSelect`). |
| **State & data** | Distinguish **server state** (fetched, cached — goes through `web/src/api.ts`) from **local UI state** (`useState`). Mutations are optimistic (see *State and data flow*). Don't scatter ad-hoc `fetch` + `useEffect` + loading-flag triples across components — encapsulate in a hook. |
| **Rendering** | Stable list `key`s — never the array index for a reorderable/removable list. Guard conditional render with booleans, not numbers (`list.length > 0 && …`, never `list.length && …`). |
| **TypeScript** | `strict` on; no `any` without a documented reason. Discriminated unions for variant state. Explicit return types on exported **utility** functions — but **not** on React components (let inference handle them; annotating `: JSX.Element` wrongly rejects valid `null`/string/fragment/array returns). `import type { … }` for type-only imports. |
| **Accessibility** | Semantic HTML over `div`+`onClick`; `aria-label` on icon-only controls; visible focus; manage focus on route/dialog changes. The Rules of Hooks **are** enforced (`eslint-plugin-react-hooks` is active). *(Proposed — not yet installed: add `eslint-plugin-jsx-a11y` to the lint gate so these a11y rules are machine-enforced rather than advisory.)* |
| **Performance** | Memoise (`useMemo`/`useCallback`/`memo`) only when measured. Note that `React.memo` is pointless unless the props it receives are **stable references** — wrap function/object/array props in `useCallback`/`useMemo`, or the memoised component re-renders anyway. **Code-split** heavy, non-critical deps with `React.lazy` + `Suspense` (e.g. the Tiptap editor, `@aws-sdk/client-transcribe-streaming`) to protect the initial bundle. |
| **Error handling** | Wrap route/feature roots in an **error boundary** so one crash doesn't blank the app. No silently swallowed `catch` — log or surface (see the Audio `console.warn` rule). |
| **Security** | If/when you render HTML via `dangerouslySetInnerHTML` (e.g. Tiptap/markdown output), **sanitise it with DOMPurify first**, called through **one shared helper** (e.g. `renderSafeHtml()`) so sanitising can't be skipped ad hoc — never call `DOMPurify.sanitize` inline in scattered places. (Not used today — guardrail for when it's added; DOMPurify is not yet a dependency.) Any external `target="_blank"` link must include `rel="noopener noreferrer"` (prevents tabnabbing; a linter won't catch it). Never commit secrets/tokens to frontend code; read config only from `import.meta.env`. |
| **Config & env** | Vite env vars are `import.meta.env.VITE_*`; anything not prefixed `VITE_` is not exposed to the client and must not be relied on in the browser. |

## Commands

```bash
# Run from repo root (CLAUDE.md convention — never cd into web/)
npm --prefix web run lint      # ESLint check
npm --prefix web run format    # Prettier write
npm --prefix web run build     # TypeScript + Vite build
npm --prefix web test          # Vitest + RTL component tests
npm --prefix web run dev       # Dev server (port 5173)
```

## Audio in the browser

- Do **not** use `AudioContext.createScriptProcessor` — it is deprecated. Use `AudioWorkletNode` with a data-URL worklet module (`data:application/javascript,...`) or a static file in `public/`.
- **`getDisplayMedia` must be requested before any `await` that follows the user's click** (credentials, `getUserMedia`, etc.) — it requires the click's *transient user activation*, and intervening awaits can let that window expire, making the prompt fail silently.
- **`getDisplayMedia` must request `video: true` even when you only want audio** — Chromium rejects an audio-only display capture with `NotSupportedError`. Request a video track to obtain the audio one, use only `getAudioTracks()`, and leave the (unused) video track alone; do **not** stop it early, as that can tear down the audio capture too. A jsdom mock cannot catch this — verify display/media capture in a real Chromium browser before marking the slice Done.
- **A best-effort capability that degrades silently must still be observable.** When a `catch` swallows a failure to fall back (e.g. screen-share denied → mic-only), log it with `console.warn` so the degrade is visible in DevTools rather than invisible.

## Checklist (run before opening a PR)

- [ ] Component filename matches exported name (PascalCase)
- [ ] No `useEffect` dependency array suppressions
- [ ] Icon buttons and unlabelled interactive elements have `aria-label`
- [ ] Keyboard navigation works (Tab + Enter/Space)
- [ ] `npm --prefix web run lint` passes with zero errors (re-run after every fix commit, not just after the initial implementation pass)
- [ ] `npm --prefix web run build` passes
- [ ] `npm --prefix web test` passes; new/changed components have a matching `*.test.tsx` in `web/src/__tests__/`
- [ ] New/changed component styling is a co-located CSS Module (`*.module.css`) — **no new rules added to `App.css`**
- [ ] If a touched component was still styled by `App.css`, its rules were migrated to a module in this PR
- [ ] CSS rules use `var(--…)` tokens — no literal colours/radii/transitions hard-coded (and no literal spacing once `--space-*` tokens exist); no `!important` in your own modules
- [ ] Every class in a module is referenced via `styles.*` (no dead classes)
- [ ] Async mutations update local state optimistically, reconcile on error, and **surface the failure** to the user (no silent rollback)
- [ ] Any HTML passed to `dangerouslySetInnerHTML` is sanitised via the shared DOMPurify helper
- [ ] New user journeys have a corresponding journey in `tests/Browser.E2E/`
- [ ] No `.eslintrc.*` files added

## Reference

Full standards: `docs/react-coding-standards.md`
