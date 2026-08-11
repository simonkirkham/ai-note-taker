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
- **You might not need an effect.** Derive values during render (or `useMemo`) instead of syncing them into state via an effect. Reset state on a prop change with a `key`, not an effect. Put logic triggered by a *user action* in the event handler, not an effect. Don't chain effects that each `setState` to trigger the next. (react.dev — *You Might Not Need an Effect*.) This generalises the existing `set-state-in-effect` guardrail.
- **Never re-evaluate a `keys.*` getter inside an async `queryFn` — use the `queryKey` React Query hands you.** The keys in `api/queryKeys.ts` are getters over the module-global workspace id, so re-reading one *after* an await resolves it at a later moment than the fetch: a request issued for workspace A that lands after a switch reads B's cache and writes the result back under A's key. `queryFn: async ({ queryKey }) => …` is always the key of the query actually being fetched. Same class as the rule below, one level up — the **key** goes stale, not the response (TI-65, PR #459).
- **Every fetch-in-effect must guard against out-of-order responses.** Deps can change before a request resolves — last-fired ≠ last-resolved. Use an `ignore` flag (set in cleanup) or an `AbortController`, and drop the response if stale. An `AbortController` alone is not enough — it cancels the request, not a `.then` already queued. This is the one async-effect bug `set-state-in-effect` does **not** catch.

**TypeScript**
- `"strict": true` is on — no `any` without a documented reason.
- Use discriminated unions for variant state (e.g. `{ kind: "note"; noteId: string } | { kind: "list" }`).
- **No `enum`** — use an `as const` object or a union of string literals. `enum` is not erasable syntax and has inlining hazards; you already prefer discriminated unions, this is the sibling rule.
- **No non-null assertion `!`** — it has no runtime check and lies about nullability. Narrow with a guard or early return instead. (Once `recommended-type-checked` lint lands, `no-non-null-assertion` enforces this — see technical-improvements.)
- **`catch` clauses are `unknown`, not `any`** — a thrown value is not guaranteed to be an `Error`; narrow before use (`if (e instanceof Error)`).

**State and data flow**
- **Optimistic UI updates are mandatory** (CLAUDE.md). A mutation handler updates local state immediately and reconciles on error — never gate the UI on the API response. When adding a new async mutation, mirror the optimistic-first pattern of the nearest existing handler in the same component.
- **A failed optimistic update must be surfaced to the user, never rolled back silently.** When the request fails, undo the local change *and* show the failure (inline message, banner, or toast) so the user knows their action didn't take and can retry. A silent rollback is worse than no optimism — the action appears to vanish. *(Note: there is no general toast/notification primitive yet — only the full-screen `SessionExpiredBanner`. A reusable inline-error/toast component is a known gap; until it exists, surface failures with the nearest available mechanism.)*
- API access goes through the wrappers in `web/src/api.ts`; components do not call `fetch` directly.
- **Never mutate state or props — replace, don't mutate.** Build a new object/array (spread, `map`, `filter`) and pass it to the setter; never `push`/`splice`/assign into existing state. Mutation keeps the same reference, so React skips the re-render and the UI silently goes stale.
- **Non-component modules stay single-domain.** An API/util/store module that spans more than one domain — or grows past ~150 lines — is a smell: split it by domain into a folder (`api.ts` → `api/notes.ts`, `api/folders.ts`, …). Import from the specific module, **not** a barrel `index.ts` (see the *Imports* row — barrels hurt tree-shaking and invite circular deps). Mirrors the backend ">100-line class, more than one reason to change" smell in `dotnet-coding`.

**Accessibility**
- Use semantic HTML; prefer native controls over `div` + `onClick`.
- Add `aria-label` to icon buttons and any interactive element without visible text.
- Keyboard navigation must work: `Tab` to reach, `Enter`/`Space` to activate.
- **Announce async / transient updates via an `aria-live` region** — a visual-only toast or status change is invisible to a screen reader. `ToastProvider.tsx` already wraps its output in a live region; any new ephemeral-notification surface must do the same.
- **Style focus rings with `:focus-visible`, not `:focus`** — shows the ring for keyboard navigation without flashing it on every mouse click.

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

**CSS structure** *(migration complete — Phase 14)*
- **`App.css` no longer exists** — every component is styled by a co-located `*.module.css`. There is no global component stylesheet; do not recreate one.
- Three global stylesheets, imported once at the app root: `styles/tokens.css` (design tokens + `[data-theme]` themes), `styles/global.css` (reset, bare-element base styles, **and a small set of genuinely-shared utility/layout classes** — `.icon-btn`/`.icon-btn--danger`, `.container`, `.header`, `.title`, `.new-note-button`, status messages `.error`/`.empty`/`.loading`, `body.has-notification-banner`, reduced-motion). These shared utilities stay global because multiple components use them; reference them as plain `className="icon-btn"` strings.
- App-shell-exclusive chrome (`.sidebarToggle`, `.sidebarOverlay`, etc.) lives in `web/src/components/App.module.css`.
- A class needed by both a CSS Module and a global/other-module selector (e.g. `.filters-panel`, referenced by `TagFilter.module.css` via `:global(.filters-panel)`) stays a **global contract class** — do not hash it.

**Linting and formatting**
- ESLint flat config is in `web/eslint.config.js` using `typescript-eslint@^8` — do not add `.eslintrc.*` files.
- Prettier config is in `web/.prettierrc` (`singleQuote`, `trailingComma: "es5"`, `printWidth: 100`).
- `lint-staged` runs ESLint + Prettier on staged files via the `.githooks/pre-commit` hook.

**Testing**
- Component unit tests use **Vitest + React Testing Library + jsdom**, kept centrally in `web/src/__tests__/` (one `*.test.tsx` per component). Run with `npm --prefix web test`. Assert on user-visible behaviour, not internals; mock network via the handlers in `web/src/test/`.
- **Unit-test query priority: `getByRole` → `getByLabelText` → `getByText`, with `getByTestId` a last resort.** Role/label queries assert accessibility at the same time. *(This is the **unit**-test rule and does not conflict with the E2E rule below: Playwright E2E still selects on `data-testid` — jsdom applies no CSS, so a `data-testid` is the stable cross-layer contract there.)*
- **Use `userEvent` over `fireEvent`** — it simulates the full interaction sequence (focus, key events, visibility/disabled checks) a real user triggers.
- End-to-end journeys use **Playwright (C#)** in `tests/Browser.E2E/` (BDD-style, gated on `FRONTEND_URL`). When adding a new user journey, add or extend a journey there.
- **E2E selectors must use `data-testid`, NEVER a CSS class.** jsdom unit tests don't apply CSS, so a class that a Playwright journey selects on (e.g. `.note-card`) will pass every unit test but break the real-browser E2E on deploy if the class is renamed/hashed (this exact thing red-lined the pipeline during the CSS-Modules migration — CSS Modules hash class names). Keep a stable `data-testid` on any element an E2E journey needs to find. When renaming/removing a class, grep `tests/Browser.E2E/` for it.
- New or changed components ship with a matching `__tests__/*.test.tsx`; new user journeys ship with a `Browser.E2E` journey.

**No comments**
- Same rule as the C# codebase: no comments unless the WHY is non-obvious.

## Broader conventions (industry standards adopted here)

Conventions drawn from established style guides (Airbnb, Google, GitHub Primer) and current React/Vite practice. New code follows these; existing code migrates opportunistically.

| Area | Standard |
|---|---|
| **Component files** | One component per file; co-locate `Component.tsx` with its `Component.module.css`. Test files live centrally in `web/src/__tests__/` (see *Testing*). Prefer **named exports**; avoid barrel `index.ts` re-export files (they hurt tree-shaking and invite circular deps). |
| **Imports** | **Enforced** by `import-x/order` (`eslint-plugin-import-x` — the ESLint-10-compatible fork; `eslint-plugin-import` peer-caps at ESLint 9): builtin → external → internal (`@/*`) → parent/sibling/index, alphabetised; `eslint --fix` auto-orders. Use the **`@/` alias** (Vite `resolve.alias` + tsconfig `paths`) over deep `../../..`. Side-effect imports (global CSS) are left in place — keep `tokens.css`/`global.css` first in `main.tsx`. *(Not yet enforced: `import-x/no-unresolved`/`no-cycle`, and `jsx-a11y` — blocked on ESLint 10 support; see technical-improvements.)* |
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
- [ ] No non-component module mixes unrelated domains or exceeds ~150 lines (split by domain into a folder; import the specific module, no barrel)
- [ ] No fetch-in-effect without an out-of-order guard (`ignore` flag or `AbortController`); state derived in render where possible, not synced via an effect
- [ ] State/props never mutated — setters get a fresh object/array (spread/`map`/`filter`)
- [ ] No `enum`, no non-null `!`; `catch` clauses typed `unknown` and narrowed
- [ ] Unit tests prefer `getByRole`/`getByLabelText` over `getByTestId`, and `userEvent` over `fireEvent`
- [ ] Transient/async notifications announced via an `aria-live` region; focus rings use `:focus-visible`
- [ ] Async mutations update local state optimistically, reconcile on error, and **surface the failure** to the user (no silent rollback)
- [ ] Any HTML passed to `dangerouslySetInnerHTML` is sanitised via the shared DOMPurify helper
- [ ] New user journeys have a corresponding journey in `tests/Browser.E2E/`
- [ ] No `.eslintrc.*` files added

## Reference

Full standards: `docs/react-coding-standards.md`
