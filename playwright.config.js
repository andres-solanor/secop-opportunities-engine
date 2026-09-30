// Pruebas de humo del tablero en un navegador real (Chromium).
// Sirven web/ tal como la publica GitHub Pages, con los datos que estén en el repositorio.
const { defineConfig } = require('@playwright/test');

const PORT = 8765;

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  // Un solo proceso: el servidor de desarrollo de Python atiende mal varias páginas a la vez
  // y las pruebas fallaban por tiempo de espera, no por la web.
  workers: 1,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1360, height: 900 }
  },
  webServer: {
    command: `python -m http.server ${PORT} --bind 127.0.0.1 --directory web`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI
  }
});
