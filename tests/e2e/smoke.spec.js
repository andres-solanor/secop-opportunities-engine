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

test('el filtro de modalidad cuenta y filtra las fichas del Radar', async ({ page }) => {
  await openDashboard(page);
  const before = await cards(page).count();
  const target = await page.evaluate(() => {
    const D = window.DashboardEngine;
    const counts = D.modalityCounts(D.tabItems(window.PROSPECTS_DATA, 'proveedores'));
    const [id, n] = Object.entries(counts).sort((a, b) => a[1] - b[1])[0];
    return { id, n };
  });
  await expect(page.locator(`#modalitySelect option[value="${target.id}"]`)).toHaveText(new RegExp(`\\(${target.n}\\)$`));
  await page.selectOption('#modalitySelect', target.id);
  await expect(cards(page)).toHaveCount(target.n);
  await page.click('#btnResetFilters');
  await expect(cards(page)).toHaveCount(before);
});

test('el filtro de tiempo cambia su texto con la pestaña y se oculta en el CRM', async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator('#ageSelect option[value="30"]')).toHaveText(/^Adjudicado:/);
  await page.click('#tabObservatorio');
  await expect(page.locator('#ageSelect option[value="30"]')).toHaveText(/^Publicado:/);
  await page.click('#tabPaa');
  await expect(page.locator('#ageSelect option[value="3m"]')).toHaveText(/^Se publica:/);
  await page.click('#tabCrm');
  await expect(page.locator('#ageSelect')).toBeHidden();

  await page.click('#tabProveedores');
  const expected = await page.evaluate(() => {
    const D = window.DashboardEngine;
    return D.applyFilters(D.tabItems(window.PROSPECTS_DATA, 'proveedores'), { age: '90' }).length;
  });
  await page.selectOption('#ageSelect', '90');
  await expect(cards(page)).toHaveCount(expected);
});

test('persona natural: opción del filtro, badge y línea en el detalle cuando hay perfil publicado', async ({ page }) => {
  // Los datos del repositorio pueden no traer el perfil todavía: se agrega al final de data.js.
  const profile = {
    desde: '2025-10-01', valor_min: 50000000, tipos_contrato: ['Obra', 'Suministros'],
    modalidades: [
      { modalidad: 'Selección abreviada subasta inversa', persona_natural: 910, juridica: 5266, sin_dato: 177 },
      { modalidad: 'Licitación pública', persona_natural: 12, juridica: 302, sin_dato: 54 }
    ]
  };
  await page.route('**/data.js*', async route => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: `${body}\nwindow.PROSPECTS_META = Object.assign(window.PROSPECTS_META || {}, { perfil_proponente: ${JSON.stringify(profile)} });\n` });
  });
  await openDashboard(page);
  // En el Radar todo está adjudicado: no se marca y la opción se oculta.
  await expect(page.locator('#modalitySelect option[value="persona_natural"]')).toBeHidden();
  await page.click('#tabObservatorio');
  const expected = await page.evaluate(() => {
    const D = window.DashboardEngine;
    const shares = D.bidderShares(window.PROSPECTS_META.perfil_proponente);
    return D.tabItems(window.PROSPECTS_DATA, 'observatorio').filter(i => D.personaNaturalFriendly(shares, i)).length;
  });
  expect(expected).toBeGreaterThan(0);
  await expect(page.locator('#modalitySelect option[value="persona_natural"]')).toHaveText(new RegExp(`\\(${expected}\\)$`));
  await page.selectOption('#modalitySelect', 'persona_natural');
  await expect(cards(page)).toHaveCount(expected);
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(page.locator('#modalBody')).toContainText('Persona natural gana 14,7%');
  await expect(page.locator('#modalBody')).toContainText('¿Quién gana en esta modalidad?');
});

