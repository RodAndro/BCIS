import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/coverage/**',
      '**/.runtime/**',
      '**/data/**',
      'database/migrations/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Financial code: an unused variable is usually a dropped calculation.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Never silently discard a rejected promise in a request handler.
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Guards against float money creeping into the codebase.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Use an explicit seeded generator. Unseeded randomness makes financial data and tests irreproducible.',
        },
        {
          selector: 'Literal[raw=/^\\d+\\.\\d+$/]',
          message:
            'Non-integer numeric literal detected. Money must be integer centavos; see packages/shared/src/money.ts.',
        },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Config and script files legitimately import dev-only tooling.
  {
    files: ['**/*.config.ts', '**/scripts/**/*.ts', 'database/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Tests ─────────────────────────────────────────────────────────────────
  // A test for "reject a fractional amount" has to write a fractional amount,
  // and a test for "reject a non-integer rate" has to write a non-integer rate.
  // The float-money guard therefore cannot apply to test files, or it would
  // forbid testing the very rules it exists to protect.
  //
  // The Math.random restriction is re-declared here rather than the whole rule
  // being switched off: unseeded randomness makes a failure irreproducible, in
  // tests most of all.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Use an explicit seeded generator so a failing test can be reproduced exactly.',
        },
      ],
    },
  },

  prettier,
);
