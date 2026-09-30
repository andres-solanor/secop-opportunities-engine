/**
 * Pruebas del motor del tablero (web/dashboard-engine.js).
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const D = require(path.join(__dirname, '..', 'web', 'dashboard-engine.js'));

function opp(id, overrides) {
  return {
    id,
    referencia: `REF-${id}`,
    entidad: 'MUNICIPIO DEMO',
    departamento: 'Antioquia',
    precio: 500e6,
    score_calidad: 80,
    etapa_comercial: 'Licitación Abierta (En Ofertas)',
    descripcion: 'Suministro de estructura metálica',
    sectores: [{ id: 'acero_metalmecanica', name: 'Acero & Metalmecánica' }],
    materiales_detectados: ['estructura metálica'],
    contratista: { nombre: 'Pendiente por Adjudicar', nit: 'N/A' },
    ...overrides
  };
}

const AWARDED = { etapa_comercial: 'Adjudicado (Contrato firmado)', contratista: { nombre: 'ACEROS SAS', nit: '900123456' } };
const ITEMS = [
  opp('A'),
  opp('B', { ...AWARDED, precio: 1500e6, score_calidad: 90 }),
  opp('C', { departamento: 'Cauca', precio: 100e6, score_calidad: 60, etapa_comercial: 'Borrador de Pliegos', sectores: [{ id: 'obra_civil_general', name: 'Obra' }], nueva: true })
];

test('las pestañas Radar y Observatorio no comparten oportunidades', () => {
  const radar = D.tabItems(ITEMS, 'proveedores').map(i => i.id);
  const obs = D.tabItems(ITEMS, 'observatorio').map(i => i.id);
  assert.deepStrictEqual(radar, ['B']);
  assert.deepStrictEqual(obs, ['A', 'C']);
  assert.strictEqual(radar.length + obs.length, ITEMS.length);
});

test('Para Ti usa el puntaje de afinidad y el CRM solo lo guardado', () => {
  const scores = { A: 80, B: 40, C: 55 };
  const forYou = D.tabItems(ITEMS, 'parati', { matchScore: i => scores[i.id], minMatch: 55 });
  assert.deepStrictEqual(forYou.map(i => i.id), ['A', 'C']);
  assert.deepStrictEqual(D.tabItems(ITEMS, 'crm', { crmState: { B: { status: 'nuevo' } } }).map(i => i.id), ['B']);
});

test('los filtros se combinan y los valores neutros no filtran', () => {
  assert.strictEqual(D.applyFilters(ITEMS, {}).length, 3);
  assert.strictEqual(D.applyFilters(ITEMS, { sector: 'todos', stage: 'todos', department: 'todos', minBudget: '0', query: ' ' }).length, 3);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { sector: 'obra_civil_general' }).map(i => i.id), ['C']);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { stage: 'adjudicado' }).map(i => i.id), ['B']);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { stage: 'borrador' }).map(i => i.id), ['C']);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { minBudget: '200000000' }).map(i => i.id), ['A', 'B']);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { department: 'Cauca' }).map(i => i.id), ['C']);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { onlyNew: true }).map(i => i.id), ['C']);
  assert.deepStrictEqual(D.applyFilters(ITEMS, { minBudget: '200000000', stage: 'adjudicado', query: 'aceros sas' }).map(i => i.id), ['B']);
});

test('la búsqueda cubre entidad, contratista, NIT y materiales', () => {
  assert.deepStrictEqual(D.applyFilters(ITEMS, { query: '900123456' }).map(i => i.id), ['B']);
  assert.strictEqual(D.applyFilters(ITEMS, { query: 'ESTRUCTURA METÁLICA' }).length, 3);
  assert.strictEqual(D.applyFilters(ITEMS, { query: 'no existe' }).length, 0);
});

test('isFiltered distingue filtros activos de valores neutros', () => {
  assert.strictEqual(D.isFiltered({ sector: 'todos', stage: 'todos', minBudget: '0', department: 'todos', query: '' }), false);
  assert.strictEqual(D.isFiltered({ minBudget: '200000000' }), true);
  assert.strictEqual(D.isFiltered({ onlyNew: true }), true);
});

test('los KPIs salen de las listas filtrada y base', () => {
  const k = D.kpis([ITEMS[0], ITEMS[1]], ITEMS);
  assert.strictEqual(k.count, 2);
  assert.strictEqual(k.baselineCount, 3);
  assert.strictEqual(k.sum, 2000e6);
  assert.strictEqual(k.baselineSum, 2100e6);
  assert.strictEqual(k.pct, 95);
  assert.strictEqual(k.avgScore, 85);
});

test('los KPIs de una lista vacía no inventan cifras', () => {
  const k = D.kpis([], []);
  assert.strictEqual(k.count, 0);
  assert.strictEqual(k.sum, 0);
  assert.strictEqual(k.pct, null);
  assert.strictEqual(k.avgScore, null);
});

test('formatCop usa millones, miles de millones y billones', () => {
  assert.strictEqual(D.formatCop(250e6), '$250 Millones COP');
  assert.strictEqual(D.formatCop(3.45e9), '$3,5 Mil Millones COP');
  assert.strictEqual(D.formatCop(2.5e12), '$2,50 Billones COP');
});

test('departamentos únicos, ordenados y sin "No Definido"', () => {
  const items = [...ITEMS, opp('D', { departamento: 'No Definido' }), opp('E', { departamento: null })];
  assert.deepStrictEqual(D.departments(items), ['Antioquia', 'Cauca']);
});

test('las opciones de sector salen de la taxonomía', () => {
  const options = D.sectorOptions({ a: { name: 'Sector A', keywords: [] }, b: { name: 'Sector B', keywords: [] } });
  assert.deepStrictEqual(options, [{ id: 'a', name: 'Sector A' }, { id: 'b', name: 'Sector B' }]);
  assert.deepStrictEqual(D.sectorOptions(undefined), []);
});

test('el CRM cuenta aparte lo guardado que ya no está en el dataset', () => {
  const s = D.crmSummary({ A: { status: 'nuevo' }, VIEJA: { status: 'contactado' } }, ITEMS);
  assert.deepStrictEqual(s, { total: 2, active: 1, missing: 1 });
  assert.deepStrictEqual(D.crmSummary(null, ITEMS), { total: 0, active: 0, missing: 0 });
});

test('el CSV escapa comillas, saltos de línea y fórmulas', () => {
  assert.strictEqual(D.csvCell('ACEROS "EL PUENTE" SAS'), '"ACEROS ""EL PUENTE"" SAS"');
  assert.strictEqual(D.csvCell('línea 1\nlínea 2'), '"línea 1\nlínea 2"');
  assert.strictEqual(D.csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.strictEqual(D.csvCell(1500), '1500');
  assert.strictEqual(D.csvCell(null), '');
  const csv = D.buildCsv(['ID', 'Entidad'], [['A', 'MUNICIPIO, DEMO']]);
  assert.strictEqual(csv, '﻿"ID","Entidad"\r\n"A","MUNICIPIO, DEMO"');
});

const HIDDEN = [
  { id: 'H1', motivo: 'sin_sector', unspsc: '53101500', precio: 300e6, descripcion: 'Uniformes', etapa_comercial: 'Licitación Abierta (En Ofertas)', sectores: [{ id: 'sin_clasificar', name: 'Sin clasificar' }], departamento: 'Antioquia' },
  { id: 'H2', motivo: 'sin_sector', unspsc: '53102700', precio: 100e6, descripcion: 'Dotación', etapa_comercial: 'Adjudicado (Contratista Seleccionado)', sectores: [{ id: 'sin_clasificar', name: 'Sin clasificar' }], departamento: 'Cauca' },
  { id: 'H3', motivo: 'fuera_de_corte', unspsc: null, precio: 900e6, descripcion: 'Obra', etapa_comercial: 'Borrador de Pliegos', sectores: [{ id: 'obra_civil_general', name: 'Obra' }], departamento: 'Cauca' }
];

test('fuera del tablero: filtra por motivo, familia y filtros comunes', () => {
  assert.deepStrictEqual(D.filterHidden(HIDDEN, { reason: 'sin_sector' }).map(i => i.id), ['H1', 'H2']);
  assert.deepStrictEqual(D.filterHidden(HIDDEN, { reason: 'fuera_de_corte' }).map(i => i.id), ['H3']);
  assert.deepStrictEqual(D.filterHidden(HIDDEN, { family: '5310' }).map(i => i.id), ['H1', 'H2']);
  assert.deepStrictEqual(D.filterHidden(HIDDEN, { family: '5310', department: 'Cauca' }).map(i => i.id), ['H2']);
  assert.deepStrictEqual(D.filterHidden(HIDDEN, { query: 'uniformes' }).map(i => i.id), ['H1']);
  assert.strictEqual(D.filterHidden(HIDDEN, {}).length, 3);
});

test('fuera del tablero: familias UNSPSC con conteo y valor', () => {
  assert.deepStrictEqual(D.hiddenFamilies(HIDDEN), [
    { family: '5310', count: 2, value: 400e6 },
    { family: 'sin código', count: 1, value: 900e6 }
  ]);
});