test('fichas livianas y del PAA usan la misma estructura: ganador, adjudicación y cifras de la entidad', async ({ page }) => {
  // Datos de prueba con los campos nuevos (los del repositorio pueden ser anteriores).
  const awardedOn = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10) + 'T00:00:00';
  const light = {
    id: 'CO1.REQ.TEST1', motivo: 'fuera_de_corte', entidad: 'MUNICIPIO DE PRUEBA', nit_entidad: '800000001',
    precio: 300000000, modalidad: 'Mínima cuantía', tipo_contrato: 'Suministros', descripcion: 'Suministro de prueba',
    unspsc: '30102200', etapa_comercial: 'Adjudicado (Contratista Seleccionado)', estado_secop: 'Adjudicado',
    fecha_publicacion: '2026-08-01T00:00:00', fecha_adjudicacion: awardedOn,
    contratista: { nombre: 'CONSORCIO DE PRUEBA 2026', es_consorcio: true },
    sectores: [{ id: 'acero_metalmecanica', name: 'Acero & Metalmecánica' }], url_secop: 'https://example.org/x'
  };
  await page.route('**/hidden.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.HIDDEN_DATA = ${JSON.stringify({ items: [light], total: 1, sin_sector: 0, fuera_de_corte: 1, convenio: 0 })};`
  }));
  await page.route('**/data.js*', async route => {
    const res = await route.fetch();
    const body = await res.text();
    const inject = `\n(function(){var p=(window.PAA_DATA||[])[0];window.ENTITY_STATS=Object.assign({},window.ENTITY_STATS,{'800000001':{valor_12m:2e11,pagado_sobre_facturado_pct:90}});if(p){p.nit_entidad='800000001';}})();\n`;
    await route.fulfill({ response: res, body: body + inject });
  });
  await openDashboard(page);

  await page.check('#toggleHidden');
  const card = page.locator('#cardsGrid .opp-card-light').first();
  await expect(card).toContainText('CONSORCIO DE PRUEBA 2026');
  await expect(card.locator('.stage-pill')).toHaveText('Adjudicado');
  await expect(card).toContainText('Adjudicado hace 5 días');
  await expect(card).toContainText('Gran comprador');
  await expect(card).toContainText('Clasificada, fuera del corte');

  await page.click('#tabPaa');
  await expect(page.locator('#cardsGrid .opp-card').first()).toContainText('Gran comprador');
});

test('detalle de lo oculto: abre al instante y completa en vivo; si SECOP II falla, lo dice', async ({ page }) => {
  const light = {
    id: 'CO1.REQ.LIVE1', id_portafolio: 'CO1.BDOS.LIVE1', motivo: 'sin_sector', entidad: 'MUNICIPIO EN VIVO', nit_entidad: '800000002',
    precio: 400000000, modalidad: 'Licitación pública', tipo_contrato: 'Obra', descripcion: 'Obra de prueba en vivo',
    unspsc: '72141000', etapa_comercial: 'Adjudicado (Contratista Seleccionado)', estado_secop: 'Adjudicado',
    fecha_publicacion: '2026-08-01T00:00:00', fecha_adjudicacion: '2026-09-20T00:00:00',
    contratista: { nombre: 'CONSORCIO EN VIVO', es_consorcio: true },
    sectores: [{ id: 'sin_clasificar', name: 'Sin clasificar' }], url_secop: 'https://example.org/live'
  };
  await page.route('**/hidden.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.HIDDEN_DATA = ${JSON.stringify({ items: [light], total: 1, sin_sector: 1, fuera_de_corte: 0, convenio: 0 })};`
  }));
  // SECOP II simulado: nunca se consulta el servicio real desde las pruebas.
  let failSecop = false;
  await page.route('https://www.datos.gov.co/**', route => {
    if (failSecop) return route.fulfill({ status: 503, body: 'down' });
    const url = decodeURIComponent(route.request().url());
    let body = [];
    if (url.includes('jbjy-vk9h') && url.includes('proceso_de_compra')) {
      body = [{ proceso_de_compra: 'CO1.BDOS.LIVE1', estado_contrato: 'En ejecución', valor_del_contrato: '395000000', fecha_de_firma: '2026-09-25T00:00:00.000', nombre_representante_legal: 'ANA PRUEBA' }];
    } else if (url.includes('wi7w-2nvm')) {
      body = [{ identificador_de_la_oferta: 'X1', nombre_proveedor: 'CONSORCIO EN VIVO', nit_del_proveedor: '901', valor_de_la_oferta: '395000000' }];
    } else if (url.includes('jbjy-vk9h')) {
      body = [{ contratos: '42', valor: '9000000000', facturado: '100', pagado: '80' }];
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await openDashboard(page);
  await page.check('#toggleHidden');
  await page.locator('#cardsGrid .opp-card-light .btn-detail').first().click();
  const modal = page.locator('#modalBody');
  await expect(modal).toContainText('Por qué no está en el tablero');
  await expect(modal).toContainText('Datos consultados en vivo en SECOP II');
  await expect(modal).toContainText('Ana Prueba');
  await expect(modal).toContainText('1 oferta recibida');
  await expect(modal).toContainText('La entidad en los últimos 12 meses');
  await page.keyboard.press('Escape');

  failSecop = true;
  await page.evaluate(() => window.SecopLive.clearCache());
  await page.locator('#cardsGrid .opp-card-light .btn-detail').first().click();
  await expect(modal).toContainText('No se pudo consultar SECOP II en vivo');
  await expect(modal).toContainText('Por qué no está en el tablero');
});

test('detalle del PAA: planeación y procesos de la entidad en el tablero', async ({ page }) => {
  await page.route('https://www.datos.gov.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await openDashboard(page);
  await page.click('#tabPaa');
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(page.locator('#modalBody')).toContainText('Planeación (Plan Anual de Adquisiciones)');
  await expect(page.locator('#modalBody')).toContainText('Es una intención de compra');
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
