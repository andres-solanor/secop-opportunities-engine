/**
 * Pruebas de humo: la página carga y pinta datos reales, distintos de cero.
 * Una compilación que pasa no es una web que funciona: esto abre la web de verdad.
 * Ejecutar: npm run test:e2e
 */
const { test, expect } = require('@playwright/test');

// Recursos externos que pueden fallar sin red (fuentes, Google Identity): no son errores de la app.
const EXTERNAL = /fonts\.googleapis|fonts\.gstatic|accounts\.google|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/;

// El detalle consulta SECOP II en vivo: por defecto se simula sin filas, para no consultar nunca el
// servicio real (en CI devolvió 429). Va en el contexto, para cubrir también las páginas nuevas; las
// rutas de página que registre cada prueba tienen prioridad sobre las del contexto.
test.beforeEach(async ({ context }) => {
  await context.route('**/www.datos.gov.co/resource/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
});

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
// Las fichas se pintan en páginas: el total está en el conteo de resultados y se pintan a lo sumo PAGE_SIZE.
const { PAGE_SIZE } = require('../../web/dashboard-engine.js');
const listedCount = page => number(page.locator('#resultsCount b'));
async function expectListed(page, n) {
  await expect(page.locator('#resultsCount b')).toHaveText(String(n));
  await expect(page.locator('#cardsGrid .opp-card')).toHaveCount(Math.min(n, PAGE_SIZE));
}

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
  await expectListed(page,radar);
  await page.click('#tabObservatorio');
  await expectListed(page,observatorio);
});

test('las fichas se pintan en páginas: "Ver más" agrega una y un filtro vuelve a la primera', async ({ page }) => {
  await openDashboard(page);
  await page.click('#tabObservatorio');
  const total = await listedCount(page);
  test.skip(total <= PAGE_SIZE, 'los datos no alcanzan para una segunda página');
  await expect(cards(page)).toHaveCount(PAGE_SIZE);
  const more = page.locator('#cardsGrid [data-action="more"]');
  await expect(more).toContainText(`(${total - PAGE_SIZE} sin mostrar)`);

  await more.click();
  await expect(cards(page)).toHaveCount(Math.min(total, PAGE_SIZE * 2));
  // El foco pasa a la primera ficha nueva.
  expect(await page.evaluate(n => document.activeElement.closest('[data-id]') === document.querySelectorAll('#cardsGrid [data-id]')[n], PAGE_SIZE)).toBe(true);

  // Cambiar de orden o de filtro vuelve a la primera página.
  await page.selectOption('#sortSelect', 'valor');
  await expect(cards(page)).toHaveCount(PAGE_SIZE);
});

test('un enlace compartido a una ficha fuera de la primera página la pinta y la resalta', async ({ page }) => {
  await openDashboard(page);
  // Una ficha del Radar (pestaña inicial) que no está en la primera página pintada.
  const target = await page.evaluate(() => {
    const radar = window.DashboardEngine.tabItems(window.PROSPECTS_DATA, 'proveedores');
    const missing = radar.find(i => !document.getElementById(`card-${i.id}`));
    return missing ? missing.id : null;
  });
  test.skip(!target, 'los datos no alcanzan para una segunda página');
  await page.goto('about:blank');
  await page.goto(`/index.html#op=${encodeURIComponent(target)}`);
  await expect(page.locator(`[id="card-${target}"]`)).toBeVisible();
});

test('las compras planeadas (PAA) se pintan', async ({ page }) => {
  await openDashboard(page);
  const planned = await number(page.locator('#countPaa'));
  await page.click('#tabPaa');
  await expectListed(page,planned);
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
  await expectListed(page,target.n);
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
  const before = await listedCount(page);
  const counts = await page.evaluate(() => {
    const open = window.PROSPECTS_DATA.filter(i => !window.DashboardEngine.isAwarded(i));
    return Object.keys(window.SECTOR_TAXONOMY).map(id => ({ id, n: open.filter(i => i.sectores.some(s => s.id === id)).length }));
  });
  const target = counts.find(c => c.n > 0 && c.n < before) || counts.find(c => c.n > 0);
  await page.selectOption('#sectorSelect', target.id);
  await expectListed(page,target.n);
  await expect(page.locator('#kpiTotalOpps')).toHaveText(String(target.n));

  await page.click('#btnResetFilters');
  await expectListed(page,before);
});

