/* eslint-env node */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    settings: {
      'import/resolver': {
        typescript: {
          project: ['tsconfig.json', 'api/tsconfig.json'],
        },
      },
      'import/core-modules': ['cloudflare:test'],
    },
    rules: {
      'react/display-name': 'off',
    },
  },
]);
