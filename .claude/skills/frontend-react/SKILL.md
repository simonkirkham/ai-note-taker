---
name: frontend-react
description: Project-specific React/TypeScript conventions for the web/ frontend. Covers component structure, hooks rules, accessibility, linting, and E2E test guidance. Load before writing or reviewing any file in web/src/.
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

**Accessibility**
- Use semantic HTML; prefer native controls over `div` + `onClick`.
- Add `aria-label` to icon buttons and any interactive element without visible text.
- Keyboard navigation must work: `Tab` to reach, `Enter`/`Space` to activate.

**Linting and formatting**
- ESLint flat config is in `web/eslint.config.js` using `typescript-eslint@^8` — do not add `.eslintrc.*` files.
- Prettier config is in `web/.prettierrc` (`singleQuote`, `trailingComma: "es5"`, `printWidth: 100`).
- `lint-staged` runs ESLint + Prettier on staged files via the `.githooks/pre-commit` hook.

**Testing**
- This project has no React Testing Library unit tests. Frontend correctness is verified via Playwright E2E in `tests/E2E/`.
- When adding a new user journey, add or extend an E2E spec in `tests/E2E/`.

**No comments**
- Same rule as the C# codebase: no comments unless the WHY is non-obvious.

## Commands

```bash
# Run from repo root (CLAUDE.md convention — never cd into web/)
npm --prefix web run lint      # ESLint check
npm --prefix web run format    # Prettier write
npm --prefix web run build     # TypeScript + Vite build
npm --prefix web run dev       # Dev server (port 5173)
```

## Audio in the browser

- Do **not** use `AudioContext.createScriptProcessor` — it is deprecated. Use `AudioWorkletNode` with a data-URL worklet module (`data:application/javascript,...`) or a static file in `public/`.
- Every new CSS selector must have a matching `className` prop in the rendered JSX. Verify with grep: `grep -n "className=\"my-selector\"" web/src/` — if no match, the selector is dead.

## Checklist (run before opening a PR)

- [ ] Component filename matches exported name (PascalCase)
- [ ] No `useEffect` dependency array suppressions
- [ ] Icon buttons and unlabelled interactive elements have `aria-label`
- [ ] Keyboard navigation works (Tab + Enter/Space)
- [ ] `npm --prefix web run lint` passes with zero errors (re-run after every fix commit, not just after the initial implementation pass)
- [ ] `npm --prefix web run build` passes
- [ ] Every new CSS class selector has a matching `className` prop in the JSX
- [ ] New user journeys have a corresponding E2E spec in `tests/E2E/`
- [ ] No `.eslintrc.*` files added

## Reference

Full standards: `docs/react-coding-standards.md`
