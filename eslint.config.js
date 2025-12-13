import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Relaxed rules for existing codebase
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'warn', // Downgrade to warning for stub functions
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'python/**',
      'releases/**',
      'data/**',
      '*.min.js',
    ],
  },
];
