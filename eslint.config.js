import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * The lint gate.
 *
 * AttackFM's gate, cut to the two scopes this tree has: the app under `src/`,
 * and the Node side - `scripts/` and the Vite/Vitest configs. The rules live
 * here once; the scopes only say which globals are in the room.
 *
 * One tier, not two. AttackFM keeps some rules at `warn` because a backlog
 * sits behind them and a gate has to exist while it is worked off. This tree
 * has no backlog - it is five files old - so there is nothing to ratchet:
 * every rule is `error`, and `npm run lint` runs `--max-warnings 0` so a
 * `warn` would fail the gate anyway. Nothing added later gets to start at
 * `warn`. That is how a backlog is born.
 *
 * AttackFM also carries relaxations marked LOAD-BEARING, each one measured
 * against a 105,000-line tree. Those measurements do not transfer, so every
 * relaxation was re-decided here on its own merits. The one kept says why.
 */

/* Everything that is not ours to judge: generated output, vendored code and
   build artefacts. Linting them says nothing about this repo, and editing
   them is lost on the next build.

   `vendor/@glacier` is the sharp one. It is the design kit's PREBUILT dist,
   installed through the `file:` dependencies in `package.json`, and any edit
   there is overwritten the next time the kit is rebuilt and copied in. It
   must never be linted, because a lint finding there invites exactly that
   lost edit. `src-tauri/vendor` is the Rust equivalent: vendored crates. */
const IGNORED = [
  'node_modules/**',
  'dist/**',
  'mcp/dist/**',
  /* Vitest's coverage output. A stray `coverage/` from an older run must not
     be able to add findings to this gate. */
  'coverage/**',
  'vendor/**',
  /* Tauri's generated mobile projects and its build output. `gen/` is
     re-created by `tauri ios init` / `android init`; nothing under it is
     hand-written TypeScript. */
  'src-tauri/gen/**',
  'src-tauri/target/**',
  'src-tauri/vendor/**',
];

/**
 * The rules the whole repo keeps, whatever it is written for.
 *
 * Not listed, because ESLint 10's `recommended` already carries them at
 * error: `no-debugger`, `no-duplicate-case`, `no-useless-assignment`. AttackFM
 * names them because its gate predates that.
 */
const house = {
  /* Also in `recommended`; listed so that the ABSENCE of `allowEmptyCatch` is
     on record. The rule ignores any block that holds a comment, so an empty
     catch is fine when it says why the failure is the expected outcome - and
     that comment is the whole point. An UNcommented empty catch is the one
     thing this house does not write. */
  'no-empty': 'error',

  /* AttackFM allows empty ARROW functions, for 83 `.catch(() => {})`.
     Dropped. The base rule accepts a body that holds a comment, exactly as
     `no-empty` does, so `.catch(() => { // offline is fine })` passes and the
     bare `.catch(() => {})` does not. Same discipline as the catch block
     above, same one-line cost, and nothing to grandfather. */
  '@typescript-eslint/no-empty-function': 'error',

  /* OFF - the one relaxation that survives, and it survives because its
     reason is a compiler flag, not a backlog. `tsconfig.json` sets
     `noUncheckedIndexedAccess`, which types every array and regex-group index
     as `T | undefined` and so FORCES a `!` where the surrounding code has
     already proved the index safe - `parts[1]!`, `lines[i]!`. AttackFM
     measured 168 of its 208 findings as exactly that idiom; the flag is on
     here too, so the idiom is coming. The one `!` in the tree today is the
     root mount in `main.tsx`. Not in `recommended` anyway (it lives in
     `strict`), so this line is a decision on record, not an override. */
  '@typescript-eslint/no-non-null-assertion': 'off',

  /* Free, and it stays at error in tests too: a fixture is the one place
     `any` does real damage, because it silently stops the compiler checking
     the fixture against the shape it is pretending to be. A test that needs a
     malformed input writes `as unknown as Note`, which says the same thing
     and is greppable. */
  '@typescript-eslint/no-explicit-any': 'error',

  /* `== null` is the one comparison `==` says better than `===`: a
     null-or-undefined check in three characters. Everything else is strict. */
  eqeqeq: ['error', 'always', { null: 'ignore' }],

  'no-alert': 'error',
  'no-var': 'error',
  'prefer-const': 'error',

  /* The `_` prefix is the house's way of saying "named for the reader, not
     for the code", and it still is. This must NEVER be extended to
     unreferenced EXPORTS: an over-export used inside its own file is a
     working module, and a sweep there deletes deliberately kept code. */
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],

  /* A relative import names its file, extension and all: `./app/App.tsx`,
     never `./app/App`. AttackFM holds this by hand - 2,448 of its 2,450
     relative imports carry one - and this tree makes it a rule while the
     count is two. `tsconfig.json` sets `allowImportingTsExtensions` for
     exactly this, and Vite resolves either form, so the rule is the only
     thing keeping the two from mixing. Package imports are not touched, and
     a `?raw` query after the extension is fine.

     No alias rule beside it. Neither tsconfig defines `paths`, so `@/x`
     cannot resolve; a convention the compiler already enforces needs no
     second enforcer. */
  'no-restricted-syntax': [
    'error',
    {
      selector:
        ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression)' +
        '[source.value=/^\\.\\.?\\W/]:not([source.value=/\\.[a-zA-Z0-9]+(\\?.*)?$/])',
      message: 'A relative import names its file, extension included: `./app/App.tsx`, not `./app/App`.',
    },
  ],
};