test('el filtro de modalidad cuenta y filtra las fichas del Radar', async ({ page }) => {
  await openDashboard(page);
  const before = await listedCount(page);
  const target = await page.evaluate(() => {
    const D = window.DashboardEngine;
    const counts = D.modalityCounts(D.tabItems(window.PROSPECTS_DATA, 'proveedores'));
    const [id, n] = Object.entries(counts).sort((a, b) => a[1] - b[1])[0];
    return { id, n };
  });
  await expect(page.locator(`#modalitySelect option[value="${target.id}"]`)).toHaveText(new RegExp(`\\(${target.n}\\)$`));
  await page.selectOption('#modalitySelect', target.id);
  await expectListed(page,target.n);
  await page.click('#btnResetFilters');
  await expectListed(page,before);
});

test('la búsqueda espera a que se deje de escribir y entonces filtra', async ({ page }) => {
  await openDashboard(page);
  const before = await listedCount(page);
  // Se escribe tecla por tecla: mientras se escribe, la lista no se vuelve a pintar.
  await page.locator('#searchInput').pressSequentially('zzzz-ninguna', { delay: 20 });
  expect(await listedCount(page)).toBe(before);
  await expect(page.locator('#cardsGrid .empty-state')).toBeVisible();
});

test('los filtros en uso se resaltan y "Limpiar filtros" dice cuántos hay', async ({ page }) => {
  await openDashboard(page);
  const active = () => page.$$eval('.filter-bar .is-active', els => els.map(e => e.id));
  expect(await active()).toEqual([]);
  await expect(page.locator('#btnResetFilters')).toHaveText('Limpiar filtros');

  await page.selectOption('#budgetSelect', '500000000');
  await page.fill('#searchInput', 'obra');
  // La búsqueda se aplica al dejar de escribir (SEARCH_DEBOUNCE_MS): primero se espera el conteo.
  await expect(page.locator('#btnResetFilters')).toHaveText('Limpiar filtros (2)');
  expect((await active()).sort()).toEqual(['budgetSelect', 'searchInput']);
  await expect(page.locator('#btnResetFilters')).toHaveClass(/is-active/);
  // El resaltado se ve: el borde del filtro activo no es el de reposo.
  const border = id => page.$eval(id, el => getComputedStyle(el).borderColor);
  expect(await border('#budgetSelect')).not.toBe(await border('#stageSelect'));

  await page.click('#btnResetFilters');
  expect(await active()).toEqual([]);
  await expect(page.locator('#btnResetFilters')).toHaveText('Limpiar filtros');
});

