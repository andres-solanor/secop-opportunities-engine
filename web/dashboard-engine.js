/**
 * Motor del tablero: funciones puras (sin DOM) para filtrar, ordenar, resumir y exportar
 * oportunidades. `app.js` solo lee los controles, llama a estas funciones y pinta.
 *
 * Se expone como window.DashboardEngine y como módulo CommonJS para pruebas con Node.
 */
(function (root) {
  const EMPTY_NAMES = ['Pendiente por Adjudicar', 'No Definido', 'No definido'];
  const SIN_CLASIFICAR = 'sin_clasificar';
  // "Otros" en el filtro de sector: no son sectores de la taxonomía, salen de hidden.js.
  // Los seguros van aparte e identificados: solo una aseguradora puede ofertar en ellos.
  const SEGUROS = 'seguros';
  const OTHER_OPTIONS = [
    { id: SIN_CLASIFICAR, name: 'Otros: sin sector' },
    { id: SEGUROS, name: 'Otros: seguros (solo aseguradoras)' }
  ];

  function isInsurance(item) {
    return (item.tipo_contrato || '') === 'Seguros';
  }

  function isOtherSector(sector) {
    return sector === SIN_CLASIFICAR || sector === SEGUROS;
  }

  /** ¿La oportunidad pertenece al sector elegido? Incluye las dos opciones de "Otros". */
  function matchesSector(item, sector) {
    if (!sector || sector === 'todos') return true;
    if (sector === SEGUROS) return isInsurance(item);
    const inSector = (item.sectores || []).some(s => s.id === sector);
    return sector === SIN_CLASIFICAR ? inSector && !isInsurance(item) : inSector;
  }

  function isAwarded(item) {
    return (item.etapa_comercial || '').toLowerCase().includes('adjudicado');
  }

  /** Oportunidades que pertenecen a una pestaña, antes de aplicar los filtros del usuario. */
  function tabItems(items, tab, ctx = {}) {
    if (tab === 'proveedores') return items.filter(isAwarded);
    if (tab === 'observatorio') return items.filter(i => !isAwarded(i));
    if (tab === 'parati') return items.filter(i => (ctx.matchScore ? ctx.matchScore(i) : 0) >= (ctx.minMatch || 0));
    if (tab === 'crm') return items.filter(i => ctx.crmState && ctx.crmState[i.id]);
    return items;
  }

  /** Minúsculas y sin tildes: SECOP escribe la misma modalidad con y sin tildes, y el PAA en MAYÚSCULAS. */
  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  // ---------- Modalidad de contratación ----------
  // Valores reales (2026-10-01): "Selección abreviada subasta inversa", "Licitación pública Obra
  // Publica", "Contratación régimen especial (con ofertas)", "Mínima cuantía"; en el PAA,
  // "SELECCION ABREVIADA CON SUBASTA INVERSA", "LICITACION PUBLICA (OBRA PUBLICA)" o vacío.
  // "Enajenación de bienes con subasta" no es subasta inversa: cae en "Otras modalidades".
  const MODALITIES = [
    { id: 'licitacion', label: 'Licitación pública', match: 'licitacion publica' },
    { id: 'menor_cuantia', label: 'Menor cuantía', match: 'menor cuantia' },
    { id: 'subasta', label: 'Subasta inversa', match: 'subasta inversa' },
    { id: 'minima_cuantia', label: 'Mínima cuantía', match: 'minima cuantia' },
    { id: 'concurso', label: 'Concurso de méritos', match: 'concurso de meritos' },
    { id: 'regimen_especial', label: 'Régimen especial', match: 'regimen especial' },
    { id: 'directa', label: 'Contratación directa', match: 'contratacion directa' },
    { id: 'otra', label: 'Otras modalidades' },
    { id: 'sin_dato', label: 'Sin modalidad reportada' }
  ];
  const EMPTY_MODALITY = ['', 'no definido', 'null'];

  function modalityOf(item) {
    const m = normalize(item.modalidad);
    if (EMPTY_MODALITY.includes(m)) return 'sin_dato';
    const found = MODALITIES.find(x => x.match && m.includes(x.match));
    return found ? found.id : 'otra';
  }

  /** Etiqueta corta para la ficha; las modalidades poco comunes conservan su texto original. */
  function modalityLabel(item) {
    const id = modalityOf(item);
    if (id === 'sin_dato') return '';
    if (id === 'otra') return item.modalidad;
    return MODALITIES.find(x => x.id === id).label;
  }

  // ---------- Persona natural ----------
  // Del perfil del proponente que publica el pipeline (meta.perfil_proponente): por modalidad,
  // qué parte de los contratos parecidos a los del tablero la ganó una persona natural.
  // Umbral elegido por el dueño el 2026-10-01 viendo la tabla calculada (mínima cuantía 18,8 %,
  // subasta 14,7 %, menor cuantía 14,3 %, régimen especial 12,8 %, licitación < 5 %).
  const PERSONA_NATURAL = 'persona_natural';
  const PERSONA_NATURAL_MIN_PCT = 12;
  const PROFILE_MIN_CONTRACTS = 100; // con menos contratos con dato, el porcentaje no es estable

  /** { idModalidad: { pct, natural, juridica, contratos } }; las filas se agrupan como el filtro. */
  function bidderShares(profile) {
    const acc = {};
    ((profile && profile.modalidades) || []).forEach(row => {
      const id = modalityOf({ modalidad: row.modalidad });
      if (id === 'otra' || id === 'sin_dato') return;
      const a = acc[id] || (acc[id] = { natural: 0, juridica: 0 });
      a.natural += row.persona_natural || 0;
      a.juridica += row.juridica || 0;
    });
    const out = {};
    Object.entries(acc).forEach(([id, a]) => {
      const known = a.natural + a.juridica;
      if (known >= PROFILE_MIN_CONTRACTS) {
        out[id] = { pct: Math.round((a.natural / known) * 1000) / 10, natural: a.natural, juridica: a.juridica, contratos: known };
      }
    });
    return out;
  }

  /** La cifra de la modalidad de la oportunidad, o null si no hay dato suficiente. */
  function personaNaturalShare(shares, item) {
    return (shares && shares[modalityOf(item)]) || null;
  }

  /**
   * La cifra si la modalidad supera el umbral (para el badge y el filtro); si no, null.
   * Un adjudicado ya no admite proponentes: no se marca (el detalle sigue mostrando la cifra).
   */
  function personaNaturalFriendly(shares, item) {
    if (isAwarded(item)) return null;
    const share = personaNaturalShare(shares, item);
    return share && share.pct >= PERSONA_NATURAL_MIN_PCT ? share : null;
  }

  function modalityCounts(items) {
    const counts = {};
    items.forEach(item => {
      const id = modalityOf(item);
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }

  // ---------- Fecha del estado actual ----------
  // Un solo filtro de tiempo para todas las pestañas: mide la fecha que importa según el estado.
  //   adjudicado → fecha de adjudicación; publicado o en borrador → fecha de publicación;
  //   compra planeada (PAA) → primer día del mes esperado (fecha futura).
  const AGE_PAST = [
    { id: '7', label: 'últimos 7 días', maxDays: 7 },
    { id: '30', label: 'últimos 30 días', maxDays: 30 },
    { id: '90', label: 'últimos 90 días', maxDays: 90 },
    { id: 'gt90', label: 'hace más de 90 días', minDays: 91 }
  ];
  const AGE_FUTURE = [
    { id: 'mes', label: 'este mes', maxMonths: 0 },
    { id: '3m', label: 'próximos 3 meses', maxMonths: 2 }
  ];

  function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function isPlanned(item) {
    return item.mes_esperado != null && item.anio != null;
  }

  /**
   * Fecha del estado actual, o null si no se conoce. Un adjudicado sin fecha de adjudicación
   * devuelve null (no la de publicación): "adjudicado hace 7 días" no puede ser una suposición.
   */
  function stateDate(item) {
    if (isPlanned(item)) return new Date(Number(item.anio), Number(item.mes_esperado) - 1, 1);
    const fechas = item.fechas || {};
    if (isAwarded(item)) return toDate(fechas.adjudicacion || item.fecha_adjudicacion);
    return toDate(fechas.publicacion || item.fecha_publicacion);
  }

  /** Opciones del filtro de tiempo para una pestaña: el PAA mira hacia adelante; el CRM no filtra. */
  function ageOptions(tab) {
    if (tab === 'crm') return [];
    return tab === 'paa' ? AGE_FUTURE : AGE_PAST;
  }

  function matchesAge(item, age, now = new Date()) {
    if (!age || age === 'todas') return true;
    const d = stateDate(item);
    if (!d) return false;
    const future = AGE_FUTURE.find(o => o.id === age);
    if (future) {
      const months = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
      return months >= 0 && months <= future.maxMonths;
    }
    const past = AGE_PAST.find(o => o.id === age);
    if (!past) return true;
    const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(d)) / (24 * 3600 * 1000));
    if (past.maxDays != null) return days <= past.maxDays;
    return days >= past.minDays;
  }

  /** Cuántas oportunidades no tienen fecha para el filtro de tiempo (no aparecen al filtrar). */
  function countUndated(items) {
    return items.filter(item => !stateDate(item)).length;
  }

  function matchesStage(item, stage) {
    if (!stage || stage === 'todos') return true;
    const text = (item.etapa_comercial || '').toLowerCase();
    if (stage === 'adjudicado') return text.includes('adjudicado');
    if (stage === 'ofertas') return text.includes('ofertas') || text.includes('abierta');
    if (stage === 'borrador') return text.includes('borrador');
    return true;
  }

  function searchCorpus(item) {
    return [
      item.referencia,
      item.entidad,
      item.descripcion,
      item.modalidad,
      item.contratista && item.contratista.nombre,
      item.contratista && item.contratista.nit,
      ...(item.materiales_detectados || [])
    ].join(' ').toLowerCase();
  }

  /**
   * Filtros del usuario. `filters`: { query, sector, stage, minBudget, department, onlyNew,
   * modality, age, bidderShares, now }. Los campos ausentes o en su valor neutro ('todos',
   * 'todas', 0, '') no filtran. `modality: 'persona_natural'` usa `bidderShares` (bidderShares()).
   * `now` solo existe para las pruebas.
   */
  function applyFilters(items, filters = {}) {
    const query = (filters.query || '').toLowerCase().trim();
    const sector = filters.sector || 'todos';
    const department = filters.department || 'todos';
    const modality = filters.modality || 'todas';
    const minBudget = Number(filters.minBudget) || 0;
    const now = filters.now || new Date();

    return items.filter(item => {
      if (filters.onlyNew && !item.nueva) return false;
      if (query && !searchCorpus(item).includes(query)) return false;
      if (!matchesSector(item, sector)) return false;
      if (!matchesStage(item, filters.stage)) return false;
      if (modality === PERSONA_NATURAL) {
        if (!personaNaturalFriendly(filters.bidderShares, item)) return false;
      } else if (modality !== 'todas' && modalityOf(item) !== modality) return false;
      if (!matchesAge(item, filters.age, now)) return false;
      const value = item.precio != null ? item.precio : item.valor;
      if (minBudget > 0 && (value || 0) < minBudget) return false;
      if (department !== 'todos' && item.departamento !== department) return false;
      return true;
    });
  }

  function isFiltered(filters = {}) {
    return Boolean(
      (filters.query || '').trim() ||
      (filters.sector && filters.sector !== 'todos') ||
      (filters.stage && filters.stage !== 'todos') ||
      (Number(filters.minBudget) || 0) > 0 ||
      (filters.department && filters.department !== 'todos') ||
      (filters.modality && filters.modality !== 'todas') ||
      (filters.age && filters.age !== 'todas') ||
      filters.onlyNew
    );
  }

  /** Cifras de las tarjetas KPI: todas salen de las listas, ninguna se escribe a mano. */
  function kpis(filtered, baseline) {
    const sum = list => list.reduce((acc, it) => acc + (it.precio || 0), 0);
    const filteredSum = sum(filtered);
    const baselineSum = sum(baseline);
    const scored = filtered.filter(it => typeof it.score_calidad === 'number');
    return {
      count: filtered.length,
      baselineCount: baseline.length,
      sum: filteredSum,
      baselineSum,
      pct: baselineSum > 0 ? Math.round((filteredSum / baselineSum) * 100) : null,
      avgScore: scored.length ? Math.round(scored.reduce((acc, it) => acc + it.score_calidad, 0) / scored.length) : null
    };
  }

  function formatCop(val) {
    if (val >= 1_000_000_000_000) {
      return `$${(val / 1_000_000_000_000).toFixed(2).replace('.', ',')} Billones COP`;
    } else if (val >= 1_000_000_000) {
      return `$${(val / 1_000_000_000).toFixed(1).replace('.', ',')} Mil Millones COP`;
    }
    return `$${Math.round(val / 1_000_000).toLocaleString('es-CO')} Millones COP`;
  }

  function departments(items) {
    return Array.from(new Set(items.map(i => i.departamento).filter(d => d && d !== 'No Definido'))).sort();
  }

  /** Opciones del filtro de sector, generadas desde la taxonomía del pipeline. */
  function sectorOptions(taxonomy) {
    return Object.keys(taxonomy || {}).map(id => ({ id, name: taxonomy[id].name }));
  }

  /**
   * Sectores agrupados por familia, en el orden de `groups` (window.SECTOR_GROUPS). Un sector
   * con un grupo desconocido (o una taxonomía vieja sin grupos) va a "Otros sectores".
   */
  function sectorGroups(taxonomy, groups) {
    const known = (groups || []).map(g => ({ id: g.id, name: g.name, sectors: [] }));
    const byId = new Map(known.map(g => [g.id, g]));
    const rest = { id: 'otros_sectores', name: 'Otros sectores', sectors: [] };
    sectorOptions(taxonomy).forEach(s => {
      (byId.get(taxonomy[s.id].grupo) || rest).sectors.push(s);
    });
    return [...known, rest].filter(g => g.sectors.length);
  }

  /** Cuántas oportunidades hay por sector (una oportunidad cuenta en cada uno de sus sectores). */
  function sectorCounts(items) {
    const counts = {};
    const add = id => { counts[id] = (counts[id] || 0) + 1; };
    items.forEach(item => {
      // Un seguro sin sector cuenta en "Otros: seguros", no en "Otros: sin sector".
      (item.sectores || []).forEach(s => { if (!(s.id === SIN_CLASIFICAR && isInsurance(item))) add(s.id); });
      if (isInsurance(item)) add(SEGUROS);
    });
    return counts;
  }

  /**
   * "Otros" en Radar B2B y Observatorio: los procesos sin sector de hidden.js, repartidos igual
   * que el tablero (adjudicados al Radar, el resto al Observatorio). Es una muestra: hidden.js
   * trae los de mayor puntaje, no todos.
   */
  function otherItems(hiddenItems, tab) {
    const unclassified = (hiddenItems || []).filter(i => i.motivo === 'sin_sector');
    return tab === 'proveedores' || tab === 'observatorio' ? tabItems(unclassified, tab) : [];
  }

  /** Sectores con más valor en una lista, para la tarjeta KPI (valor en COP, de mayor a menor). */
  function topSectors(items, taxonomy, n) {
    const acc = new Map();
    items.forEach(item => (item.sectores || []).forEach(s => {
      if (!taxonomy || !taxonomy[s.id]) return;
      const cur = acc.get(s.id) || { id: s.id, name: taxonomy[s.id].name, value: 0, count: 0 };
      cur.value += item.precio || 0;
      cur.count += 1;
      acc.set(s.id, cur);
    }));
    return [...acc.values()].sort((a, b) => b.value - a.value || b.count - a.count).slice(0, n);
  }

  /** El CRM guarda ids; una oportunidad puede salir del dataset en una sincronización posterior. */
  function crmSummary(crmState, items) {
    const present = new Set(items.map(i => i.id));
    const ids = Object.keys(crmState || {});
    const active = ids.filter(id => present.has(id));
    return { total: ids.length, active: active.length, missing: ids.length - active.length };
  }

  // ---------- CSV ----------
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    let text = String(value);
    // Una celda que empieza por = + - @ se ejecuta como fórmula al abrir el CSV en Excel.
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildCsv(headers, rows) {
    const lines = [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))];
    return '﻿' + lines.join('\r\n');
  }

  // ---------- Fuera del tablero ----------
  function familyOf(item) {
    return item.unspsc ? item.unspsc.slice(0, 4) : 'sin código';
  }

  /** `filters` agrega a los del tablero: { reason: 'todos'|'sin_sector'|'fuera_de_corte', family }. */
  function filterHidden(items, filters = {}) {
    const reason = filters.reason || 'todos';
    const family = filters.family || 'todas';
    const base = items.filter(item => {
      if (reason !== 'todos' && item.motivo !== reason) return false;
      if (family !== 'todas' && familyOf(item) !== family) return false;
      return true;
    });
    return applyFilters(base, filters);
  }

  /** Familias UNSPSC presentes, de mayor a menor número de procesos. */
  function hiddenFamilies(items) {
    const groups = new Map();
    items.forEach(item => {
      const key = familyOf(item);
      const g = groups.get(key) || { family: key, count: 0, value: 0 };
      g.count += 1;
      g.value += item.precio || 0;
      groups.set(key, g);
    });
    return Array.from(groups.values()).sort((a, b) => b.count - a.count || b.value - a.value);
  }

  const api = {
    EMPTY_NAMES,
    SIN_CLASIFICAR,
    SEGUROS,
    OTHER_OPTIONS,
    isAwarded,
    isInsurance,
    isOtherSector,
    matchesSector,
    tabItems,
    MODALITIES,
    modalityOf,
    modalityLabel,
    modalityCounts,
    PERSONA_NATURAL,
    PERSONA_NATURAL_MIN_PCT,
    bidderShares,
    personaNaturalShare,
    personaNaturalFriendly,
    stateDate,
    ageOptions,
    matchesAge,
    countUndated,
    applyFilters,
    isFiltered,
    kpis,
    formatCop,
    departments,
    sectorOptions,
    sectorGroups,
    sectorCounts,
    otherItems,
    topSectors,
    crmSummary,
    csvCell,
    buildCsv,
    familyOf,
    filterHidden,
    hiddenFamilies
  };

  root.DashboardEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
