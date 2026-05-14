# Frontend / React Skill

Purpose

- Provide a concise skill for contributors working on the frontend (React + TypeScript) in this repo.
- Point to the canonical `docs/react-coding-standards.md` and key external references.

When to use

- Implementing or changing UI components, hooks, or styling.
- Reviewing PRs for UI, accessibility, or test coverage.
- Adding or updating E2E journeys (Playwright) or component tests.

What this skill contains

- Link to the repo standard: `docs/react-coding-standards.md`.
- Quick PR reviewer checklist and suggested local commands.

Quick checklist (use in PR descriptions)

- [ ] Component names use PascalCase and files match exported names.
- [ ] Hooks follow the Rules of Hooks and dependency arrays are correct.
- [ ] Accessibility: semantic HTML, ARIA labels where needed, keyboard navigation.
- [ ] Unit tests use React Testing Library and assert behaviour.
- [ ] E2E flows (Playwright) for user journeys are present when required.
- [ ] Linting and formatting pass: `npm run lint` and `npm run format`.
- [ ] No large sync/blocking computations on the main thread.

Commands

- Install deps: `npm install` or `pnpm install` / `yarn install` (follow repo preference).
- Lint: `npm run lint` (ESLint + TypeScript checks)
- Format: `npm run format` (Prettier)
- Unit tests: `npm test` (Jest + React Testing Library)
- E2E: `npm run e2e` (Playwright)

Authoritative references

- React: https://react.dev/
- TypeScript: https://www.typescriptlang.org/
- ESLint + React rules: https://github.com/jsx-eslint/eslint-plugin-react
- Accessibility: https://www.w3.org/WAI/
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

Notes for reviewers

- Prefer small, behavior-only changes in the same PR; large formatting-only changes should be separate.
- If a deviation from the style guide is needed, add a short justification in the PR description.

File: docs/react-coding-standards.md