for (const width of [390, 360]) {
  test(`a ${width} px: barra en dos filas, KPI en una línea y sin desbordar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDashboard(page);
    const m = await page.evaluate(() => {
      const box = sel => document.querySelector(sel).getBoundingClientRect();
      const line = el => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height;
      return {
        scrollW: document.documentElement.scrollWidth,
        navPosition: getComputedStyle(document.querySelector('.navbar')).position,
        brandTop: box('.brand').top,
        accountTop: box('#accountArea').top,
        syncTop: box('#syncStatus').top,
        csvTop: box('#btnExportCsv').top,
        // Las cifras van en una línea; el sector puede ser un nombre largo y partirse, pero no desbordar.
        kpiWrapped: [...document.querySelectorAll('.kpi-value')]
          .filter(el => el.scrollWidth > el.clientWidth + 1 ||
            (el.id !== 'kpiSectorValue' && el.getBoundingClientRect().height > line(el) * 1.5))
          .map(el => el.textContent),
        wrappedButtons: [...document.querySelectorAll('#cardsGrid .card-actions .btn')].slice(0, 20)
          .filter(el => el.getBoundingClientRect().height > 60).length
      };
    });
    expect(m.scrollW).toBe(width);
    expect(m.navPosition).toBe('static');
    // Fila 1: marca y cuenta; fila 2: sincronización y CSV, sin una tercera fila.
    expect(Math.abs(m.brandTop - m.accountTop)).toBeLessThan(12);
    expect(Math.abs(m.syncTop - m.csvTop)).toBeLessThan(12);
    expect(m.syncTop).toBeGreaterThan(m.brandTop);
    expect(m.kpiWrapped).toEqual([]);
    expect(m.wrappedButtons).toBe(0);

    // Con un sector filtrado, el KPI muestra su nombre (largo) y la página sigue sin desbordar.
    const sector = await page.$eval('#sectorSelect optgroup option', o => o.value);
    await page.selectOption('#sectorSelect', sector);
    await expect(page.locator('#kpiSectorTitle')).toHaveText('Sector Filtrado');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.$eval('#kpiSectorValue', el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}

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
  await expectListed(page,expected);
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
  await expectListed(page,expected);
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(page.locator('#modalBody')).toContainText('Persona natural gana 14,7%');
  await expect(page.locator('#modalBody')).toContainText('¿Quién gana en esta modalidad?');
});

test('el panel de sincronización muestra la cobertura UNSPSC por semana, la más reciente primero', async ({ page }) => {
  const coverage = { precio_min: 50000000, semanas: [
    { semana: '2026-09-07', procesos: 4068, con_codigo: 3773 },
    { semana: '2026-09-14', procesos: 3855, con_codigo: 1412 }
  ] };
  await page.route('**/data.js*', async route => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: `${body}\nwindow.PROSPECTS_META = Object.assign(window.PROSPECTS_META || {}, { cobertura_unspsc: ${JSON.stringify(coverage)} });\n` });
  });
  await openDashboard(page);
  await page.click('#syncStatus');
  const section = page.locator('.detail-section', { hasText: 'Procesos con código UNSPSC' });
  await expect(section).toBeVisible();
  const rows = await section.locator('tbody tr').allTextContents();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('37 %'); // 1412 de 3855, la semana más reciente arriba
  expect(rows[1]).toContain('93 %');
});

test('el detalle ordena los bloques según el estado: el adjudicado empieza por el contratista', async ({ page }) => {
  // Sin consultas reales: la entidad en vivo ("quién gana") se simula vacía.
  await page.route('**/resource/jbjy-vk9h.json*', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await openDashboard(page);
  const pick = state => page.evaluate(s => {
    const E = window.ProfileEngine;
    const it = window.PROSPECTS_DATA.find(i => E.bidWindow(i).state === s && (s !== 'adjudicado' || (i.contratista && i.contrato)));
    return it ? it.id : null;
  }, state);
  const headings = async id => {
    await page.goto('about:blank');
    await page.goto(`/index.html#op=${encodeURIComponent(id)}`);
    await expect(page.locator('#modalBody .detail-section h3').first()).toBeVisible();
    return page.$$eval('#modalBody .detail-section h3', hs => hs.map(h => h.textContent.trim()));
  };
  const idx = (list, prefix) => list.findIndex(t => t.includes(prefix));

  const awarded = await pick('adjudicado');
  test.skip(!awarded, 'los datos no traen un adjudicado con contrato');
  const a = await headings(awarded);
  expect(a[0]).toBe('Objeto');
  expect(a[1]).toBe('Contratista');
  expect(idx(a, 'Contratista')).toBeLessThan(idx(a, 'Contrato'));
  if (idx(a, 'Quién gana') >= 0) expect(idx(a, 'Quién gana')).toBe(a.length - 1);

  const open = await pick('abierta');
  if (open) {
    const o = await headings(open);
    expect(o[0]).toBe('Objeto');
    if (idx(o, 'Cronograma') >= 0 && idx(o, 'La entidad') >= 0) expect(idx(o, 'Cronograma')).toBeLessThan(idx(o, 'La entidad'));
    if (idx(o, 'Quién gana') >= 0) expect(idx(o, 'Quién gana')).toBe(o.length - 1);
  }
});

