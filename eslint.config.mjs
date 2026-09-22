import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat config (ESLint 9 requires it). This repo shipped `.eslintrc.json` with ESLint 9, which
 * made `npm run lint:eslint` exit non-zero with "couldn't find an eslint.config.js" — and CI
 * swallowed that with `|| echo "eslint warnings"`, so the gate silently did nothing.
 * `.eslintrc.json` is deleted; if you need editor support, ESLint 9 reads this file only.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'server.js', 'coverage/**', 'api/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly', fetch: 'readonly',
        AbortController: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', process: 'readonly',
        URL: 'readonly', Buffer: 'readonly', Response: 'readonly', RequestInit: 'readonly',
        HTMLElement: 'readonly', HTMLCanvasElement: 'readonly', ResizeObserver: 'readonly',
        WebSocket: 'readonly', CustomEvent: 'readonly', NodeJS: 'readonly', performance: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
    rules: {
      // Base rules that duplicate/conflict with TS-aware checking (standard for TS projects):
      // `no-undef` is the compiler's job, and base `no-unused-vars` double-reports types.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // The rules that were actually being paid for in the old config:
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-async-promise-executor': 'error',
      'require-await': 'off',
    },
  },
];
