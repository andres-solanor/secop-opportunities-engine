/**
 * Pruebas del motor de perfiles (web/profile-engine.js).
 * Ejecutar: node --test tests/profile_engine.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

global.window = globalThis;
require(path.join(__dirname, '..', 'web', 'taxonomy.js'));
const E = require(path.join(__dirname, '..', 'web', 'profile-engine.js'));
const TAXONOMY = globalThis.SECTOR_TAXONOMY;

const steelProfile = {
  role: 'proveedor',
  companyName: 'Aceros Demo',
  offerText: 'Fabricamos estructuras metálicas y cerchas; suministro de acero de refuerzo',
  needs: ['consorcio'],
  connections: ['contratistas_ganadores', 'entidades'],
  departments: ['Antioquia'],
  tickets: ['pyme']
};

function opp(overrides) {
  return {
    id: 'X',
    entidad: 'MUNICIPIO DEMO',
    departamento: 'Antioquia',
    precio: 500e6,
    etapa_comercial: 'Adjudicado (Contratista Seleccionado)',
    sectores: [{ id: 'acero_metalmecanica', name: 'Acero & Metalmecánica' }],
    materiales_detectados: ['cerchas'],
    contratista: { nombre: 'CONSORCIO DEMO', es_consorcio: true },
    ...overrides
  };
}

test('detecta el sector desde texto libre sin importar tildes', () => {
  const detected = E.detectSectors({ offerText: 'ESTRUCTURAS METALICAS y paneles solares' }, TAXONOMY);
  const ids = detected.map(d => d.id);
  assert.ok(ids.includes('acero_metalmecanica'));
  assert.ok(ids.includes('energia_solar_alumbrado'));
});

test('no detecta sectores con texto irrelevante', () => {
  assert.deepStrictEqual(E.detectSectors({ offerText: 'asesoría contable' }, TAXONOMY), []);
});

test('el operador del PAE es su propio sector, no HORECA', () => {
  const ids = E.detectSectors({ offerText: 'Operamos el programa de alimentación escolar con ración preparada en sitio' }, TAXONOMY).map(d => d.id);
  assert.deepStrictEqual(ids, ['alimentacion_escolar']);
  const kitchen = E.detectSectors({ offerText: 'Fabricamos cocinas industriales y marmitas' }, TAXONOMY).map(d => d.id);
  assert.deepStrictEqual(kitchen, ['horeca_industrial']);
});

test('afinidad alta cuando coinciden sector, material, zona, ticket y etapa', () => {
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  const m = E.matchOpportunity(steelProfile, opp(), detected);
  assert.ok(m.score >= 85, `score ${m.score}`);
  assert.ok(m.reasons.some(r => r.includes('Antioquia')));
});

test('supplierSectors: lo que suele comprar el ganador sale de compra_a, sin repetir ni incluir sus propios sectores', () => {
  const obra = opp({ sectores: [{ id: 'obra_civil_general', name: 'Obra' }, { id: 'acero_metalmecanica', name: 'Acero' }] });
  const ids = E.supplierSectors(obra, TAXONOMY).map(s => s.id);
  assert.ok(!ids.includes('acero_metalmecanica'), 'el contrato ya es de acero: no se sugiere a sí mismo');
  assert.ok(ids.includes('vehiculos_maquinaria'));
  assert.deepStrictEqual(E.supplierSectors(opp({ sectores: [{ id: 'tecnologia', name: 'TI' }] }), TAXONOMY), []);
});

test('un adjudicado de obra civil es lead para un proveedor de acero: "el ganador puede comprarte"', () => {
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  const obra = { sectores: [{ id: 'obra_civil_general', name: 'Construcción & Obra Civil General' }], materiales_detectados: [] };
  const awarded = E.matchOpportunity(steelProfile, opp(obra), detected);
  assert.ok(awarded.score >= 55, `score ${awarded.score}`);
  assert.ok(awarded.reasons.some(r => r.startsWith('El ganador puede comprarte: Acero')));
  // Abierto: todavía no hay a quién venderle; sigue con el tope de "sin sector compartido".
  const open = E.matchOpportunity(steelProfile, opp({ ...obra, etapa_comercial: 'Licitación Abierta (En Ofertas)' }), detected);
  assert.ok(open.score <= 35, `score ${open.score}`);
  // Una coincidencia directa de sector sigue por encima.
  assert.ok(E.matchOpportunity(steelProfile, opp(), detected).score > awarded.score);
});

test('el ganador deja de ser lead de suministro cuando ya no compra: >90 días o contrato terminado', () => {
  const now = new Date('2026-10-01T12:00:00');
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  const obra = { sectores: [{ id: 'obra_civil_general', name: 'Obra' }], materiales_detectados: [] };
  const lead = o => E.matchOpportunity(steelProfile, opp({ ...obra, ...o }), detected, now).reasons.some(r => r.startsWith('El ganador'));
  assert.ok(lead({ fechas: { adjudicacion: '2026-08-15T00:00:00' } }), '47 días: sigue comprando');
  assert.ok(!lead({ fechas: { adjudicacion: '2026-05-01T00:00:00' } }), '153 días: contrato avanzado');
  assert.ok(!lead({ fechas: { adjudicacion: '2026-09-01T00:00:00' }, contrato: { fin_ejecucion: '2026-09-20T00:00:00' } }), 'contrato terminado');
});

test('sin sector compartido la afinidad queda limitada', () => {
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  // Tecnología no le compra a acero (compra_a): ni sector compartido ni lead de suministro.
  const m = E.matchOpportunity(steelProfile, opp({ sectores: [{ id: 'tecnologia', name: 'Tecnología' }], materiales_detectados: [] }), detected);
  assert.ok(m.score <= 35, `score ${m.score}`);
});

test('analyzeProfile construye mercado, conexiones y recomendaciones', () => {
  const data = [
    opp({ id: 'A' }),
    opp({ id: 'B', etapa_comercial: 'Licitación Abierta (En Ofertas)', entidad: 'GOBERNACION DEMO', contratista: { nombre: 'Pendiente por Adjudicar' } }),
    opp({ id: 'C', departamento: 'Meta' })
  ];
  const a = E.analyzeProfile(steelProfile, data, TAXONOMY);
  assert.strictEqual(a.market.total, 2);
  assert.strictEqual(a.market.nationalTotal, 3);
  assert.strictEqual(a.market.open, 1);
  assert.strictEqual(a.market.winners, 1);
  assert.match(a.valueProp, /Aceros Demo suministra/);
  assert.deepStrictEqual(a.connections.map(c => c.id), ['contratistas_ganadores', 'entidades']);
  assert.strictEqual(a.recommendations[0].id, 'consorcio');
  assert.ok(a.strength.score > 0 && a.strength.score < 100);
});

test('libreta de empresas cliente: agregar, editar, activar y quitar sin mutar', () => {
  const empty = E.clientBook(null);
  assert.deepStrictEqual(empty, { active: E.OWN_PROFILE, clients: [] });

  const first = E.addClient(empty, { companyName: 'Ferretería Uno' });
  assert.strictEqual(first.id, 'c1');
  assert.strictEqual(first.book.active, 'c1');
  assert.deepStrictEqual(empty.clients, []); // la original no cambia

  const second = E.addClient(first.book, { companyName: 'Obras Dos' });
  assert.strictEqual(second.id, 'c2');
  assert.strictEqual(E.activeClient(second.book).companyName, 'Obras Dos');

  const edited = E.updateClient(second.book, 'c1', { companyName: 'Ferretería Uno SAS' });
  assert.strictEqual(edited.clients[0].companyName, 'Ferretería Uno SAS');
  assert.strictEqual(edited.clients[0].id, 'c1');

  // Quitar la activa vuelve al perfil propio; el siguiente id no reutiliza uno borrado por debajo del máximo.
  const removed = E.removeClient(edited, 'c2');
  assert.strictEqual(removed.active, E.OWN_PROFILE);
  assert.strictEqual(E.activeClient(removed), null);
  assert.strictEqual(E.addClient(removed, {}).id, 'c2');

  // Un activo que no existe (libreta vieja o manipulada) cae al perfil propio.
  assert.strictEqual(E.setActiveClient(removed, 'c9').active, E.OWN_PROFILE);
  assert.strictEqual(E.setActiveClient(removed, 'c1').active, 'c1');
});

test('lista corta: primero lo abierto por afinidad y cierre, con próximo paso; nada bajo el umbral', () => {
  const now = new Date('2026-10-01T12:00:00');
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  const open = (id, cierre) => opp({ id, etapa_comercial: 'Licitación Abierta (En Ofertas)', contratista: { nombre: 'Pendiente por Adjudicar' }, fechas: { cierre_ofertas: cierre } });
  const items = [
    opp({ id: 'ADJ' }),
    open('LATE', '2026-10-20T00:00:00'),
    open('SOON', '2026-10-05T00:00:00'),
    opp({ id: 'OTHER', sectores: [{ id: 'tecnologia', name: 'Tecnología' }], materiales_detectados: [], departamento: 'Meta' })
  ];
  const list = E.shortList(steelProfile, items, detected, { now });
  const ids = list.map(r => r.item.id);
  assert.ok(!ids.includes('OTHER'), 'lo que no tiene afinidad no entra');
  assert.ok(ids.indexOf('SOON') < ids.indexOf('ADJ') && ids.indexOf('LATE') < ids.indexOf('ADJ'), ids.join());
  assert.ok(list.every(r => r.match.score >= 55 && r.step && r.step.text));
  assert.strictEqual(E.shortList(steelProfile, items, detected, { now, limit: 1 }).length, 1);
});

test('perfil vacío no rompe el análisis', () => {
  const a = E.analyzeProfile({}, [opp()], TAXONOMY);
  assert.strictEqual(a.detected.length, 0);
  assert.strictEqual(a.market.total, 0);
  assert.ok(a.strength.missing.length > 0);
});

test('bidWindow usa la fecha de cierre para decidir si sigue abierta', () => {
  const now = new Date('2026-09-28T12:00:00');
  const open = { etapa_comercial: 'Licitación Abierta (En Ofertas)', estado_secop: 'Publicado', fechas: { cierre_ofertas: '2026-10-03T17:00:00' } };
  const closed = { ...open, fechas: { cierre_ofertas: '2026-09-20T17:00:00' } };
  const bwOpen = E.bidWindow(open, now);
  assert.strictEqual(bwOpen.state, 'abierta');
  assert.ok(bwOpen.days > 5 && bwOpen.days < 6);
  assert.strictEqual(E.bidWindow(closed, now).state, 'cerrada');
});

test('bidWindow marca como cerrados los procesos en evaluación sin fecha de cierre', () => {
  const item = { etapa_comercial: 'Proceso Activo (Evaluación)', estado_secop: 'Evaluación' };
  assert.strictEqual(E.bidWindow(item).state, 'cerrada');
  assert.strictEqual(E.isActionable(item), false);
  assert.strictEqual(E.bidWindow({ etapa_comercial: 'Borrador de Pliegos', estado_secop: 'Borrador' }).state, 'borrador');
});

test('un proceso cerrado pierde puntaje de etapa y no se anuncia como abierto', () => {
  const contratista = { ...steelProfile, role: 'contratista' };
  const detected = E.detectSectors(contratista, TAXONOMY);
  const now = new Date('2026-09-28T12:00:00');
  const base = opp({ etapa_comercial: 'Licitación Abierta (En Ofertas)', estado_secop: 'Publicado', contratista: { nombre: 'Pendiente por Adjudicar' } });
  const abierta = E.matchOpportunity(contratista, { ...base, fechas: { cierre_ofertas: '2026-10-03T17:00:00' } }, detected, now);
  const cerrada = E.matchOpportunity(contratista, { ...base, fechas: { cierre_ofertas: '2026-09-01T17:00:00' } }, detected, now);
  assert.ok(abierta.score - cerrada.score === 8, `${abierta.score} vs ${cerrada.score}`);
  assert.ok(abierta.reasons.includes('Cierra en 6 días'));
  assert.ok(!cerrada.reasons.some(r => r.includes('abierta') || r.includes('Cierra')));
});

test('un cierre sin hora sigue abierto durante todo ese día', () => {
  const item = { etapa_comercial: 'Licitación Abierta (En Ofertas)', estado_secop: 'Publicado', fechas: { cierre_ofertas: '2026-10-03T00:00:00' } };
  assert.strictEqual(E.bidWindow(item, new Date('2026-10-03T16:00:00')).state, 'abierta');
  assert.strictEqual(E.bidWindow(item, new Date('2026-10-04T08:00:00')).state, 'cerrada');
});

test('formatTerm convierte las unidades de SECOP', () => {
  assert.strictEqual(E.formatTerm({ valor: 107, unidad: 'día(s)' }), '107 días');
  assert.strictEqual(E.formatTerm({ valor: 1, unidad: 'mes(es)' }), '1 mes');
  assert.strictEqual(E.formatTerm(null), '');
});

test('badges: proceso sin ganador y gran comprador', () => {
  const now = new Date('2026-09-28T12:00:00');
  const item = { etapa_comercial: 'Licitación Abierta (En Ofertas)', estado_secop: 'Publicado', entidad_stats: { contratos_12m: 120, valor_12m: 2e11, pagado_sobre_facturado_pct: 91 } };
  const ids = E.cardBadges(item, now).map(b => b.id);
  assert.deepStrictEqual(ids, ['gran_comprador', 'pagos_registrados', 'sin_ganador']);
});

test('badges: riesgo primero y consorcio sin marca de contratista nuevo', () => {
  const now = new Date('2026-09-28T12:00:00');
  const item = {
    etapa_comercial: 'Adjudicado (Contratista Seleccionado)',
    contratista: { es_consorcio: true },
    contrato: { estado: 'Suspendido', dias_adicionados: 30, origen_recursos: ['Regalías (SGR)'], es_pyme: false },
    historial_contratista: { contratos: 1 }
  };
  const badges = E.cardBadges(item, now);
  assert.strictEqual(badges[0].id, 'contrato_suspendido');
  assert.ok(badges.some(b => b.id === 'consorcio'));
  assert.ok(!badges.some(b => b.id === 'contratista_nuevo'));
  assert.ok(badges.every(b => E.TONES[b.tone]));
});

test('badge de persona natural: solo con la cifra que pasa quien llama, con el porcentaje real', () => {
  const now = new Date('2026-09-28T12:00:00');
  const item = { etapa_comercial: 'Licitación Abierta (En Ofertas)', modalidad: 'Mínima cuantía' };
  assert.ok(!E.cardBadges(item, now).some(b => b.id === 'persona_natural'));
  const share = { pct: 18.8, natural: 1019, juridica: 4391, contratos: 5410 };
  const badge = E.cardBadges(item, now, { personaNatural: share }).find(b => b.id === 'persona_natural');
  assert.strictEqual(badge.label, 'Persona natural gana 18,8%');
  assert.strictEqual(badge.tone, 'info');
  assert.match(badge.tip, /1019 de 5410/);
  assert.match(badge.tip, /no un requisito/);
});

test('nextStep prioriza el inicio de ejecución futuro en adjudicados', () => {
  const now = new Date('2026-09-28T12:00:00');
  const item = { etapa_comercial: 'Adjudicado (Contrato firmado)', fechas: { adjudicacion: '2026-09-20T00:00:00' }, contrato: { estado: 'Aprobado', inicio_ejecucion: '2026-10-05T00:00:00' } };
  const step = E.nextStep(item, now);
  assert.match(step.text, /antes del inicio/);
  assert.strictEqual(step.date.getDate(), 5);
  assert.match(E.nextStep({ ...item, contrato: { estado: 'Suspendido' } }, now).text, /suspendido/);
});

test('badges: sanción es riesgo y las ofertas muestran su número', () => {
  const now = new Date('2026-09-28T12:00:00');
  const item = {
    etapa_comercial: 'Adjudicado (Contrato firmado)',
    sanciones: [{ sancionado: 'X SAS' }],
    ofertas: { cantidad: 3, proveedores: [] }
  };
  const badges = E.cardBadges(item, now);
  assert.strictEqual(badges[0].id, 'sancion');
  const offers = badges.find(b => b.id === 'ofertas');
  assert.strictEqual(offers.label, '3 ofertas');
  assert.strictEqual(E.cardBadges({ ...item, ofertas: { cantidad: 1 } }, now).find(b => b.id === 'ofertas').label, '1 oferta');
});

test('badges: un convenio adjudicado se marca como tal, en tono de atención', () => {
  const now = new Date('2026-09-28T12:00:00');
  const item = { etapa_comercial: 'Adjudicado (Contratista Seleccionado)', convenio: true };
  const badge = E.cardBadges(item, now).find(b => b.id === 'convenio');
  assert.strictEqual(badge.tone, 'warn');
  assert.ok(!E.cardBadges({ ...item, convenio: false }, now).some(b => b.id === 'convenio'));
  assert.strictEqual(E.BADGES.seguros.tone, 'warn');
});