/**
 * The React rules.
 *
 * The glob below is `src/**\/*.{ts,tsx}`, not `*.tsx`. The Vite template
 * scopes this plugin to `.jsx,.tsx`, and copying that would silently check
 * nothing in the files where most custom hooks end up living - a `useX.ts`
 * has no JSX in it and no reason to be a `.tsx`.
 *
 * Only the two classic rules. eslint-plugin-react-hooks 7 also ships
 * `recommended`, which adds the React Compiler's rules - `set-state-in-effect`,
 * `refs`, `purity`, `immutability` and a dozen more. They encode the
 * compiler's contract, and adopting the compiler is a decision the app makes
 * on purpose, not one its lint config makes for it. When it is made, the
 * change is `extends: [reactHooks.configs.recommended]` on the scope below.
 */
const reactRules = {
  /* React counts the hooks a component calls and tears the whole app down
     when the number changes between renders. Not a style opinion. */
  'react-hooks/rules-of-hooks': 'error',

  /* ERROR from the first commit. AttackFM's largest backlog sat behind this
     rule, and its verdict once it was cleared: every finding is answered
     either by a longer dep array or by an annotated disable that names the
     discontinuity the effect keys on - and at `error` the one thing no longer
     available is leaving that answer un-made. */
  'react-hooks/exhaustive-deps': 'error',
};

export default defineConfig([
  globalIgnores(IGNORED),

  /* The app: browser, React, not type-aware - see the note at the foot of
     this file. `tsconfigRootDir` is pinned now so the day type-aware rules are
     wanted, the switch is one key beside it and does not depend on the cwd
     `eslint` happens to run from. */
  {
    files: ['src/**/*.{ts,tsx}', 'mcp/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...house,
      ...reactRules,
      /* ERROR, with no exemption list. AttackFM's `allowExportNames` is fifty
         context hooks and constant tables it chose to keep beside their
         components; this tree has made no such choice yet, and the rule is
         what makes each one a choice. A pure helper beside a component goes
         into a `.ts` sibling, where a test can reach it - that move is where
         AttackFM's ~250 unit tests came from. A context's own hook that
         belongs with its provider gets its name added here, on purpose, with
         the reason beside it. */
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },

  /* The unit-test harness: `src/**\/*.test.{ts,tsx}` and `src/test/`. Not a
     third scope - everything the `src/**` block says still applies. This only
     lifts the three rules that would ask a test file to behave like an
     application file:
     - a stub is allowed to do nothing, arrow or not; in a fixture an empty
       function is the answer, not a question;
     - fast refresh has no meaning in a file the dev server never loads, so a
       wrapper component exported beside a `renderWith()` helper is
       organisation, not a hazard;
     - `renderHook(() => useX())` is how a hook is tested, and rules-of-hooks
       cannot see that Testing Library renders that arrow AS a component.

     NOTE WHAT IS NOT HERE: no `describe`/`it`/`expect` globals. Vitest runs
     with `globals` off, so those names are imported from 'vitest' in every
     test file, and declaring them here would only let a file lint clean and
     then die at run time with "describe is not defined". */
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'mcp/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },

  /* The Node side: the build scripts and the Vite, Vitest and ESLint configs
     (`*.config.*` matches this file, so the gate lints itself). Node globals,
     no React, and `console` is the whole point of a build script. */
  {
    files: ['scripts/**/*.{mjs,js,ts}', '*.config.{ts,mjs,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      ...house,
      /* typescript-eslint's `eslint-recommended` turns these OFF for every
         `.ts`, because for TypeScript the COMPILER catches them. That holds
         for the two configs here today - both are in tsconfig's `include` -
         but a `scripts/*.ts` tomorrow would not be, and would then be checked
         by nothing at all. Handed back so the scope's coverage does not
         depend on a list in another file. (For `.mjs` they were never off.) */
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-import-assign': 'error',
    },
  },
]);

/*
 * Type-aware linting: off, matching the house.
 *
 * AttackFM measured it. Building a full TypeScript program for the typed
 * rules was the single biggest wall-clock cost available to its gate, and it
 * bought roughly four findings: `void` before a deliberately unawaited
 * promise is already the convention there, and `tsc --noEmit` runs beside
 * the linter in `npm run build` here just as it does there. On five files
 * the cost argument is moot, but the gate is the house gate, and the switch
 * is small: `projectService: true` beside `tsconfigRootDir` above, and
 * `tseslint.configs.recommendedTypeChecked` in that scope's `extends`.
 * Re-measure when `src/` has grown enough for the answer to matter.
 */
