/**
 * Pruebas de las consultas en vivo a SECOP II (web/secop-live.js), con un fetch simulado.
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const L = require(path.join(__dirname, '..', 'web', 'secop-live.js'));

// Filas con los nombres reales de las columnas (comprobados contra datos.gov.co el 2026-10-01).
const CONTRACTS = [
  {
    proceso_de_compra: 'CO1.BDOS.1', estado_contrato: 'En ejecución', valor_del_contrato: '1000', valor_facturado: '600', valor_pagado: '300',
    fecha_de_firma: '2026-09-01T00:00:00.000', fecha_de_inicio_de_ejecucion: '2026-09-10T00:00:00.000', fecha_de_fin_de_ejecucion: '2026-12-31T00:00:00.000',
    dias_adicionados: '0', es_pyme: 'Si', es_grupo: 'No', proveedor_adjudicado: 'ACEROS SAS', documento_proveedor: '900123456-1',
    nombre_representante_legal: 'PAOLA SUAREZ', telefono_representante_legal: '3000000000', correo_representante: 'x@y.co',
    origen_de_los_recursos: 'Recursos Propios', urlproceso: { url: 'https://community.secop.gov.co/x' }
  },
  { proceso_de_compra: 'CO1.BDOS.1', estado_contrato: 'En ejecución', valor_del_contrato: '500', fecha_de_firma: '2026-08-15T00:00:00.000', dias_adicionados: '10' }
];
const OFFERS = [
  { identificador_de_la_oferta: 'O2', nombre_proveedor: 'OTRA SAS', nit_del_proveedor: '800000001', valor_de_la_oferta: '1200' },
  { identificador_de_la_oferta: 'O1', nombre_proveedor: 'ACEROS SAS', nit_del_proveedor: '900123456', valor_de_la_oferta: '1000' },
  { identificador_de_la_oferta: 'O1', nombre_proveedor: 'ACEROS SAS', nit_del_proveedor: '900123456', valor_de_la_oferta: '1000' }
];
const ENTITY = [{ contratos: '120', valor: '2e11', facturado: '1000', pagado: '910' }];
const PROCESS = [{
  id_del_proceso: 'CO1.REQ.9', id_del_portafolio: 'CO1.BDOS.9', entidad: 'MUNICIPIO DE PRUEBA', nit_entidad: '890000001',
  precio_base: '1000', valor_total_adjudicacion: '950', adjudicado: 'Si', nombre_del_proveedor: 'CONSORCIO VIAS',
  estado_del_procedimiento: 'Seleccionado', fecha_adjudicacion: '2026-09-24T00:00:00.000', urlproceso: { url: 'https://community.secop.gov.co/y' }
}];

function fakeFetch(routes, calls = []) {
  return url => {
    calls.push(url);
    const match = Object.keys(routes).find(k => url.includes(k));
    if (!match) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve([]) });
    const value = routes[match];
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
  };
}

test('las URL son de solo lectura, a los datasets del pipeline y con la llave escapada', () => {
  assert.match(L.contractUrl('CO1.BDOS.1'), /^https:\/\/www\.datos\.gov\.co\/resource\/jbjy-vk9h\.json\?/);
  assert.match(decodeURIComponent(L.contractUrl("CO1'X")), /proceso_de_compra = 'CO1''X'/);
  assert.match(L.offersUrl('CO1.BDOS.1'), /wi7w-2nvm/);
  assert.match(decodeURIComponent(L.entityUrl('890', new Date('2026-10-01T12:00:00Z'))), /fecha_de_firma >= '2025-10-01T00:00:00'/);
  assert.match(L.processUrl('CO1.REQ.9'), /p6dx-8zbt/);
});

test('el contrato en vivo tiene la forma del pipeline y no lleva teléfonos ni correos', () => {
  const c = L.parseContract(CONTRACTS);
  assert.strictEqual(c.cantidad, 2);
  assert.strictEqual(c.valor, 1500);
  assert.strictEqual(c.fecha_firma, '2026-08-15T00:00:00');
  assert.strictEqual(c.inicio_ejecucion, '2026-09-10T00:00:00');
  assert.strictEqual(c.dias_adicionados, 10);
  assert.strictEqual(c.es_pyme, true);
  assert.strictEqual(c.nit_proveedor, '900123456');
  assert.deepStrictEqual(c.origen_recursos, ['Recursos Propios']);
  assert.strictEqual(c.contactos.representante_legal, 'PAOLA SUAREZ');
  assert.ok(!JSON.stringify(c).includes('3000000000'));
  assert.ok(!JSON.stringify(c).includes('x@y.co'));
  assert.strictEqual(L.parseContract([]), null);
});

test('las ofertas se ordenan, se quitan repetidas y se marca al ganador', () => {
  const o = L.parseOffers(OFFERS, '900123456-1');
  assert.strictEqual(o.cantidad, 2);
  assert.deepStrictEqual(o.proveedores.map(p => [p.proveedor, p.ganador]), [['ACEROS SAS', true], ['OTRA SAS', false]]);
  assert.strictEqual(L.parseOffers([]), null);
});

test('quién le gana a la entidad: mismos filtros que el perfil nacional y sin documentos', async () => {
  const params = {
    nitEntidad: "800223337", modalities: ["Contratación régimen especial", "Contratación régimen especial (con ofertas)"],
    desde: '2025-10-02', valorMin: 50000000, tipos: ['Obra', 'Suministros']
  };
  const urls = L.entityWinnersUrls(params);
  const where = decodeURIComponent(urls.top);
  assert.ok(where.includes("nit_entidad = '800223337'"));
  assert.ok(where.includes("modalidad_de_contratacion in ('Contratación régimen especial', 'Contratación régimen especial (con ofertas)')"));
  assert.ok(where.includes("fecha_de_firma >= '2025-10-02T00:00:00'") && where.includes('valor_del_contrato >= 50000000'));
  assert.ok(where.includes("tipo_de_contrato in ('Obra', 'Suministros')"));
  assert.ok(urls.top.startsWith('https://www.datos.gov.co/resource/jbjy-vk9h.json?') && !where.includes('documento'));

  const fetchFn = url => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(url.includes('group')
      ? [{ proveedor_adjudicado: 'Jardín Botánico de Medellín', tipodocproveedor: 'NIT', n: '8', v: '1000' },
        { proveedor_adjudicado: 'Rafael Demo', tipodocproveedor: 'Cédula de Ciudadanía', n: '2', v: '50' },
        { proveedor_adjudicado: 'No Definido', tipodocproveedor: 'No Definido', n: '1', v: '1' }]
      : [{ n: '15', v: '2000' }])
  });
  L.clearCache();
  const r = await L.entityWinners(params, { fetchFn });
  assert.strictEqual(r.contratos, 15);
  assert.deepStrictEqual(r.rows.map(x => [x.nombre, x.contratos, x.persona_natural]),
    [['Jardín Botánico de Medellín', 8, false], ['Rafael Demo', 2, true]]);
  assert.strictEqual(await L.entityWinners({ ...params, modalities: [] }, { fetchFn }), null);
});

test('las cifras de la entidad salen de una fila agregada', () => {
  assert.deepStrictEqual(L.parseEntity(ENTITY), { contratos_12m: 120, valor_12m: 2e11, pagado_sobre_facturado_pct: 91 });
  assert.strictEqual(L.parseEntity([{ contratos: '0' }]), null);
});

test('un proceso adjudicado en vivo usa el valor adjudicado, como el tablero', () => {
  const p = L.parseProcess(PROCESS);
  assert.strictEqual(p.precio, 950);
  assert.strictEqual(p.fecha_adjudicacion, '2026-09-24T00:00:00');
  assert.deepStrictEqual(p.contratista, { nombre: 'CONSORCIO VIAS', es_consorcio: true });
  assert.ok(/adjudicado/i.test(p.etapa_comercial));
  assert.strictEqual(p.url_secop, 'https://community.secop.gov.co/y');
  assert.strictEqual(L.parseProcess([]), null);
});

test('el detalle en vivo junta las tres consultas y una falla no tumba las demás', async () => {
  L.clearCache();
  const calls = [];
  const fetchFn = fakeFetch({ 'jbjy-vk9h.json?%24where=proceso': CONTRACTS, 'wi7w-2nvm': new Error('timeout'), 'jbjy-vk9h.json?%24select': ENTITY }, calls);
  const r = await L.processDetail({ portfolio: 'CO1.BDOS.1', nitEntidad: '890', winnerNit: '900123456' }, { fetchFn });
  assert.strictEqual(r.contrato.valor, 1500);
  assert.strictEqual(r.ofertas, null);
  assert.deepStrictEqual(r.errores, ['ofertas']);
  assert.strictEqual(r.entidad_stats.contratos_12m, 120);
  // Caché de la sesión: repetir no vuelve a consultar lo que funcionó; lo que falló sí se reintenta.
  const before = calls.length;
  await L.processDetail({ portfolio: 'CO1.BDOS.1', nitEntidad: '890', winnerNit: '900123456' }, { fetchFn });
  assert.strictEqual(calls.length - before, 1);
  assert.ok(calls[calls.length - 1].includes('wi7w-2nvm'));
});

test('sin portafolio ni NIT no se consulta nada', async () => {
  L.clearCache();
  const calls = [];
  const r = await L.processDetail({}, { fetchFn: fakeFetch({}, calls) });
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(r.contrato, null);
});
