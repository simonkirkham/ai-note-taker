import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importX from 'eslint-plugin-import-x'
// jsx-a11y@6.10.2 declares an eslint peer range topping out at v9, but runs
// fine on this project's eslint v10. A scoped package.json `overrides` entry
// (eslint-plugin-jsx-a11y → eslint: "$eslint") keeps `npm ci` green without a
// repo-wide legacy-peer-deps. Remove the override once jsx-a11y ships v10 support.
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { fileURLToPath } from 'node:url'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      // 19-B: type-aware linting. parserOptions.project (below) covers both app and
      // test sources so `eslint src` resolves every .ts/.tsx without a
      // "file not included in project" parser error.
      ...tseslint.configs.recommendedTypeChecked,
      jsxA11y.flatConfigs.recommended,
      prettier,
    ],
    // Type-checked rules need every linted file to be in a tsconfig `project`.
    // tsconfig.app.json/tsconfig.test.json only include `src`, so scope this block
    // there; root tooling configs (vite.config.ts) are handled by the block below.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.test.json'],
        tsconfigRootDir,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'import-x': importX,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // 19-B: surface every remaining non-null `!`; the two justified ones carry a
      // scoped disable. Not in recommended(-type-checked), so enable it explicitly.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // BUG-60: leaving the SPA must go through lib/hardRedirect, which exists so a test can prove a
      // redirect did NOT happen (jsdom refuses to let window.location be stubbed). Without this rule
      // the guarantee is convention-only: a future inline assignment would silently make the
      // storage-refusal guard untested while every test still passed.
      'no-restricted-syntax': ['error', {
        selector: "AssignmentExpression > MemberExpression[property.name='href'][object.property.name='location']",
        message: 'Use hardRedirect() from lib/hardRedirect — an inline location.href assignment cannot be asserted against in jsdom (BUG-60).',
      }],
      // Import ordering (14-R). Side-effect imports (e.g. global CSS in main.tsx)
      // are NOT reordered by this rule, preserving the stylesheet cascade.
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        pathGroups: [{ pattern: '@/**', group: 'internal' }],
        pathGroupsExcludedImportTypes: ['builtin'],
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
    },
  },
  // Root tooling configs (vite.config.ts) live outside `src` and so outside the
  // tsconfig projects. Lint them with the non-type-checked rules only — applying a
  // type-checked rule here would error with "file not included in project".
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
  },
  {
    // BUG-60: the one place allowed to assign location.href — that is this module's entire purpose.
    files: ['src/lib/hardRedirect.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  // 19-B: test sources keep type-checked linting on, but a handful of typed rules
  // fire on idiomatic test code rather than real defects and are relaxed here (test
  // tier only — production `src/**` keeps them at `error`):
  //  - require-await: MSW handlers / mock callbacks must stay `async` to satisfy a
  //    Promise-returning signature even with no inner await; stripping `async` would
  //    break the contract.
  //  - no-non-null-assertion: `container.querySelector(...)!` / `getByX(...)!` on a
  //    fixture the test itself guarantees is present.
  //  - unbound-method: passing a spy/mock method as a callback in assertions.
  //  - restrict-plus-operands / no-unsafe-*: loosely-typed test fixtures and spies.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
)
