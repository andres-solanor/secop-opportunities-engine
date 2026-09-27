/**
 * Pruebas del motor de perfiles (web/profile-engine.js).
 * Ejecutar: node --test tests/
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

test('afinidad alta cuando coinciden sector, material, zona, ticket y etapa', () => {
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  const m = E.matchOpportunity(steelProfile, opp(), detected);
  assert.ok(m.score >= 85, `score ${m.score}`);
  assert.ok(m.reasons.some(r => r.includes('Antioquia')));
});

test('sin sector compartido la afinidad queda limitada', () => {
  const detected = E.detectSectors(steelProfile, TAXONOMY);
  const m = E.matchOpportunity(steelProfile, opp({ sectores: [{ id: 'horeca_industrial', name: 'HORECA' }], materiales_detectados: [] }), detected);
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

test('perfil vacío no rompe el análisis', () => {
  const a = E.analyzeProfile({}, [opp()], TAXONOMY);
  assert.strictEqual(a.detected.length, 0);
  assert.strictEqual(a.market.total, 0);
  assert.ok(a.strength.missing.length > 0);
});
