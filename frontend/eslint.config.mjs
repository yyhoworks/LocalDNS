import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', '.vite/**', 'coverage/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      // The @typescript-eslint variants stay off for plain JS: the core
      // eslint rules (no-unused-vars, no-unused-expressions via recommended
      // where applicable) already cover these files, and the TS plugin rules
      // assume type information that checkJs does not provide here.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      // no-empty stays off for now: empty catch blocks are an established
      // idiom in this codebase (44 occurrences across features/shared);
      // re-enable once those have been annotated or handled.
      'no-empty': 'off',
      // no-useless-escape stays off for a single legacy occurrence
      // (src/features/shell/interface.js, an escaped hyphen in a regex);
      // re-enable after that file is touched.
      'no-useless-escape': 'off',
      'no-undef': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
);
