// ESLint solo para desarrollo: la web publicada no usa build ni dependencias npm.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', '.venv/', 'out/', 'test-results/', 'playwright-report/', 'web/data.js', 'web/taxonomy.js', 'web/hidden.js'] },
  js.configs.recommended,
  {
    // Código del navegador: cada archivo es un IIFE que expone un objeto en window.
    files: ['web/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', globalThis: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }]
    }
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    }
  }
];
