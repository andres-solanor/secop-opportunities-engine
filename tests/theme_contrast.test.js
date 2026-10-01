/**
 * Contraste de los temas (WCAG AA) calculado desde los tokens de web/style.css.
 * Lee los bloques `:root` (oscuro), `:root[data-theme="light"]` y `:root[data-theme="matrix"]`,
 * compone las superficies translúcidas sobre el fondo y mide los pares de texto que usa la web.
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');
const AA = 4.5; // texto normal

// ---------- Tokens ----------
function block(selector) {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no está el bloque ${selector}`);
  const end = CSS.indexOf('\n}', start);
  const tokens = {};
  for (const m of CSS.slice(start, end).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) tokens[m[1]] = m[2].trim();
  return tokens;
}

const DARK = block(':root');
const THEMES = {
  dark: DARK,
  light: { ...DARK, ...block(':root[data-theme="light"]') },
  matrix: { ...DARK, ...block(':root[data-theme="matrix"]') }
};

// ---------- Colores ----------
function resolveVars(value, tokens) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => resolveVars(tokens[name], tokens));
}

/** Color de un token como [r, g, b, a]. Acepta #rgb, #rrggbb y rgb()/rgba() con canales en var(). */
function color(name, tokens) {
  const value = resolveVars(tokens[name], tokens);
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const fn = value.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(fn, `${name} no es un color simple: ${value}`);
  const parts = fn[1].split(',').map(Number);
  return parts.length === 4 ? parts : parts.concat(1);
}

/** Compone un color translúcido sobre uno opaco. */
function over([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]) {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Superficies donde va el texto, ya compuestas sobre el fondo de la página.
function surfaces(t) {
  const page = color('--bg-main', t);
  const card = over(color('--surface-card', t), page);
  return {
    'fondo de la página': page,
    'ficha': card,
    'recuadro dentro de la ficha': over(color('--surface-well-deep', t), card),
    'modal y menús': over(color('--surface-solid', t), page)
  };
}

// Los acentos también son color de texto en style.css (etiquetas de sector, enlaces, puntajes).
const TEXTS = [
  '--text-primary', '--text-secondary', '--text-soft', '--text-muted',
  '--accent-cyan', '--accent-emerald', '--accent-amber', '--accent-violet'
];

for (const [theme, t] of Object.entries(THEMES)) {
  test(`tema ${theme}: el texto llega a WCAG AA (4,5:1) en fondo, fichas, recuadros y modal`, () => {
    const fails = [];
    for (const [where, bg] of Object.entries(surfaces(t))) {
      for (const text of TEXTS) {
        const ratio = contrast(color(text, t), bg);
        if (ratio < AA) fails.push(`${text} sobre ${where}: ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepStrictEqual(fails, []);
  });

  test(`tema ${theme}: el texto de los botones y contadores de acento llega a WCAG AA`, () => {
    const pairs = [
      ['--text-on-accent', '--accent-cyan'], // .btn-primary: degradado de cian a cian profundo
      ['--text-on-accent', '--accent-cyan-deep'],
      ['--text-on-accent-strong', '--accent-cyan'] // contador de la pestaña activa
    ];
    const fails = pairs
      .map(([fg, bg]) => [fg, bg, contrast(color(fg, t), color(bg, t))])
      .filter(([, , ratio]) => ratio < AA)
      .map(([fg, bg, ratio]) => `${fg} sobre ${bg}: ${ratio.toFixed(2)}:1`);
    assert.deepStrictEqual(fails, []);
  });
}

test('el cálculo de contraste coincide con los valores de referencia de WCAG', () => {
  assert.strictEqual(contrast([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
  // #767676 sobre blanco es el gris más claro que pasa AA (4,54:1).
  assert.strictEqual(contrast([118, 118, 118], [255, 255, 255]).toFixed(2), '4.54');
});
