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
   * Filtros del usuario. `filters`: { query, sector, stage, minBudget, department, onlyNew }.
   * Los campos ausentes o en su valor neutro ('todos', 0, '') no filtran.
   */
  function applyFilters(items, filters = {}) {
    const query = (filters.query || '').toLowerCase().trim();
    const sector = filters.sector || 'todos';
    const department = filters.department || 'todos';
    const minBudget = Number(filters.minBudget) || 0;

    return items.filter(item => {
      if (filters.onlyNew && !item.nueva) return false;
      if (query && !searchCorpus(item).includes(query)) return false;
      if (!matchesSector(item, sector)) return false;
      if (!matchesStage(item, filters.stage)) return false;
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