test('quién gana: el país (perfil publicado) y la entidad (en vivo, simulado), con su proveedor habitual', async ({ page }) => {
  // Se toma un proceso del tablero con NIT de entidad y modalidad conocida, y se publica un perfil
  // con esa modalidad. datos.gov.co se simula: la prueba nunca consulta el servicio real.
  await page.route('**/data.js*', async route => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: `${body}
      (function () {
        const D = window.DashboardEngine;
        const it = window.PROSPECTS_DATA.find(i => i.nit_entidad && i.modalidad && !['otra', 'sin_dato'].includes((function (m) {
          const n = m.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
          return ['licitacion publica', 'menor cuantia', 'subasta inversa', 'minima cuantia', 'concurso de meritos', 'regimen especial', 'contratacion directa'].some(k => n.includes(k)) ? 'ok' : 'otra';
        })(i.modalidad)));
        window.__whoWinsTarget = it && it.id;
        window.PROSPECTS_META = Object.assign(window.PROSPECTS_META || {}, { perfil_proponente: {
          desde: '2025-10-02', valor_min: 50000000, tipos_contrato: ['Obra', 'Suministros'],
          modalidades: [{ modalidad: it.modalidad, persona_natural: 30, juridica: 170, sin_dato: 0, valor: 9e10,
            top: [{ nombre: 'NACIONAL UNO SAS', contratos: 12, valor: 5e9, persona_natural: false },
                  { nombre: 'MARIA DEMO RUIZ', contratos: 4, valor: 3e8, persona_natural: true }] }] } });
      })();\n` });
  });
  await page.route('**/resource/jbjy-vk9h.json*', route => {
    const grouped = decodeURIComponent(route.request().url()).includes('$group');
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(grouped
      ? [{ proveedor_adjudicado: 'PROVEEDOR HABITUAL SAS', tipodocproveedor: 'NIT', n: '5', v: '800000000' },
        { proveedor_adjudicado: 'OTRO SAS', tipodocproveedor: 'NIT', n: '1', v: '90000000' }]
      : [{ n: '8', v: '1200000000' }]) });
  });
  await openDashboard(page);
  const target = await page.evaluate(() => window.__whoWinsTarget);
  test.skip(!target, 'los datos no traen un proceso con NIT y modalidad conocida');
  await page.goto('about:blank');
  await page.goto(`/index.html#op=${encodeURIComponent(target)}`);
  const section = page.locator('#modalBody .who-wins');
  await expect(section).toContainText('En todo el país');
  await expect(section).toContainText('NACIONAL UNO SAS');
  await expect(section).toContainText('Maria Demo Ruiz'); // persona natural, en formato de nombre
  await expect(section).toContainText('Los 3 que más ganan se llevan el 8 %'); // 16 de 200
  await expect(section).toContainText('mercado atomizado');
  await expect(section.locator('#whoWinsEntity')).toContainText('PROVEEDOR HABITUAL SAS ganó 5 de 8: es su proveedor habitual');
});

test('fichas livianas y del PAA usan la misma estructura: ganador, adjudicación y cifras de la entidad', async ({ page }) => {
  // Datos de prueba con los campos nuevos (los del repositorio pueden ser anteriores).
  // Fecha local, no UTC: entre las 19:00 y la medianoche de Colombia la fecha UTC ya es la del día
  // siguiente y la ficha decía "hace 4 días" (falló el 2026-10-01 a las 19:56).
  const d = new Date(Date.now() - 5 * 24 * 3600 * 1000);
  const awardedOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`;
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

test('compartir: el botón copia un enlace #op= y ese enlace abre la ficha en su pestaña', async ({ page }) => {
  // Portapapeles simulado y sin menú nativo de compartir: la prueba no depende del sistema.
  await page.addInitScript(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
  });
  await openDashboard(page);
  const target = await page.evaluate(() => window.DashboardEngine.tabItems(window.PROSPECTS_DATA, 'observatorio')[0]);
  await page.click('#tabObservatorio');
  await page.locator(`[id="card-${target.id}"] [data-action="share"]`).click();
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toContain(`#op=${encodeURIComponent(target.id)}`);
  expect(copied).toContain(target.entidad);

  // Abrir el enlace en una página nueva: pestaña correcta, detalle abierto y ficha resaltada.
  const link = copied.split('\n').pop();
  const fresh = await page.context().newPage();
  await fresh.goto(link);
  await expect(fresh.locator('#detailModal')).toHaveClass(/active/);
  await expect(fresh.locator('#modalBody .detail-title')).toHaveText(target.entidad);
  await expect(fresh.locator('#tabObservatorio')).toHaveClass(/active/);
  // Al cerrar, el hash se limpia: recargar no vuelve a abrir el detalle.
  await fresh.keyboard.press('Escape');
  await expect(fresh.locator('#detailModal')).not.toHaveClass(/active/);
  expect(new URL(fresh.url()).hash).toBe('');
});

