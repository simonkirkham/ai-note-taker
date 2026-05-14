# Frontend / React Coding Standards (summary)

This document collects conventions and recommended tooling for the frontend (React + TypeScript) in this repo. It is intentionally pragmatic: focus on readability, accessibility, and testability.

Sources

- React docs — https://react.dev/
- TypeScript handbook — https://www.typescriptlang.org/docs/
- Airbnb React/JSX Style Guide — https://github.com/airbnb/javascript/tree/master/react
- eslint-plugin-react, eslint-plugin-jsx-a11y, @typescript-eslint
- WCAG / accessibility resources — https://www.w3.org/WAI/

Principles

- Clarity: prefer explicit, well-named code over clever shortcuts.
- Accessibility (a11y): make interactive elements keyboard- and screen-reader friendly by default.
- Predictability: follow React hooks rules and stable dependency arrays (use `useCallback`, `useMemo` where appropriate).
- Testability: components should be small, pure where practical, and easily unit-tested with React Testing Library.
- Tooling: enforce style with ESLint, Prettier, and CI checks; run Playwright for E2E journeys.

Project conventions

Folder layout (recommended)

- `src/` — app code
  - `components/` — presentational components (small, focused)
  - `views/` or `pages/` — page-level containers and routes
  - `hooks/` — shared custom hooks
  - `lib/` — small utilities and API wrappers
  - `styles/` — global styles, theme, tokens
  - `tests/` — shared test helpers and fixtures

Component design

- Use PascalCase for components (e.g., `NoteCard`, `NoteList`).
- Keep components small and focused: prefer composition over large monoliths.
- Prefer function components and hooks; avoid class components.
- Props: prefer a single props object and explicit prop types via TypeScript interfaces.
- Prefer controlled components for forms where the parent must manage state; use controlled/uncontrolled patterns consistently.

Hooks

- Follow the Rules of Hooks: call hooks unconditionally and in the same order.
- Use `useCallback` and `useMemo` to stabilize callbacks and derived values passed to children when needed for performance or to satisfy `useEffect` dependencies.
- Keep hook dependency arrays correct; prefer listing dependencies explicitly, not suppressing ESLint warnings.
- Encapsulate shared logic in custom hooks under `src/hooks/`.

TypeScript

- Use `"strict": true` in `tsconfig.json` for new code. Avoid `any` unless there's a clear, documented reason.
- Prefer explicit return types for exported functions and component props where it helps readability.
- Use discriminated unions for variant props/state when appropriate.

Accessibility (a11y)

- Use semantic HTML and ARIA roles where necessary; prefer native controls.
- Ensure keyboard navigation and focus management for interactive widgets.
- Add accessible labels (`aria-label`, `aria-labelledby`) and test with tools like axe or Lighthouse.

Styling

- Pick one CSS strategy and be consistent across the repo: CSS Modules, Tailwind utility classes, or a CSS-in-JS library.
- Keep styles local to components when possible; avoid globals except for theme tokens and resets.

Testing

- Unit + integration: React Testing Library for component tests, assert on user-visible behaviour rather than internals.
- E2E: Playwright for user journeys (use the `tests/E2E` harness already present).
- Mock network calls in unit tests; prefer test fixtures for deterministic results.

Linting & formatting

- Use ESLint with these plugins: `@typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-jsx-a11y`, `eslint-plugin-import`.
- Use Prettier for formatting and keep ESLint for semantics. Run both in pre-commit hooks via `lint-staged` + `husky`.

Performance & bundling

- Use code-splitting for large routes (React.lazy + Suspense) and avoid shipping large libraries to critical paths.
- Prefer memoization only when measured as necessary; premature optimization leads to complexity.

CI & tooling

- Add `npm run lint`, `npm run format`, `npm test`, and `npm run e2e` to CI.
- Use `dotfiles`/`.editorconfig` to keep editor behaviour consistent for indentation and trailing whitespace.

Quick config snippets
ESLint (`.eslintrc.json`) minimal starter:

```
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "settings": {
    "react": { "version": "detect" }
  }
}
```

Prettier (`.prettierrc`) minimal:

```
{
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100
}
```

How to apply

1. Add or update `.editorconfig`, `.eslintrc.json`, and `.prettierrc` at the repo root.
2. Add `lint-staged` + `husky` for pre-commit checks and a CI job that runs `npm run lint` and `npm test`.
3. Review PRs for accessibility, stable hooks usage, and tests that assert behaviour rather than implementation details.

Links and further reading

- React: https://react.dev/
- TypeScript: https://www.typescriptlang.org/
- Airbnb React/JSX Style Guide: https://github.com/airbnb/javascript/tree/master/react
- Accessibility: https://www.w3.org/WAI/
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

---

This summary is concise; consult the linked references for deeper guidance and examples.
