/**
 * Pruebas de humo: la página carga y pinta datos reales, distintos de cero.
 * Una compilación que pasa no es una web que funciona: esto abre la web de verdad.
 * Ejecutar: npm run test:e2e
 */
const { test, expect } = require('@playwright/test');

// Recursos externos que pueden fallar sin red (fuentes, Google Identity): no son errores de la app.
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|accounts\.google|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/;

async function openDashboard(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  page.on('console', msg => {
    if (msg.type() === 'error' && !EXTERNAL.test(msg.text()) && !EXTERNAL.test(msg.location().url || '')) errors.push(msg.text());
  });
  await page.goto('/index.html');
  await expect(page.locator('#cardsGrid .opp-card').first()).toBeVisible();
  return errors;
}

const cards = page => page.locator('#cardsGrid .opp-card');
const number = async locator => Number((await locator.textContent()).trim());

test('carga sin errores y muestra oportunidades y KPIs reales', async ({ page }) => {
  const errors = await openDashboard(page);
  const total = await page.evaluate(() => window.PROSPECTS_DATA.length);
  expect(total).toBeGreaterThan(0);

  expect(await number(page.locator('#kpiTotalOpps'))).toBeGreaterThan(0);
  await expect(page.locator('#kpiTotalPipeline')).toHaveText(/^\$[1-9]/);
  await expect(page.locator('#kpiAvgScore')).toHaveText(/^[1-9]\d* \/ 100$/);
  await expect(page.locator('#syncStatusText')).toContainText('SECOP');
  expect(errors).toEqual([]);
});

test('Radar y Observatorio se reparten todo el dataset sin repetir', async ({ page }) => {
  await openDashboard(page);
  const total = await page.evaluate(() => window.PROSPECTS_DATA.length);
  const radar = await number(page.locator('#countProveedores'));
  const observatorio = await number(page.locator('#countObservatorio'));
  expect(radar + observatorio).toBe(total);

  await page.click('#tabProveedores');
  await expect(cards(page)).toHaveCount(radar);
  await page.click('#tabObservatorio');
  await expect(cards(page)).toHaveCount(observatorio);
});

test('las compras planeadas (PAA) se pintan', async ({ page }) => {
  await openDashboard(page);
  const planned = await number(page.locator('#countPaa'));
  await page.click('#tabPaa');
  await expect(cards(page)).toHaveCount(planned);
});

test('el filtro de sector sale de la taxonomía, agrupado, con "Otros" al final', async ({ page }) => {
  await openDashboard(page);
  const sectors = await page.evaluate(() => Object.keys(window.SECTOR_TAXONOMY));
  // "Todos" + un sector por clave de la taxonomía + las dos opciones de "Otros".
  await expect(page.locator('#sectorSelect option')).toHaveCount(sectors.length + 3);
  const groups = await page.$$eval('#sectorSelect optgroup', els => els.map(e => e.label));
  expect(groups[groups.length - 1]).toBe('Otros');
  expect(groups.length).toBeGreaterThan(2);

  // El número junto a cada sector es el de fichas que aparecen al elegirlo (pestaña Radar).
  const target = await page.evaluate(() => {
    const radar = window.PROSPECTS_DATA.filter(i => window.DashboardEngine.isAwarded(i));
    const id = Object.keys(window.SECTOR_TAXONOMY).find(k => radar.some(i => i.sectores.some(s => s.id === k)));
    return { id, n: radar.filter(i => i.sectores.some(s => s.id === id)).length };
  });
  await expect(page.locator(`#sectorSelect option[value="${target.id}"]`)).toHaveText(new RegExp(`\\(${target.n}\\)$`));
  await page.selectOption('#sectorSelect', target.id);
  await expect(cards(page)).toHaveCount(target.n);
  await page.click('#btnResetFilters');
});

test('"Otros" muestra procesos sin sector y se desactiva en el PAA', async ({ page }) => {
  const errors = await openDashboard(page);
  await page.click('#tabObservatorio');
  await page.selectOption('#sectorSelect', 'sin_clasificar');
  // Con hidden.js: fichas livianas y la aclaración de que es una muestra. Sin él (antes de la
  // primera sincronización con el pipeline nuevo): el aviso de que aún no hay datos.
  await expect(page.locator('#cardsGrid .opp-card-light, #cardsGrid .empty-foryou').first()).toBeVisible();
  await expect(page.locator('#resultsCount')).not.toHaveText(/Cargando/);
  await page.click('#tabPaa');
  await expect(page.locator('#sectorSelect')).toHaveValue('todos');
  await expect(page.locator('#sectorSelect option[value="sin_clasificar"]')).toBeDisabled();
  expect(errors.filter(e => !/hidden\.js|404/.test(e))).toEqual([]);
});

test('el filtro de sector filtra las fichas del Observatorio', async ({ page }) => {
  await openDashboard(page);
  const sectors = await page.evaluate(() => Object.keys(window.SECTOR_TAXONOMY).map(id => ({ id })));
  expect(sectors.length).toBeGreaterThan(0);

  await page.click('#tabObservatorio');
  const before = await cards(page).count();
  const counts = await page.evaluate(() => {
    const open = window.PROSPECTS_DATA.filter(i => !window.DashboardEngine.isAwarded(i));
    return Object.keys(window.SECTOR_TAXONOMY).map(id => ({ id, n: open.filter(i => i.sectores.some(s => s.id === id)).length }));
  });
  const target = counts.find(c => c.n > 0 && c.n < before) || counts.find(c => c.n > 0);
  await page.selectOption('#sectorSelect', target.id);
  await expect(cards(page)).toHaveCount(target.n);
  await expect(page.locator('#kpiTotalOpps')).toHaveText(String(target.n));

  await page.click('#btnResetFilters');
  await expect(cards(page)).toHaveCount(before);
});

test('el detalle abre, recibe el foco y se cierra con Escape', async ({ page }) => {
  await openDashboard(page);
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(page.locator('#detailModal')).toHaveClass(/active/);
  await expect(page.locator('#modalClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detailModal')).not.toHaveClass(/active/);
});

test('"Fuera del tablero" está oculto por defecto y se abre con el interruptor', async ({ page }) => {
  const errors = await openDashboard(page);
  await expect(page.locator('#tabHidden')).toBeHidden();

  await page.locator('#toggleHidden').check();
  await expect(page.locator('#tabHidden')).toBeVisible();
  await expect(page.locator('#tabHidden')).toHaveClass(/active/);
  await expect(page.locator('#hiddenControls')).toBeVisible();
  // Con datos: fichas livianas. Sin hidden.js todavía (antes de la primera sincronización): aviso.
  await expect(page.locator('#cardsGrid .opp-card-light, #cardsGrid .empty-foryou').first()).toBeVisible();
  await expect(page.locator('#resultsCount')).not.toHaveText(/Cargando/);

  await page.locator('#toggleHidden').uncheck();
  await expect(page.locator('#tabHidden')).toBeHidden();
  await expect(page.locator('#tabProveedores')).toHaveClass(/active/);
  expect(errors.filter(e => !/hidden\.js|404/.test(e))).toEqual([]);
});

test('el onboarding del perfil abre desde "Para Ti"', async ({ page }) => {
  await openDashboard(page);
  await page.click('#tabParaTi');
  await page.click('#emptyForYouStart');
  await expect(page.locator('#profileModal')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#profileModal')).not.toHaveClass(/active/);
});