test('enlace a algo fuera del tablero o que ya no existe', async ({ page }) => {
  const light = {
    id: 'CO1.REQ.SOLO.OCULTO', motivo: 'sin_sector', entidad: 'ENTIDAD OCULTA', precio: 100000000, descripcion: 'Proceso oculto',
    etapa_comercial: 'Licitación Abierta (En Ofertas)', estado_secop: 'Publicado', sectores: [], url_secop: ''
  };
  await page.route('**/hidden.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.HIDDEN_DATA = ${JSON.stringify({ items: [light], total: 1, sin_sector: 1, fuera_de_corte: 0, convenio: 0 })};`
  }));
  // SECOP II simulado: el proceso desconocido no existe.
  await page.route('https://www.datos.gov.co/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }));

  await page.goto('/index.html#op=CO1.REQ.SOLO.OCULTO');
  await expect(page.locator('#modalBody')).toContainText('ENTIDAD OCULTA');
  await expect(page.locator('#modalBody')).toContainText('Por qué no está en el tablero');

  await page.goto('/index.html#op=CO1.REQ.NO.EXISTE');
  await page.reload();
  await expect(page.locator('#modalBody')).toContainText('Esta oportunidad ya no está disponible');
  await expect(page.locator('#cardsGrid .opp-card').first()).toBeVisible();
});

test('el detalle abre, recibe el foco y se cierra con Escape', async ({ page }) => {
  await openDashboard(page);
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(page.locator('#detailModal')).toHaveClass(/active/);
  await expect(page.locator('#modalClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detailModal')).not.toHaveClass(/active/);
});

