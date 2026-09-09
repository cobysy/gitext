import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import stylistic from '@stylistic/eslint-plugin';

// Every control-statement body is braced, and every opening brace starts its own
// line (Allman style) rather than trailing the statement that introduces it.
// `@stylistic/indent` runs alongside `@stylistic/brace-style` so the line a brace
// moves to is also reindented to match: the bare core `brace-style` fixer moves
// the token but leaves the surrounding indentation wrong.
const braceStyleRules = {
  curly: ['error', 'all'],
  '@stylistic/brace-style': ['error', 'allman', { allowSingleLine: false }],
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  // The brace-style fixer relocates `{` to its own line but leaves the space that
  // used to separate it from the statement above; this strips that leftover.
  '@stylistic/no-trailing-spaces': 'error'
};

// No conditional expressions anywhere: every branch is a full if/else so the
// two outcomes read as two statements rather than as an inline value swap.
// `no-lonely-if` collapses `else { if (...) {...} }` into `else if (...) {...}`,
// which is what a ternary chain (`a ? x : b ? y : z`) becomes once converted.
const ternaryRules = {
  'no-ternary': 'error',
  'no-lonely-if': 'error'
};

export default [
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: {
      '@stylistic': stylistic
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        MouseEvent: 'readonly',
        Event: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      ...braceStyleRules,
      ...ternaryRules
    }
  },
  // `flat/base` only wires up the Vue SFC parser (so the `<script>` block's braces
  // are reachable at all): not `flat/recommended`, which carries ~50 unrelated
  // template/semantic rules this repo hasn't opted into.
  ...pluginVue.configs['flat/base'],
  {
    files: ['**/*.vue'],
    plugins: {
      '@stylistic': stylistic
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.vue']
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        MouseEvent: 'readonly',
        Event: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      ...braceStyleRules,
      ...ternaryRules
    }
  }
];
