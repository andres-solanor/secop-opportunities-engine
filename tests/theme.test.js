/**
 * Pruebas de la lógica del tema (web/theme.js): elección válida y tema que se pinta.
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const T = require(path.join(__dirname, '..', 'web', 'theme.js'));

test('los cuatro temas, en el orden del selector, con "sistema" por defecto', () => {
  assert.deepStrictEqual(T.THEMES, ['system', 'light', 'dark', 'matrix']);
  assert.strictEqual(T.DEFAULT, 'system');
  assert.strictEqual(T.STORAGE_KEY, 'secop_theme');
  T.THEMES.forEach(t => assert.ok(T.LABELS[t], `falta la etiqueta de ${t}`));
});

test('normalize: un valor vacío, viejo o manipulado vuelve a "sistema"', () => {
  assert.strictEqual(T.normalize('matrix'), 'matrix');
  assert.strictEqual(T.normalize('light'), 'light');
  [null, undefined, '', 'Dark', 'neon', '<script>'].forEach(v => assert.strictEqual(T.normalize(v), 'system'));
});

test('resolve: "sistema" sigue al sistema operativo; los demás se respetan', () => {
  assert.strictEqual(T.resolve('system', true), 'light');
  assert.strictEqual(T.resolve('system', false), 'dark');
  assert.strictEqual(T.resolve(null, true), 'light');
  assert.strictEqual(T.resolve('dark', true), 'dark');
  assert.strictEqual(T.resolve('light', false), 'light');
  assert.strictEqual(T.resolve('matrix', true), 'matrix');
});