test('pantalla completa del detalle: ocupa la ventana en escritorio, se recuerda y no aparece en el teléfono', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openDashboard(page);
  await page.locator('#cardsGrid .btn-detail').first().click();
  const expand = page.locator('#modalExpand');
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute('aria-pressed', 'false');
  await expand.click();
  await expect(page.locator('#detailModal')).toHaveClass(/expanded/);
  await expect(expand).toHaveAttribute('aria-pressed', 'true');
  const box = await page.locator('#detailModal .modal-content').boundingBox();
  expect(box.width).toBe(1440);
  expect(box.height).toBe(900);
  expect(await page.evaluate(() => localStorage.getItem('secop_detail_expanded'))).toBe('1');

  // Se recuerda al recargar; Escape sigue cerrando.
  await page.reload();
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(page.locator('#detailModal')).toHaveClass(/expanded/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#detailModal')).not.toHaveClass(/active/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#cardsGrid .btn-detail').first().click();
  await expect(expand).toBeHidden();
  expect(errors).toEqual([]);
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

// Temas: el fondo de la página sale de --bg-main de cada tema en style.css.
const THEME_CASES = [
  { theme: 'light', background: 'rgb(244, 246, 251)' },
  { theme: 'dark', background: 'rgb(9, 13, 22)' },
  { theme: 'matrix', background: 'rgb(0, 0, 0)' }
];

for (const { theme, background } of THEME_CASES) {
  test(`tema ${theme}: se elige en el selector, pinta las fichas y se recuerda al recargar`, async ({ page }) => {
    const errors = await openDashboard(page);
    await page.selectOption('#themeSelect', theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
    await expect(cards(page).first()).toBeVisible();
    if (theme === 'matrix') {
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/monospace/);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.pulse-dot') || document.body).animationName)).toBe('none');
    }

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('#themeSelect')).toHaveValue(theme);
    expect(await page.evaluate(() => localStorage.getItem('secop_theme'))).toBe(theme);
    expect(errors).toEqual([]);
  });
}

test('tema del sistema: por defecto sigue al sistema operativo y cambia en vivo', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openDashboard(page);
  await expect(page.locator('#themeSelect')).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Un valor guardado inválido no rompe la página: vuelve a "sistema".
  await page.evaluate(() => localStorage.setItem('secop_theme', 'neon'));
  await page.reload();
  await expect(page.locator('#themeSelect')).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('theme.js carga antes del CSS para que el tema no parpadee', async ({ page }) => {
  await page.goto('/index.html');
  const scriptFirst = await page.evaluate(() => {
    const script = document.querySelector('head script[src^="theme.js"]');
    const css = document.querySelector('head link[href^="style.css"]');
    return !!(script && css && (script.compareDocumentPosition(css) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(scriptFirst).toBe(true);
});

test('empresas cliente: cambiar de empresa cambia el perfil activo y su lista corta imprimible', async ({ page }) => {
  // Cuenta demo con su empresa propia y una empresa cliente guardadas.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const user = { id: 'demo:local', provider: 'demo', name: 'Cuenta Demo', givenName: 'Demo', email: '', picture: '', hostedDomain: '' };
    localStorage.setItem('secop_session', JSON.stringify(user));
    localStorage.setItem('secop_profiles', JSON.stringify({ 'demo:local': {
      role: 'proveedor', companyName: 'Aceros Propios', offerText: 'Estructuras metálicas y acero de refuerzo',
      offerTags: [], sectors: [], needs: [], connections: [], departments: [], nationwide: true, tickets: [] } }));
    localStorage.setItem('secop_client_book', JSON.stringify({ 'demo:local': { active: 'propia', clients: [{
      id: 'c1', role: 'proveedor', companyName: 'Obras Cliente SAS', offerText: 'Construcción de obra civil, vías y pavimentación',
      offerTags: [], sectors: [], needs: [], connections: [], departments: [], nationwide: true, tickets: [] }] } }));
  });
  await openDashboard(page);
  await expect(page.locator('#profileHero .hero-kicker')).toContainText('Aceros Propios');

  await page.click('#accountBtn');
  await page.click('#accountDropdown [data-action="clients"]');
  await expect(page.locator('.client-row')).toHaveCount(2);
  await page.click('.client-row [data-use="c1"]');
  await expect(page.locator('#profileHero .hero-kicker')).toContainText('Empresa cliente: Obras Cliente SAS');
  const book = await page.evaluate(() => JSON.parse(localStorage.getItem('secop_client_book'))['demo:local']);
  expect(book.active).toBe('c1');

  // Lista corta de la empresa en uso: encabezado con su nombre, filas con afinidad o el aviso, y modo de impresión.
  await page.click('.client-row [data-shortlist="c1"]');
  await expect(page.locator('.shortlist .reveal-title')).toHaveText('Obras Cliente SAS');
  await expect(page.locator('.shortlist-row, .shortlist .reveal-note').first()).toBeVisible();
  const scores = await page.$$eval('.shortlist-row .match-pill', els => els.map(e => parseInt(e.textContent, 10)));
  expect(scores.every(s => s >= 55)).toBe(true);
  await expect(page.locator('body')).toHaveClass(/print-shortlist/);
  await page.click('#profileModalClose');
  await expect(page.locator('body')).not.toHaveClass(/print-shortlist/);

  // Agregar otra empresa abre el asistente marcado como empresa nueva, y el perfil propio sigue intacto.
  await page.click('#profileHero #heroClients');
  await page.click('#addClientBtn');
  await expect(page.locator('.wizard-step-label')).toContainText('Nueva empresa cliente');
  const own = await page.evaluate(() => JSON.parse(localStorage.getItem('secop_profiles'))['demo:local'].companyName);
  expect(own).toBe('Aceros Propios');
});

test('de ganadores a proveedores: el detalle dice qué puede comprar el ganador y "Para Ti" lo usa', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('secop_session', JSON.stringify({ id: 'demo:local', provider: 'demo', name: 'Cuenta Demo', givenName: 'Demo' }));
    localStorage.setItem('secop_profiles', JSON.stringify({ 'demo:local': {
      role: 'proveedor', companyName: 'Aceros Demo', offerText: 'Suministro de acero de refuerzo y estructuras metálicas',
      offerTags: [], sectors: [], needs: [], connections: [], departments: [], nationwide: true, tickets: [] } }));
  });
  await openDashboard(page);
  // Un adjudicado de obra civil (y no de acero) del Radar, que es la pestaña inicial.
  const target = await page.evaluate(() => {
    const radar = window.DashboardEngine.tabItems(window.PROSPECTS_DATA, 'proveedores');
    const hit = radar.find(i => i.sectores.some(s => s.id === 'obra_civil_general') && !i.sectores.some(s => s.id === 'acero_metalmecanica'));
    return hit ? hit.id : null;
  });
  test.skip(!target, 'los datos no traen un adjudicado de obra civil sin acero');
  await page.goto('about:blank');
  await page.goto(`/index.html#op=${encodeURIComponent(target)}`);
  await expect(page.locator('#modalBody')).toContainText('Qué puede necesitar el ganador');
  await expect(page.locator('#modalBody')).toContainText('Acero & Metalmecánica');
  // Los códigos con los que se le vende, con su nombre público; el único aviso es el que cambia la lectura.
  const codes = page.locator('#modalBody .supplier-codes');
  await expect(codes.locator('li', { hasText: '301024' })).toContainText('Varillas');
  await expect(page.locator('#modalBody')).toContainText('Es una posibilidad comercial');
  await expect(page.locator('#modalBody')).not.toContainText('CC BY-SA');
  await page.click('#modalClose');

  await page.click('#tabParaTi');
  await expect(page.locator('#cardsGrid .match-line', { hasText: 'El ganador puede comprarte' }).first()).toBeVisible();
});

test('código UNSPSC en el detalle: el del proceso; si falta, el del contrato en vivo (simulado)', async ({ page }) => {
  // Dos adjudicados con contrato: al primero se le pone un producto y al segundo se le quita el código.
  await page.route('**/data.js*', async route => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: `${body}
      (function () {
        const withContract = window.PROSPECTS_DATA.filter(i => i.contrato && i.id_portafolio);
        if (withContract.length < 2) return;
        withContract[0].unspsc = '72141003';
        withContract[1].unspsc = null;
        window.__unspscTargets = [withContract[0].id, withContract[1].id];
      })();\n` });
  });
  const live = [];
  await page.route('**/resource/jbjy-vk9h.json*', route => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('proceso_de_compra')) live.push(url);
    const body = url.includes('proceso_de_compra') ? [{ codigo_de_categoria_principal: 'V1.30102400' }] : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const errors = await openDashboard(page);
  const targets = await page.evaluate(() => window.__unspscTargets || null);
  test.skip(!targets, 'los datos no traen dos adjudicados con contrato');

  await page.evaluate(id => { location.hash = `op=${encodeURIComponent(id)}`; }, targets[0]);
  const line = page.locator('#unspscLine');
  await expect(line).toContainText('72141003');
  await expect(line).toContainText('nombre de su clase 721410');
  expect(live).toEqual([]); // con código propio no se consulta SECOP II
  await page.click('#modalClose');

  await page.evaluate(id => { location.hash = `op=${encodeURIComponent(id)}`; }, targets[1]);
  await expect(line).toContainText('30102400');
  await expect(line).toContainText('Varillas');
  await expect(line).toContainText('del contrato firmado');
  expect(live.length).toBe(1);
  expect(errors).toEqual([]);
});

