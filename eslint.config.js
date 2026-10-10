/**
 * ESLint 9 flat config — migration of the legacy .eslintrc.js.
 *
 * Audit (Step 17): `npm run lint` has been failing outright since ESLint was
 * bumped to v9 (it only reads eslint.config.*), so no lint gate existed at all.
 * The rules below mirror the previous config so behaviour is comparable.
 *
 * Known limitation recorded in docs/PRELAUNCH_AUDIT.md: `no-floating-promises`
 * needs type-aware linting (parserOptions.project) and therefore cannot run in
 * a workspace-agnostic flat config; it is left off here rather than emitting
 * a fatal error for every file.
 */
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.d.ts',
      'backend-preview/**',
      'eslint.config.js',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        global: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        fail: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // typescript-eslint's own recommendation: no-undef is redundant (and
      // noisy) on TypeScript files — `tsc --noEmit` in the gate covers it.
      'no-undef': 'off',
      // Banning any is critical for a financial app — use unknown + type guards instead
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Tests legitimately use jest mocks/fakes; keep them typed but permissive.
  {
    files: ['**/test/**/*.ts', '**/__tests__/**/*.ts', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
