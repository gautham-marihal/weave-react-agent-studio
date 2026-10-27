import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

// ESLint reads this file (the "flat config"). The studio is React 19 on Vite, in JavaScript (JSX) moving to TypeScript a file at a time; its tests and scripts
// run in Node, and the component tests bring a browser-like page (jsdom), so they get both sets of globals.
const sharedRules = {
  // the two rules of hooks the code already relies on (it has eslint-disable comments for them)
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
  // `try { … } catch {}` is how this code says "storage may be blocked, carry on"
  'no-empty': ['error', { allowEmptyCatch: true }],
};
// a component used only as <Name /> is "used"; without the React plugin, a name that starts with a capital letter is taken to be one
const unusedVars = ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }];

export default [
  { ignores: ['dist/**', 'node_modules/**', '.vite/**', 'public/**', 'tests/fixtures/**', 'tests/component/.build/**', 'src/api/agentConfig.d.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...sharedRules, 'no-unused-vars': unusedVars },
  },
  // TypeScript: the same rules, read by the TypeScript parser, with its recommended checks (the type checker itself runs as `npm run typecheck`)
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...sharedRules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVars,
      // a type is imported as a type (`import type`), so Node can run a .ts file by stripping its types
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
    },
  },
  {
    files: ['tests/**', 'e2e/**', 'scripts/**', 'mock-bank/**', 'vite.config.js', 'llmRoute.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // SonarQube's own analyzer for JavaScript and TypeScript (SonarSource's rules, as SonarQube runs them), with its recommended set. Switched off are the
  // ones that would only rewrite how this code is deliberately written, not find anything wrong in it:
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    ...sonarjs.configs.recommended,
    rules: {
      ...sonarjs.configs.recommended.rules,
      // a choice of words or parts in a nested `a ? b : c`, and a template inside a template, are how this code writes its sentences (Prettier lays them out)
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/no-nested-template-literals': 'off',
      // a score for a whole function: the pages are large components and the models long pure functions, on purpose (one place per screen or rule)
      'sonarjs/cognitive-complexity': 'off',
      // `while ((m = pattern.exec(text)))` is how this code walks the matches of a pattern
      'sonarjs/no-nested-assignment': 'off',
      // a named `any` says what the value is (the facts of a call, a config) where its type is not written yet
      'sonarjs/redundant-type-aliases': 'off',
      // the same rule as the core no-unused-vars above, without its `_name` and rest-sibling conventions
      'sonarjs/no-unused-vars': 'off',
      // slow patterns matter where a stranger's text reaches a server; in the studio a pattern only reads what the person typed, or their own config, in
      // their own browser (the two files that run in the dev server keep the rule, below)
      'sonarjs/super-linear-regex': 'off',
    },
  },
  {
    files: ['llmRoute.js', 'vite.config.js'],
    rules: { 'sonarjs/super-linear-regex': 'error' },
  },
  // tests and their fake servers: random data, example addresses and an ftp:// link as the wrong kind of address are what they are testing with
  {
    files: ['tests/**', 'e2e/**'],
    rules: { 'sonarjs/pseudo-random': 'off', 'sonarjs/no-hardcoded-ip': 'off', 'sonarjs/no-clear-text-protocols': 'off' },
  },
  // the Telephony page is left as it is
  {
    files: ['src/pages/Telephony.jsx'],
    rules: { 'sonarjs/pseudo-random': 'off' },
  },
  // last: Prettier owns the layout, so any rule about formatting is switched off and the two never disagree
  prettierConfig,
];