test('legibilidad: ningún texto visible por debajo de 12 px y el punto de estado no se anima', async ({ page }) => {
  const tiny = () => page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(el => el.offsetParent && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(el => parseFloat(getComputedStyle(el).fontSize) < 12)
    .map(el => `${el.tagName.toLowerCase()}.${el.className} ${getComputedStyle(el).fontSize}`));
  await openDashboard(page);
  expect(await tiny()).toEqual([]);
  // Un adjudicado: el detalle tiene notas legales, <small> y el punto de estado.
  const id = await page.evaluate(() => (window.PROSPECTS_DATA.find(i => window.ProfileEngine.bidWindow(i).state === 'adjudicado') || {}).id);
  await page.evaluate(id => { location.hash = `op=${encodeURIComponent(id)}`; }, id);
  await expect(page.locator('#detailModal')).toHaveClass(/active/);
  expect(await tiny()).toEqual([]);
  const animation = await page.locator('#modalBody .pulse-dot').first().evaluate(el => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
});

test('avisos: el detalle no publica fuentes y los términos de uso van en el pie de página', async ({ page }) => {
  await openDashboard(page);
  const id = await page.evaluate(() => (window.PROSPECTS_DATA.find(i => i.contrato && i.ofertas) || window.PROSPECTS_DATA[0]).id);
  await page.evaluate(id => { location.hash = `op=${encodeURIComponent(id)}`; }, id);
  await expect(page.locator('#detailModal')).toHaveClass(/active/);
  await expect(page.locator('#modalBody')).not.toContainText('Fuente:');
  await expect(page.locator('#modalBody')).not.toContainText('Ley 1581');
  await page.click('#modalClose');

  await page.click('#termsLink');
  await expect(page.locator('#modalBody .detail-title')).toHaveText('Términos de uso y licencias');
  await expect(page.locator('#modalBody')).toContainText('Ley 1581 de 2012');
  await expect(page.locator('#modalBody')).toContainText('CC BY-SA 4.0');
  await page.keyboard.press('Escape');
  await expect(page.locator('#detailModal')).not.toHaveClass(/active/);
});

test('el onboarding del perfil abre desde "Para Ti"', async ({ page }) => {
  await openDashboard(page);
  await page.click('#tabParaTi');
  await page.click('#emptyForYouStart');
  await expect(page.locator('#profileModal')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#profileModal')).not.toHaveClass(/active/);
});
