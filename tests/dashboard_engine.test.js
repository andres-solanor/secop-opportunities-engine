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
  assert.strictEqual(k.pctLabel, null);
  assert.strictEqual(k.avgScore, null);
});

test('una parte positiva que redondea a 0 % se muestra "<1%"; una vacía, "0%"', () => {
  // El caso real: $601 millones de $1,06 billones (0,06 %).
  const small = { id: 'S', precio: 601e6 };
  const big = { id: 'B', precio: 1.06e12 };
  assert.strictEqual(D.kpis([small], [small, big]).pctLabel, '<1%');
  assert.strictEqual(D.kpis([], [small, big]).pctLabel, '0%');
  assert.strictEqual(D.kpis([ITEMS[0], ITEMS[1]], ITEMS).pctLabel, '95%');
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

const INSURANCE = { id: 'H4', motivo: 'sin_sector', unspsc: null, precio: 2000e6, descripcion: 'Programa de seguros', tipo_contrato: 'Seguros', etapa_comercial: 'Licitación Abierta (En Ofertas)', sectores: [{ id: 'sin_clasificar', name: 'Sin clasificar' }], departamento: 'Cauca' };
const AGREEMENT = { id: 'H5', motivo: 'convenio', convenio: true, unspsc: null, precio: 400e6, descripcion: 'Aunar esfuerzos PAE', etapa_comercial: 'Licitación Abierta (En Ofertas)', sectores: [{ id: 'alimentacion_escolar', name: 'PAE' }], departamento: 'Cauca' };

test('los sectores se agrupan por familia en el orden de los grupos', () => {
  const taxonomy = {
    acero: { name: 'Acero', grupo: 'sum' },
    obra: { name: 'Obra', grupo: 'obra' },
    viejo: { name: 'Sin grupo' },
    tec: { name: 'Tecnología', grupo: 'sum' }
  };
  const groups = [{ id: 'obra', name: 'Obra e infraestructura' }, { id: 'sum', name: 'Suministros' }, { id: 'vacio', name: 'Vacío' }];
  assert.deepStrictEqual(D.sectorGroups(taxonomy, groups), [
    { id: 'obra', name: 'Obra e infraestructura', sectors: [{ id: 'obra', name: 'Obra' }] },
    { id: 'sum', name: 'Suministros', sectors: [{ id: 'acero', name: 'Acero' }, { id: 'tec', name: 'Tecnología' }] },
    { id: 'otros_sectores', name: 'Otros sectores', sectors: [{ id: 'viejo', name: 'Sin grupo' }] }
  ]);
  assert.deepStrictEqual(D.sectorGroups(taxonomy, undefined).map(g => g.id), ['otros_sectores']);
});

test('conteo por sector: los seguros van en su propia opción de "Otros"', () => {
  const counts = D.sectorCounts([...ITEMS, ...HIDDEN, INSURANCE]);
  assert.strictEqual(counts.acero_metalmecanica, 2);
  assert.strictEqual(counts.obra_civil_general, 2);
  assert.strictEqual(counts[D.SIN_CLASIFICAR], 2);
  assert.strictEqual(counts[D.SEGUROS], 1);
});

test('"Otros: sin sector" excluye los seguros y "Otros: seguros" solo los incluye', () => {
  const list = [...HIDDEN, INSURANCE];
  assert.deepStrictEqual(D.applyFilters(list, { sector: D.SIN_CLASIFICAR }).map(i => i.id), ['H1', 'H2']);
  assert.deepStrictEqual(D.applyFilters(list, { sector: D.SEGUROS }).map(i => i.id), ['H4']);
  assert.ok(D.isOtherSector(D.SEGUROS) && D.isOtherSector(D.SIN_CLASIFICAR) && !D.isOtherSector('obra_civil_general'));
});

test('activeFilters devuelve solo los controles que se apartan de su valor por defecto', () => {
  const controls = [
    { id: 'searchInput', value: '   ', defaultValue: '' },
    { id: 'sectorSelect', value: 'salud', defaultValue: 'todos' },
    { id: 'stageSelect', value: 'todos', defaultValue: 'todos' },
    { id: 'budgetSelect', value: '500000000', defaultValue: '0' },
    { id: 'sortSelect', value: 'relevancia', defaultValue: 'relevancia' }
  ];
  assert.deepStrictEqual(D.activeFilters(controls), ['sectorSelect', 'budgetSelect']);
  assert.deepStrictEqual(D.activeFilters([{ id: 'searchInput', value: ' vías ', defaultValue: '' }]), ['searchInput']);
  assert.deepStrictEqual(D.activeFilters(undefined), []);
});

test('quién gana: agrupa con y sin ofertas, suma por contratista y mide la concentración', () => {
  const profile = { modalidades: [
    { modalidad: 'Contratación régimen especial', persona_natural: 40, juridica: 50, sin_dato: 10, valor: 1e10,
      top: [{ nombre: 'JARDIN BOTANICO', contratos: 8, valor: 5e9, persona_natural: false },
        { nombre: 'Rafael Demo', contratos: 3, valor: 2e8, persona_natural: true }] },
    { modalidad: 'Contratación régimen especial (con ofertas)', persona_natural: 0, juridica: 100, sin_dato: 0, valor: 3e10,
      top: [{ nombre: 'Jardín Botánico', contratos: 5, valor: 4e9, persona_natural: false },
        { nombre: 'CONINTEL S.A.', contratos: 4, valor: 9e9, persona_natural: false }] },
    { modalidad: 'Mínima cuantía', persona_natural: 1, juridica: 1, sin_dato: 0, top: [{ nombre: 'OTRO', contratos: 99, valor: 1 }] }
  ] };
  const item = { modalidad: 'Contratación régimen especial (con ofertas)' };
  assert.deepStrictEqual(D.rawModalities(profile, item), ['Contratación régimen especial', 'Contratación régimen especial (con ofertas)']);
  const w = D.modalityWinners(profile, item);
  assert.strictEqual(w.contratos, 200);
  assert.strictEqual(w.valor, 4e10);
  // "JARDIN BOTANICO" y "Jardín Botánico" son el mismo contratista: 8 + 5.
  assert.deepStrictEqual(w.top.map(t => [t.nombre, t.contratos]), [['JARDIN BOTANICO', 13], ['CONINTEL S.A.', 4], ['Rafael Demo', 3]]);
  assert.strictEqual(w.share, 10); // 20 de 200
  assert.strictEqual(w.concentracion, 'atomizado');
  assert.strictEqual(D.concentration(50), 'concentrado');
  assert.strictEqual(D.concentration(20), 'repartido');
  // Perfil de una corrida anterior (sin `top`), modalidad "otra" o nada que mostrar: null.
  assert.strictEqual(D.modalityWinners({ modalidades: [{ modalidad: 'Mínima cuantía', persona_natural: 1, juridica: 1, sin_dato: 0 }] }, { modalidad: 'Mínima cuantía' }), null);
  assert.deepStrictEqual(D.rawModalities(profile, { modalidad: 'Asociación público privada' }), []);
  assert.strictEqual(D.summarizeWinners([], 10), null);
});

test('secopUrl reconstruye la URL desde notice_uid y respeta una URL completa', () => {
  assert.strictEqual(D.secopUrl({ notice_uid: 'CO1.NTC.9621408' }),
    'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.9621408');
  assert.strictEqual(D.secopUrl({ url_secop: 'https://community.secop.gov.co/STS/Users/Login/Index' }),
    'https://community.secop.gov.co/STS/Users/Login/Index');
  assert.strictEqual(D.secopUrl({}), '');
  assert.strictEqual(D.secopUrl(null), '');
});

test('pageInfo y limitToShow: páginas de PAGE_SIZE fichas', () => {
  const P = D.PAGE_SIZE;
  assert.deepStrictEqual(D.pageInfo(0), { shown: 0, remaining: 0, next: 0 });
  assert.deepStrictEqual(D.pageInfo(P - 1), { shown: P - 1, remaining: 0, next: 0 });
  assert.deepStrictEqual(D.pageInfo(P * 2 + 5), { shown: P, remaining: P + 5, next: P });
  assert.deepStrictEqual(D.pageInfo(P * 2 + 5, P * 2), { shown: P * 2, remaining: 5, next: 5 });
  assert.deepStrictEqual(D.pageInfo(10, 1000), { shown: 10, remaining: 0, next: 0 });
  assert.strictEqual(D.limitToShow(0), P);
  assert.strictEqual(D.limitToShow(P - 1), P);
  assert.strictEqual(D.limitToShow(P), P * 2);
  assert.strictEqual(D.limitToShow(-1), P);
});

test('"Otros" en Radar y Observatorio: solo sin sector, repartidos como el tablero', () => {
  const hidden = [...HIDDEN, INSURANCE, AGREEMENT];
  assert.deepStrictEqual(D.otherItems(hidden, 'proveedores').map(i => i.id), ['H2']);
  assert.deepStrictEqual(D.otherItems(hidden, 'observatorio').map(i => i.id), ['H1', 'H4']);
  assert.deepStrictEqual(D.otherItems(hidden, 'paa'), []);
  assert.deepStrictEqual(D.otherItems(undefined, 'proveedores'), []);
});

test('sectores con más valor para la tarjeta KPI', () => {
  const taxonomy = { acero_metalmecanica: { name: 'Acero' }, obra_civil_general: { name: 'Obra' } };
  const top = D.topSectors(ITEMS, taxonomy, 1);
  assert.deepStrictEqual(top, [{ id: 'acero_metalmecanica', name: 'Acero', value: 2000e6, count: 2 }]);
  assert.deepStrictEqual(D.topSectors(HIDDEN, taxonomy, 3).map(s => s.id), ['obra_civil_general']);
});

test('fuera del tablero: familias UNSPSC con conteo y valor', () => {
  assert.deepStrictEqual(D.hiddenFamilies(HIDDEN), [
    { family: '5310', count: 2, value: 400e6 },
    { family: 'sin código', count: 1, value: 900e6 }
  ]);
});

// ---------- Modalidad ----------
test('la modalidad se reconoce con los valores reales de SECOP II y del PAA', () => {
  const cases = [
    ['Selección abreviada subasta inversa', 'subasta'],
    ['SELECCION ABREVIADA CON SUBASTA INVERSA', 'subasta'],
    ['Licitación pública Obra Publica', 'licitacion'],
    ['LICITACION PUBLICA (OBRA PUBLICA)', 'licitacion'],
    ['Selección Abreviada de Menor Cuantía', 'menor_cuantia'],
    ['Seleccion Abreviada Menor Cuantia Sin Manifestacion Interes', 'menor_cuantia'],
    ['Mínima cuantía', 'minima_cuantia'],
    ['Concurso de méritos abierto', 'concurso'],
    ['Contratación régimen especial (con ofertas)', 'regimen_especial'],
    ['Contratación Directa (con ofertas)', 'directa'],
    ['Enajenación de bienes con subasta', 'otra'],
    [null, 'sin_dato'],
    ['No Definido', 'sin_dato']
  ];
  cases.forEach(([modalidad, id]) => assert.strictEqual(D.modalityOf({ modalidad }), id, String(modalidad)));
  assert.strictEqual(D.modalityLabel({ modalidad: 'Selección abreviada subasta inversa' }), 'Subasta inversa');
  assert.strictEqual(D.modalityLabel({ modalidad: 'Enajenación de bienes con subasta' }), 'Enajenación de bienes con subasta');
  assert.strictEqual(D.modalityLabel({ modalidad: null }), '');
});

test('el filtro de modalidad y sus conteos', () => {
  const items = [
    opp('M1', { modalidad: 'Mínima cuantía' }),
    opp('M2', { modalidad: 'Licitación pública' }),
    opp('M3', { modalidad: 'Licitación pública Obra Publica' })
  ];
  assert.deepStrictEqual(D.applyFilters(items, { modality: 'licitacion' }).map(i => i.id), ['M2', 'M3']);
  assert.deepStrictEqual(D.applyFilters(items, { modality: 'minima_cuantia' }).map(i => i.id), ['M1']);
  assert.strictEqual(D.applyFilters(items, { modality: 'todas' }).length, 3);
  assert.deepStrictEqual(D.modalityCounts(items), { minima_cuantia: 1, licitacion: 2 });
  assert.ok(D.isFiltered({ modality: 'subasta' }));
  assert.ok(!D.isFiltered({ modality: 'todas', age: 'todas' }));
});

// ---------- Persona natural ----------
// Forma de meta.perfil_proponente (open_sources.fetch_bidder_profile).
const PROFILE = {
  desde: '2025-10-01',
  modalidades: [
    { modalidad: 'Mínima cuantía', persona_natural: 1019, juridica: 4391, sin_dato: 62 },
    { modalidad: 'Contratación régimen especial', persona_natural: 305, juridica: 2073, sin_dato: 23 },
    { modalidad: 'Contratación régimen especial (con ofertas)', persona_natural: 102, juridica: 962, sin_dato: 160 },
    { modalidad: 'Licitación pública', persona_natural: 12, juridica: 302, sin_dato: 54 },
    { modalidad: 'Licitación pública Obra Publica', persona_natural: 36, juridica: 806, sin_dato: 619 },
    { modalidad: 'Concurso de méritos abierto', persona_natural: 5, juridica: 50, sin_dato: 0 }
  ]
};

test('el perfil del proponente se agrupa como el filtro de modalidad', () => {
  const shares = D.bidderShares(PROFILE);
  assert.deepStrictEqual(shares.minima_cuantia, { pct: 18.8, natural: 1019, juridica: 4391, contratos: 5410 });
  // Régimen especial con y sin ofertas se suman: (305 + 102) / (2378 + 1064).
  assert.strictEqual(shares.regimen_especial.contratos, 3442);
  assert.strictEqual(shares.regimen_especial.pct, 11.8);
  // Licitación pública y de obra se suman; los desconocidos no cuentan en el porcentaje.
  assert.strictEqual(shares.licitacion.contratos, 1156);
  // Con menos de 100 contratos con dato no hay cifra.
  assert.strictEqual(shares.concurso, undefined);
  assert.deepStrictEqual(D.bidderShares(null), {});
});

test('el filtro "accesibles a persona natural" usa el umbral del motor', () => {
  const shares = D.bidderShares(PROFILE);
  const items = [
    opp('PN1', { modalidad: 'Mínima cuantía' }),
    opp('PN2', { modalidad: 'Licitación pública' }),
    opp('PN3', { modalidad: 'Concurso de méritos abierto' })
  ];
  assert.strictEqual(D.PERSONA_NATURAL_MIN_PCT, 12);
  assert.ok(D.personaNaturalFriendly(shares, items[0]));
  assert.strictEqual(D.personaNaturalFriendly(shares, items[1]), null);
  // Adjudicado: ya no se puede ofertar, no se marca; la cifra sigue disponible para el detalle.
  const awarded = opp('PN4', { ...AWARDED, modalidad: 'Mínima cuantía' });
  assert.strictEqual(D.personaNaturalFriendly(shares, awarded), null);
  assert.ok(D.personaNaturalShare(shares, awarded));
  // El PAA (sin etapa) sí se marca: es una compra futura.
  assert.ok(D.personaNaturalFriendly(shares, { modalidad: 'MINIMA CUANTIA', anio: 2026, mes_esperado: 11 }));
  assert.deepStrictEqual(D.applyFilters(items, { modality: D.PERSONA_NATURAL, bidderShares: shares }).map(i => i.id), ['PN1']);
  assert.deepStrictEqual(D.applyFilters(items, { modality: D.PERSONA_NATURAL }), [], 'sin perfil publicado no se adivina');
});

// ---------- Enlaces para compartir ----------
test('el enlace #op=<id> se arma y se lee igual, con caracteres especiales', () => {
  assert.strictEqual(D.deepLinkHash('CO1.REQ.123'), '#op=CO1.REQ.123');
  assert.strictEqual(D.parseDeepLink(D.deepLinkHash('MarketplaceCO1715807499')), 'MarketplaceCO1715807499');
  assert.strictEqual(D.parseDeepLink(D.deepLinkHash('A B&C=D')), 'A B&C=D');
  assert.strictEqual(D.parseDeepLink(''), null);
  assert.strictEqual(D.parseDeepLink('#otra=1'), null);
  assert.strictEqual(D.parseDeepLink('#op='), null);
});

test('una oportunidad compartida se busca en el tablero, el PAA y lo oculto, en ese orden', () => {
  const sources = {
    board: [opp('B1', AWARDED), opp('O1')],
    paa: [{ id: 'P1', anio: 2026, mes_esperado: 11 }],
    hidden: [{ id: 'H1', motivo: 'sin_sector' }, { id: 'B1', motivo: 'sin_sector' }]
  };
  assert.deepStrictEqual([D.findOpportunity('B1', sources).source, D.findOpportunity('B1', sources).tab], ['board', 'proveedores']);
  assert.strictEqual(D.findOpportunity('O1', sources).tab, 'observatorio');
  assert.strictEqual(D.findOpportunity('P1', sources).tab, 'paa');
  assert.strictEqual(D.findOpportunity('H1', sources).source, 'hidden');
  assert.strictEqual(D.findOpportunity('NO.EXISTE', sources), null);
  assert.strictEqual(D.findOpportunity('H1', { board: [] }), null, 'sin hidden.js cargado no se encuentra lo oculto');
});

// ---------- Tiempo ----------
test('la fecha del filtro de tiempo es la del estado actual', () => {
  const awarded = opp('T1', { ...AWARDED, fechas: { publicacion: '2026-08-01T00:00:00', adjudicacion: '2026-09-28T00:00:00' } });
  const open = opp('T2', { fechas: { publicacion: '2026-09-20T00:00:00' } });
  const light = opp('T3', { fecha_publicacion: '2026-09-25T00:00:00' });
  const awardedNoDate = opp('T4', { ...AWARDED, fecha_publicacion: '2026-09-30T00:00:00' });
  const planned = { id: 'P1', anio: 2026, mes_esperado: 11 };
  assert.strictEqual(D.stateDate(awarded).getDate(), 28);
  assert.strictEqual(D.stateDate(open).getDate(), 20);
  assert.strictEqual(D.stateDate(light).getDate(), 25);
  assert.strictEqual(D.stateDate(awardedNoDate), null, 'un adjudicado sin fecha de adjudicación no usa la de publicación');
  assert.deepStrictEqual([D.stateDate(planned).getMonth(), D.stateDate(planned).getDate()], [10, 1]);
  assert.strictEqual(D.countUndated([awarded, awardedNoDate]), 1);
});

test('el filtro de tiempo mira atrás en el tablero y adelante en el PAA', () => {
  const now = new Date(2026, 9, 1, 10, 0); // 1 de octubre de 2026
  const items = [
    opp('A3', { fechas: { publicacion: '2026-09-28T00:00:00' } }), // hace 3 días
    opp('A20', { fechas: { publicacion: '2026-09-11T00:00:00' } }), // hace 20 días
    opp('A120', { fechas: { publicacion: '2026-06-03T00:00:00' } }), // hace 120 días
    opp('SIN', {})
  ];
  const ids = age => D.applyFilters(items, { age, now }).map(i => i.id);
  assert.deepStrictEqual(ids('7'), ['A3']);
  assert.deepStrictEqual(ids('30'), ['A3', 'A20']);
  assert.deepStrictEqual(ids('gt90'), ['A120']);
  assert.deepStrictEqual(ids('todas'), ['A3', 'A20', 'A120', 'SIN']);

  const paa = [10, 11, 12].map(m => ({ id: `P${m}`, anio: 2026, mes_esperado: m, sectores: [] }));
  assert.deepStrictEqual(D.applyFilters(paa, { age: 'mes', now }).map(i => i.id), ['P10']);
  assert.deepStrictEqual(D.applyFilters(paa, { age: '3m', now }).map(i => i.id), ['P10', 'P11', 'P12']);
  assert.deepStrictEqual(D.ageOptions('paa').map(o => o.id), ['mes', '3m']);
  assert.deepStrictEqual(D.ageOptions('crm'), []);
});
