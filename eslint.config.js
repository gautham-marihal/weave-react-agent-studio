import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// ESLint reads this file (the "flat config"). The studio is plain JavaScript with JSX (React 19, Vite); its tests and scripts run in Node, and the component tests
// bring a browser-like page (jsdom), so they get both sets of globals.
export default [
  { ignores: ['dist/**', 'node_modules/**', '.vite/**', 'public/**', 'tests/fixtures/**', 'tests/component/.build/**'] },
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
    rules: {
      // the two rules of hooks the code already relies on (it has eslint-disable comments for them)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // a component used only as <Name /> is "used"; without the React plugin, a name that starts with a capital letter is taken to be one
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // `try { … } catch {}` is how this code says "storage may be blocked, carry on"
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**', 'e2e/**', 'scripts/**', 'vite.config.js', 'llmRoute.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
