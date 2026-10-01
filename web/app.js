/**
 * SECOP II Opportunities Engine & Lead Observatory
 * Frontend Controller & Mini-CRM Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let rawData = window.PROSPECTS_DATA || [];
  let currentTab = 'proveedores'; // 'parati' | 'proveedores' | 'observatorio' | 'crm'
  const Profile = window.SecopProfile;
  const Engine = window.ProfileEngine;
  const Dash = window.DashboardEngine;
  const TAXONOMY = window.SECTOR_TAXONOMY || {};
  const SECTOR_GROUPS = window.SECTOR_GROUPS || [];
  const sortSelect = document.getElementById('sortSelect');
  // "Fuera del tablero": lo que pasó el filtro de ruido pero no está en la selección curada.
  // Oculto por defecto; el archivo (hidden.js) se descarga solo cuando el usuario abre la vista
  // o elige "Otros" en el filtro de sector.
  const SHOW_HIDDEN_KEY = 'secop_show_hidden';
  const HIDDEN_REASONS = {
    sin_sector: { label: 'Sin clasificar', tone: 'warn', tip: 'Pasa el filtro de ruido pero no coincide con ningún sector configurado.' },
    fuera_de_corte: { label: 'Clasificada, fuera del corte', tone: 'info', tip: 'Coincide con un sector, pero no entró a la selección del tablero por puntaje.' },
    convenio: { label: 'Convenio abierto (ESAL)', tone: 'warn', tip: 'Convenio con una entidad sin ánimo de lucro aún sin adjudicar: una empresa no puede ofertar. Cuando se adjudique, el operador puede ser tu cliente.' }
  };
  // Pestañas donde "Otros" tiene sentido: sus procesos salen de hidden.js y se reparten como el tablero.
  const OTHER_TABS = ['proveedores', 'observatorio', 'hidden'];
  const sectorOptionEls = new Map(); // opciones del filtro de sector: id → { el, name }
  let showHidden = localStorage.getItem(SHOW_HIDDEN_KEY) === '1';
  let hiddenPayload = null;
  let hiddenLoad = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
  const hiddenControls = document.getElementById('hiddenControls');
  const hiddenReasonSelect = document.getElementById('hiddenReasonSelect');
  const hiddenFamilySelect = document.getElementById('hiddenFamilySelect');
  const hiddenToggle = document.getElementById('toggleHidden');
  const tabHidden = document.getElementById('tabHidden');
  const DAY_MS = 24 * 3600 * 1000;
  // Nota: las constantes usadas por las fichas deben declararse aquí, antes del primer renderView().
  const ACRONYMS = ['PAE', 'ESP', 'E.S.P.', 'SAS', 'S.A.S.', 'LED', 'SGR', 'SGP', 'IPS', 'ESE', 'ICBF', 'SENA', 'EPM', 'UT', 'BPIN', 'CDP', 'INVIAS', 'ANI', 'IE', 'PTAR', 'PTAP', 'SENA', 'EDU'];
  // Filtro de tiempo: la fecha que mide depende de la pestaña (DashboardEngine.stateDate).
  const AGE_PREFIX = {
    proveedores: 'Adjudicado',
    observatorio: 'Publicado',
    paa: 'Se publica',
    parati: 'Último movimiento',
    hidden: 'Último movimiento'
  };
  const modalityOptionEls = new Map(); // opciones del filtro de modalidad: id → { el, label }
  let ageTab = null; // pestaña para la que se armaron las opciones del filtro de tiempo

  // Etiqueta de la ficha según la ventana real de participación (ProfileEngine.bidWindow).
  const STATE_LABELS = {
    abierta: { text: 'Recibe ofertas', cls: 'stage-ofertas' },
    borrador: { text: 'Borrador de pliegos', cls: 'stage-borrador' },
    cerrada: { text: 'Ofertas cerradas', cls: 'stage-cerrada' },
    adjudicado: { text: 'Adjudicado', cls: 'stage-adjudicado' }
  };
  const TAB_BASE_NAMES = {
    parati: 'oportunidades para ti',
    proveedores: 'contratos adjudicados',
    observatorio: 'licitaciones abiertas',
    crm: 'oportunidades en CRM',
    paa: 'compras planeadas',
    hidden: 'procesos fuera del tablero'
  };
  const MIN_MATCH_SCORE = 55;
  let matchCache = new Map();
  let crmState = JSON.parse(localStorage.getItem('secop_crm_state') || '{}');

  // DOM Elements
  const cardsGrid = document.getElementById('cardsGrid');
  const crmKanban = document.getElementById('crmKanban');
  const searchInput = document.getElementById('searchInput');
  const sectorSelect = document.getElementById('sectorSelect');
  const stageSelect = document.getElementById('stageSelect');
  const budgetSelect = document.getElementById('budgetSelect');
  const departmentSelect = document.getElementById('departmentSelect');
  const modalitySelect = document.getElementById('modalitySelect');
  const ageSelect = document.getElementById('ageSelect');
  const resultsCount = document.getElementById('resultsCount');
  const btnResetFilters = document.getElementById('btnResetFilters');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const META = window.PROSPECTS_META || null;
  // Persona natural: cifra por modalidad calculada por el pipeline (meta.perfil_proponente).
  const BIDDER_SHARES = Dash.bidderShares(META && META.perfil_proponente);
  // Cifras por entidad (NIT) para las fichas livianas y el PAA: una entrada por entidad.
  const ENTITY_STATS = window.ENTITY_STATS || {};
  const HAS_BIDDER_SHARES = Object.keys(BIDDER_SHARES).length > 0;
  // Compras planeadas (Plan Anual de Adquisiciones): se normaliza `precio` para reutilizar KPIs y filtros.
  const PAA = (window.PAA_DATA || []).map(x => ({ ...x, precio: x.valor }));
  const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let onlyNew = false;
  const detailModal = document.getElementById('detailModal');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');

  // KPIs
  const kpiTotalPipeline = document.getElementById('kpiTotalPipeline');
  const kpiTotalOpps = document.getElementById('kpiTotalOpps');
  const kpiAvgScore = document.getElementById('kpiAvgScore');

  window.showAppToast = showToast;

  // Initialize
  initSectors();
  initModalities();
  initDepartments();
  applyHiddenVisibility();
  if (Profile && Profile.getProfile()) activateTab('parati');
  renderView();

  // Tab listeners
  document.querySelectorAll('.view-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => activateTab(tabBtn.dataset.tab));
  });

  function activateTab(tab) {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    currentTab = tab;
    if (tab === 'hidden') loadHidden();
    if (Dash.isOtherSector(sectorSelect.value) && !OTHER_TABS.includes(tab)) sectorSelect.value = 'todos';
    renderView();
  }

  /** "Otros" en Radar u Observatorio: se muestran procesos sin sector de hidden.js (fichas livianas). */
  function otherMode() {
    return Dash.isOtherSector(sectorSelect.value) && (currentTab === 'proveedores' || currentTab === 'observatorio');
  }

  // ---------- Fuera del tablero ----------
  function applyHiddenVisibility() {
    tabHidden.hidden = !showHidden;
    hiddenToggle.checked = showHidden;
  }

  hiddenToggle.addEventListener('change', () => {
    showHidden = hiddenToggle.checked;
    localStorage.setItem(SHOW_HIDDEN_KEY, showHidden ? '1' : '0');
    applyHiddenVisibility();
    if (showHidden) activateTab('hidden');
    else if (currentTab === 'hidden') activateTab('proveedores');
  });

  [hiddenReasonSelect, hiddenFamilySelect].forEach(el => el.addEventListener('input', () => renderView()));

  /** Descarga hidden.js la primera vez que se abre la vista. */
  function loadHidden() {
    if (hiddenLoad !== 'idle') return;
    hiddenLoad = 'loading';
    const script = document.createElement('script');
    script.src = `hidden.js?v=${encodeURIComponent(window.PROSPECTS_UPDATED_AT || '')}`;
    script.onload = () => {
      hiddenPayload = window.HIDDEN_DATA || null;
      hiddenLoad = hiddenPayload ? 'ready' : 'error';
      if (hiddenPayload) {
        Dash.hiddenFamilies(hiddenPayload.items).forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.family;
          opt.textContent = `${g.family} · ${g.count} ${g.count === 1 ? 'proceso' : 'procesos'}`;
          hiddenFamilySelect.appendChild(opt);
        });
      }
      renderView();
    };
    script.onerror = () => {
      hiddenLoad = 'error';
      renderView();
    };
    document.head.appendChild(script);
  }

  function hiddenItems() {
    return hiddenPayload ? hiddenPayload.items : [];
  }

  window.showForYouTab = () => {
    activateTab('parati');
    document.getElementById('tabParaTi').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (Profile) {
    Profile.onChange(() => {
      matchCache = new Map();
      renderView();
    });
  }

  // Afinidad perfil ↔ oportunidad (memoizada por perfil activo)
  function getMatch(item) {
    if (!Profile || !Profile.getProfile()) return null;
    if (!matchCache.has(item.id)) matchCache.set(item.id, Profile.matchItem(item));
    return matchCache.get(item.id);
  }

  function forYouItems() {
    return rawData.filter(i => (getMatch(i)?.score || 0) >= MIN_MATCH_SCORE);
  }

  // Filter input listeners
  [searchInput, sectorSelect, stageSelect, budgetSelect, departmentSelect, sortSelect, modalitySelect, ageSelect].forEach(el => {
    el.addEventListener('input', () => renderView());
  });
  sectorSelect.addEventListener('input', () => {
    if (Dash.isOtherSector(sectorSelect.value)) loadHidden();
  });

  btnResetFilters.addEventListener('click', () => {
    searchInput.value = '';
    sectorSelect.value = 'todos';
    stageSelect.value = 'todos';
    budgetSelect.value = '0';
    departmentSelect.value = 'todos';
    modalitySelect.value = 'todas';
    ageSelect.value = 'todas';
    sortSelect.value = 'relevancia';
    hiddenReasonSelect.value = 'todos';
    hiddenFamilySelect.value = 'todas';
    onlyNew = false;
    renderView();
    showToast('Filtros restablecidos', 'info');
  });

  btnExportCsv.addEventListener('click', () => {
    exportFilteredToCsv();
  });

  document.getElementById('syncStatus').addEventListener('click', openSyncModal);

  modalClose.addEventListener('click', () => {
    detailModal.classList.remove('active');
  });

  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) detailModal.classList.remove('active');
  });

  // Accesibilidad de todos los modales (incluido el de perfil): al abrir, el foco entra al
  // modal; al cerrar, vuelve a donde estaba; Escape cierra con el botón de cierre del propio modal.
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    let returnFocus = null;
    new MutationObserver(() => {
      const open = overlay.classList.contains('active');
      if (open && !overlay.dataset.open) {
        overlay.dataset.open = '1';
        returnFocus = document.activeElement;
        const close = overlay.querySelector('.modal-close');
        if (close) close.focus();
      } else if (!open && overlay.dataset.open) {
        delete overlay.dataset.open;
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = Array.from(document.querySelectorAll('.modal-overlay.active')).pop();
    const close = open && open.querySelector('.modal-close');
    if (close) close.click();
  });

  // El filtro de sector se arma con la taxonomía del pipeline, agrupado por familia: un sector
  // nuevo aparece solo. Al final, "Otros" (sin sector y seguros), que se carga de hidden.js.
  function initSectors() {
    const addGroup = (label, sectors) => {
      const group = document.createElement('optgroup');
      group.label = label;
      sectors.forEach(({ id, name }) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        group.appendChild(opt);
        sectorOptionEls.set(id, { el: opt, name });
      });
      sectorSelect.appendChild(group);
    };
    Dash.sectorGroups(TAXONOMY, SECTOR_GROUPS).forEach(g => addGroup(g.name, g.sectors));
    addGroup('Otros', Dash.OTHER_OPTIONS);
  }

  /** Conteo de la pestaña activa junto a cada sector; "Otros" solo donde aplica y con hidden.js cargado. */
  function updateSectorCounts() {
    const base = currentTab === 'hidden' ? hiddenItems() : tabBaseline();
    const counts = Dash.sectorCounts(base);
    const others = currentTab === 'hidden' ? counts
      : hiddenLoad === 'ready' ? Dash.sectorCounts(Dash.otherItems(hiddenItems(), currentTab)) : null;
    sectorOptionEls.forEach(({ el, name }, id) => {
      const isOther = Dash.isOtherSector(id);
      el.disabled = isOther && !OTHER_TABS.includes(currentTab);
      const n = isOther ? (others ? others[id] || 0 : null) : counts[id] || 0;
      el.textContent = n === null || el.disabled ? name : `${name} (${n})`;
    });
  }

  function sectorName(id) {
    return sectorOptionEls.get(id)?.name || id;
  }

  function sectorGroupName(id) {
    return Dash.sectorGroups(TAXONOMY, SECTOR_GROUPS).find(g => g.sectors.some(s => s.id === id))?.name || '';
  }

  // Helper: Extract unique departments for dropdown
  function initDepartments() {
    Dash.departments(rawData).forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      departmentSelect.appendChild(opt);
    });
  }

  // Filter Pipeline (la lógica vive en dashboard-engine.js; aquí solo se leen los controles)
  function currentFilters() {
    return {
      query: searchInput.value,
      sector: sectorSelect.value,
      stage: stageSelect.value,
      minBudget: budgetSelect.value,
      department: departmentSelect.value,
      modality: modalitySelect.value,
      age: ageSelect.value,
      bidderShares: BIDDER_SHARES,
      onlyNew
    };
  }

  // Modalidad de contratación: catálogo del motor, con el conteo de la pestaña activa.
  // Primero, si el pipeline publicó el perfil del proponente, "más accesibles a persona natural".
  function initModalities() {
    const options = HAS_BIDDER_SHARES
      ? [{ id: Dash.PERSONA_NATURAL, label: '🧑‍💼 Más accesibles a persona natural' }, ...Dash.MODALITIES]
      : Dash.MODALITIES;
    options.forEach(({ id, label }) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      modalitySelect.appendChild(opt);
      modalityOptionEls.set(id, { el: opt, label });
    });
  }

  /** Las modalidades sin procesos en la pestaña se ocultan, salvo la que está elegida. */
  function updateModalityCounts(base) {
    const counts = Dash.modalityCounts(base);
    if (HAS_BIDDER_SHARES) counts[Dash.PERSONA_NATURAL] = base.filter(i => friendlyShare(i)).length;
    modalityOptionEls.forEach(({ el, label }, id) => {
      const n = counts[id] || 0;
      el.textContent = `${label} (${n})`;
      el.hidden = n === 0 && modalitySelect.value !== id;
    });
  }

  /** El filtro de tiempo se rearma al cambiar de pestaña: mira atrás en el tablero y adelante en el PAA. */
  function updateAgeOptions() {
    if (ageTab === currentTab) return;
    const options = Dash.ageOptions(currentTab);
    const prefix = AGE_PREFIX[currentTab] || 'Fecha';
    const keep = options.some(o => o.id === ageSelect.value) ? ageSelect.value : 'todas';
    ageSelect.innerHTML = '';
    ageSelect.appendChild(new Option('Cualquier fecha', 'todas'));
    options.forEach(o => ageSelect.appendChild(new Option(`${prefix}: ${o.label}`, o.id)));
    ageSelect.value = keep;
    ageSelect.hidden = !options.length;
    ageTab = currentTab;
  }

  /** Base de los conteos de los filtros: lo que hay en la pestaña antes de filtrar. */
  function filterBase() {
    if (currentTab === 'hidden') return hiddenItems();
    if (otherMode()) return Dash.otherItems(hiddenItems(), currentTab);
    return tabBaseline();
  }

  function tabContext() {
    return { matchScore: i => getMatch(i)?.score || 0, minMatch: MIN_MATCH_SCORE, crmState };
  }

  /** La lista liviana no trae todas las fechas: solo se ordena por valor o por publicación. */
  function sortHidden(list) {
    const mode = sortSelect.value;
    if (mode === 'valor') return [...list].sort((a, b) => (b.precio || 0) - (a.precio || 0));
    if (mode === 'recientes') return [...list].sort((a, b) => String(b.fecha_publicacion || '').localeCompare(String(a.fecha_publicacion || '')));
    if (mode === 'cierre') {
      const key = it => (it.cierre_ofertas && it.cierre_ofertas >= new Date().toISOString().slice(0, 19) ? it.cierre_ofertas : '9999');
      return [...list].sort((a, b) => key(a).localeCompare(key(b)));
    }
    return list;
  }

  /** Todo lo que pertenece a la pestaña activa, antes de los filtros del usuario. */
  function tabBaseline() {
    if (currentTab === 'paa') return PAA;
    if (currentTab === 'hidden') return hiddenItems();
    return Dash.tabItems(rawData, currentTab, tabContext());
  }

  function getFilteredData() {
    const filters = currentFilters();
    if (currentTab === 'paa') {
      // El PAA no tiene etapa ni departamento de la entidad: aplican texto, sector, valor, modalidad y mes.
      return Dash.applyFilters(PAA, {
        query: filters.query, sector: filters.sector, minBudget: filters.minBudget,
        modality: filters.modality, age: filters.age, bidderShares: filters.bidderShares
      });
    }
    if (currentTab === 'hidden') {
      return sortHidden(Dash.filterHidden(hiddenItems(), {
        ...filters, onlyNew: false, reason: hiddenReasonSelect.value, family: hiddenFamilySelect.value
      }));
    }
    if (otherMode()) {
      return sortHidden(Dash.applyFilters(Dash.otherItems(hiddenItems(), currentTab), { ...filters, onlyNew: false }));
    }
    // El CRM muestra todo lo guardado: los filtros no aplican al tablero kanban.
    const filtered = currentTab === 'crm' ? tabBaseline() : Dash.applyFilters(tabBaseline(), filters);

    if (currentTab === 'parati') {
      filtered.sort((a, b) => getMatch(b).score - getMatch(a).score || (b.precio || 0) - (a.precio || 0));
    }
    return sortByDate(filtered);
  }

  // ---------- Fechas ----------
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function hasTime(d) {
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  }

  function formatDate(d, { withTime = false } = {}) {
    if (!d) return '';
    const sameYear = d.getFullYear() === new Date().getFullYear();
    let txt = d.toLocaleDateString('es-CO', { weekday: withTime ? 'short' : undefined, day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
    if (withTime && hasTime(d)) txt += `, ${d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}`;
    return txt;
  }

  function relativeDays(d) {
    const days = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
    if (days === 0) return 'hoy';
    if (days === 1) return 'mañana';
    if (days === -1) return 'ayer';
    return days > 0 ? `en ${days} días` : `hace ${-days} días`;
  }

  /** Bloque de fechas de la ficha: lo más accionable primero (cierre o adjudicación). */
  function cardDatesHtml(item) {
    const bw = Engine.bidWindow(item);
    const rows = [];

    if (bw.state === 'abierta' && bw.date) {
      const urgency = bw.days < 3 ? 'urgent' : bw.days < 7 ? 'soon' : '';
      rows.push(`<div class="date-main ${urgency}">⏳ Cierra ${escapeHtml(relativeDays(bw.date))}<span>${escapeHtml(formatDate(bw.date, { withTime: true }))}</span></div>`);
    } else if (bw.state === 'abierta') {
      rows.push('<div class="date-main muted">⏳ Cierre de ofertas: consúltalo en el pliego</div>');
    } else if (bw.state === 'borrador') {
      rows.push('<div class="date-main">📝 Borrador: aún puedes presentar observaciones<span>La fecha de cierre se fija en el pliego definitivo</span></div>');
    } else if (bw.state === 'cerrada') {
      rows.push(`<div class="date-main muted">🔒 Ya no recibe ofertas${bw.date ? `<span>Cerró el ${escapeHtml(formatDate(bw.date, { withTime: true }))}</span>` : '<span>En evaluación o selección del contratista</span>'}</div>`);
    } else if (bw.state === 'adjudicado') {
      // Un lead adjudicado hace más de 90 días probablemente ya compró sus insumos principales.
      const aged = bw.date && (Date.now() - bw.date.getTime()) / DAY_MS > 90;
      rows.push(`<div class="date-main won ${aged ? 'aged' : ''}">🏆 ${bw.date ? `Adjudicado ${escapeHtml(relativeDays(bw.date))}<span>${escapeHtml(formatDate(bw.date))}${aged ? ' · contrato probablemente avanzado' : ''}</span>` : 'Adjudicado<span>Fecha de adjudicación no reportada</span>'}</div>`);
    }

    const meta = [];
    if (bw.published) meta.push(`📅 Publicado ${escapeHtml(formatDate(bw.published))} (${escapeHtml(relativeDays(bw.published))})`);
    const term = Engine.formatTerm(item.plazo);
    if (term) meta.push(`⏱️ Plazo de ejecución: ${escapeHtml(term)}`);
    if (meta.length) rows.push(`<div class="date-meta">${meta.join('<span class="dot">·</span>')}</div>`);

    return `<div class="card-dates">${rows.join('')}</div>`;
  }

  /** Orden por fechas cuando el usuario lo pide; si no, se respeta el orden de relevancia. */
  function sortByDate(list) {
    const mode = sortSelect.value;
    if (mode === 'relevancia') return list;
    const sorted = [...list];
    if (mode === 'cierre') {
      // Primero lo que cierra antes (y aún está abierto); después el resto por publicación.
      const key = it => {
        const bw = Engine.bidWindow(it);
        return bw.state === 'abierta' && bw.date ? bw.date.getTime() : Infinity;
      };
      sorted.sort((a, b) => key(a) - key(b));
    } else if (mode === 'recientes') {
      const key = it => {
        const bw = Engine.bidWindow(it);
        return (bw.state === 'adjudicado' && bw.date ? bw.date : bw.published)?.getTime() || 0;
      };
      sorted.sort((a, b) => key(b) - key(a));
    } else if (mode === 'valor') {
      sorted.sort((a, b) => (b.precio || 0) - (a.precio || 0));
    }
    return sorted;
  }

  function formatCop(val) {
    return Dash.formatCop(val);
  }

  // Update Top KPIs dynamically per active tab AND active filters
  function updateKpis(filteredItems = []) {
    const baseline = tabBaseline();
    const baseName = TAB_BASE_NAMES[currentTab] || 'esta vista';
    const k = Dash.kpis(filteredItems, baseline);
    const isFiltered = k.count !== k.baselineCount || Dash.isFiltered(currentFilters());

    // 1. Pipeline Total Card
    kpiTotalPipeline.textContent = formatCop(k.sum);
    const kpiPipelineSub = document.querySelector('.kpi-emerald .kpi-sub');
    if (kpiPipelineSub) {
      if (otherMode()) {
        // Los procesos de "Otros" no son parte del tablero: no se comparan con su total.
        kpiPipelineSub.textContent = 'En procesos sin sector (fuera del tablero)';
      } else if (isFiltered && k.pct !== null) {
        kpiPipelineSub.textContent = `de ${formatCop(k.baselineSum)} en ${baseName} (${k.pct}%)`;
      } else {
        kpiPipelineSub.textContent = `Total en ${k.baselineCount} ${baseName}`;
      }
    }

    // 2. Count Card
    kpiTotalOpps.textContent = k.count;
    const kpiOppsSub = document.querySelector('.kpi-cyan .kpi-sub');
    if (kpiOppsSub) {
      kpiOppsSub.textContent = otherMode() ? 'Muestra de procesos sin sector'
        : isFiltered ? `de ${k.baselineCount} disponibles en ${baseName}` : `Calificadas sin OPS ni prestación de servicios`;
    }

    // 3. Sector / Filter Card: con ~12 sectores ya no caben todos los nombres, solo los de más valor.
    const kpiSecTitle = document.getElementById('kpiSectorTitle');
    const kpiSecVal = document.getElementById('kpiSectorValue');
    const kpiSecSub = document.getElementById('kpiSectorSub');
    if (kpiSecTitle && kpiSecVal && kpiSecSub) {
      const sector = sectorSelect.value;
      if (sector !== 'todos') {
        kpiSecTitle.textContent = 'Sector Filtrado';
        kpiSecVal.textContent = sectorName(sector);
        kpiSecSub.textContent = Dash.isOtherSector(sector)
          ? 'Procesos que no están en el tablero'
          : [sectorGroupName(sector), !otherMode() && k.pct !== null ? `${k.pct}% del valor de ${baseName}` : ''].filter(Boolean).join(' · ');
      } else if (departmentSelect.value !== 'todos') {
        kpiSecTitle.textContent = 'Región Filtrada';
        kpiSecVal.textContent = departmentSelect.value;
        kpiSecSub.textContent = `Filtro geográfico activo`;
      } else {
        const sectors = Dash.sectorOptions(TAXONOMY);
        const top = Dash.topSectors(filteredItems, TAXONOMY, 2); // los nombres son largos: dos caben
        const more = sectors.length - top.length;
        kpiSecTitle.textContent = 'Sectores Clave';
        kpiSecVal.textContent = `${sectors.length} ${sectors.length === 1 ? 'sector' : 'sectores'}`;
        kpiSecSub.textContent = top.length
          ? `Más valor aquí: ${top.map(s => s.name).join(' · ')}${more > 0 ? ` y ${more} más` : ''}`
          : '';
      }
    }

    // 4. Quality Score Card
    kpiAvgScore.textContent = k.avgScore === null ? '—' : `${k.avgScore} / 100`;

    // Tab badges (Zero duplication: Adjudicados vs Open Tenders)
    document.getElementById('countProveedores').textContent = Dash.tabItems(rawData, 'proveedores').length;
    document.getElementById('countObservatorio').textContent = Dash.tabItems(rawData, 'observatorio').length;
    document.getElementById('countCrm').textContent = Dash.crmSummary(crmState, rawData).active;
    document.getElementById('countPaa').textContent = PAA.length;
    document.getElementById('countParaTi').textContent = Profile && Profile.getProfile() ? forYouItems().length : '✨';
    // Todo lo que pasó el filtro y no está en el tablero: sin clasificar + clasificados que no entraron.
    document.getElementById('countHidden').textContent = hiddenPayload ? hiddenPayload.total
      : (META?.embudo ? META.embudo.sin_clasificar + META.embudo.clasificados - META.embudo.en_tablero : '…');
  }

  // Render View depending on current tab
  function renderView() {
    updateAgeOptions();
    const filtered = getFilteredData();
    updateSectorCounts();
    updateModalityCounts(filterBase());
    updateKpis(filtered);
    hiddenControls.hidden = currentTab !== 'hidden';

    if (currentTab === 'crm') {
      cardsGrid.style.display = 'none';
      crmKanban.style.display = 'grid';
      renderCrmKanban();
    } else if (currentTab === 'hidden' || otherMode()) {
      cardsGrid.style.display = 'grid';
      crmKanban.style.display = 'none';
      renderHiddenCards(filtered);
    } else if (currentTab === 'paa') {
      cardsGrid.style.display = 'grid';
      crmKanban.style.display = 'none';
      renderPaaCards(filtered);
    } else {
      cardsGrid.style.display = 'grid';
      crmKanban.style.display = 'none';
      renderCards(filtered);
    }
    noteUndated();
  }

  /** Con el filtro de tiempo activo, se dice cuántos procesos quedan fuera por no tener fecha. */
  function noteUndated() {
    if (currentTab === 'crm' || ageSelect.value === 'todas') return;
    const undated = Dash.countUndated(filterBase());
    if (!undated) return;
    const note = document.createElement('span');
    note.className = 'freshness';
    note.textContent = ` · ${undated} sin fecha conocida no se muestran`;
    resultsCount.appendChild(note);
  }

  // ---------- Fuera del tablero: sin clasificar y clasificadas que no entraron ----------
  function hiddenMessage(icon, title, text) {
    return `<div class="empty-foryou"><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
  }

  function renderHiddenCards(items) {
    if (hiddenLoad === 'loading' || hiddenLoad === 'idle') {
      resultsCount.textContent = 'Cargando los procesos fuera del tablero…';
      cardsGrid.innerHTML = hiddenMessage('⏳', 'Cargando…', 'Se está descargando la lista de procesos fuera del tablero.');
      return;
    }
    if (hiddenLoad === 'error') {
      resultsCount.textContent = 'Fuera del tablero: sin datos';
      cardsGrid.innerHTML = hiddenMessage('🗂️', 'Aún no hay datos de esta vista', 'La lista se genera en cada sincronización con SECOP II. Estará disponible después de la próxima corrida.');
      return;
    }

    const p = hiddenPayload;
    if (otherMode()) {
      // hidden.js es una muestra (los de mayor puntaje): se dice cuántos hay en total.
      const sector = sectorSelect.value;
      const insurance = p.seguros || 0;
      const total = sector === Dash.SEGUROS ? insurance : p.sin_sector - insurance;
      const loaded = p.items.filter(i => i.motivo === 'sin_sector' && Dash.matchesSector(i, sector)).length;
      const what = sector === Dash.SEGUROS ? 'seguros' : 'procesos sin sector';
      resultsCount.innerHTML = `Mostrando <b>${items.length}</b> ${what} en esta pestaña · <span class="freshness">no están en el tablero; la web carga una muestra de ${loaded} de ${total} (los de mayor puntaje)</span>`;
    } else {
      const capped = p.total > p.items.length
        ? ` · la web carga ${p.items.length} de ${p.total}; el reporte completo está en <code>data/hidden_summary.md</code>`
        : '';
      resultsCount.innerHTML = `Mostrando <b>${items.length}</b> de ${p.items.length} procesos fuera del tablero · <span class="freshness">${p.sin_sector} sin clasificar, ${p.fuera_de_corte} clasificados fuera del corte y ${p.convenio || 0} convenios abiertos${capped}</span>`;
    }

    if (!items.length) {
      cardsGrid.innerHTML = hiddenMessage('🔍', 'Ningún proceso con estos filtros', otherMode()
        ? 'Cambia de pestaña, de sector o limpia la búsqueda.'
        : 'Cambia la familia UNSPSC, el motivo o la búsqueda.');
      return;
    }

    cardsGrid.innerHTML = items.map(lightCardHtml).join('');
  }

  // ---------- Compras planeadas (PAA) ----------
  function renderPaaCards(items) {
    resultsCount.innerHTML = `Mostrando <b>${items.length}</b> ${items.length === 1 ? 'compra planeada' : 'compras planeadas'} en los sectores del motor · <span class="freshness">Plan Anual de Adquisiciones ${new Date().getFullYear()}</span>`;
    if (!items.length) {
      cardsGrid.innerHTML = `<div class="empty-foryou"><div class="empty-icon">🗓️</div><h3>No hay compras planeadas con estos filtros</h3><p>El Plan Anual de Adquisiciones se actualiza en cada sincronización.</p></div>`;
      return;
    }
    cardsGrid.innerHTML = items.map(paaCardHtml).join('');
  }

  // Render Card Grid
  function renderCards(filtered = []) {
    resultsCount.innerHTML = `Mostrando <b>${filtered.length}</b> ${filtered.length === 1 ? 'oportunidad calificada' : 'oportunidades calificadas'}${onlyNew ? ' · <button class="link-btn" id="clearOnlyNew">solo nuevas ✕</button>' : ''}`;
    const clearOnlyNew = document.getElementById('clearOnlyNew');
    if (clearOnlyNew) clearOnlyNew.addEventListener('click', () => { onlyNew = false; renderView(); });

    if (currentTab === 'parati' && !(Profile && Profile.getProfile())) {
      resultsCount.innerHTML = 'Oportunidades ordenadas por afinidad con tu perfil';
      cardsGrid.innerHTML = `
        <div class="empty-foryou">
          <div class="empty-icon">✨</div>
          <h3>Crea tu perfil y te mostramos solo lo que es para ti</h3>
          <p>Cruzamos lo que ofreces, tu zona y tu tamaño con cada proceso de SECOP II y te explicamos por qué encaja.</p>
          <button class="btn btn-primary btn-lg" id="emptyForYouStart">Crear mi perfil en 2 minutos</button>
        </div>
      `;
      document.getElementById('emptyForYouStart').addEventListener('click', () => Profile && Profile.openWizard(0));
      return;
    }

    if (filtered.length === 0) {
      cardsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No se encontraron oportunidades con los filtros seleccionados</h3>
          <p>Intenta cambiar el sector, reducir el presupuesto mínimo o limpiar la búsqueda.</p>
        </div>
      `;
      return;
    }

    cardsGrid.innerHTML = filtered.map(item => createCardHtml(item)).join('');

    // Attach card event listeners
    filtered.forEach(item => {
      const cardEl = document.getElementById(`card-${item.id}`);
      if (!cardEl) return;

      // Contact Pitch Button
      const pitchBtn = cardEl.querySelector('.btn-pitch');
      if (pitchBtn) {
        pitchBtn.addEventListener('click', () => openPitchModal(item));
      }

      const detailBtn = cardEl.querySelector('.btn-detail');
      if (detailBtn) detailBtn.addEventListener('click', () => openDetailModal(item));

      // CRM Status Selector
      const crmSelect = cardEl.querySelector('.crm-select');
      if (crmSelect) {
        crmSelect.addEventListener('change', (e) => {
          updateCrmStatus(item.id, e.target.value);
        });
      }
    });
  }

  // ---------- Ficha de oportunidad ----------

  /** Pasa a minúsculas los textos en MAYÚSCULAS sostenidas, conservando siglas conocidas. */
  function readableText(text) {
    if (!text) return '';
    const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
    const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
    if (!letters.length || upper / letters.length < 0.7) return text;
    let out = text.toLowerCase().replace(/\s+/g, ' ').trim();
    ACRONYMS.forEach(ac => {
      const re = new RegExp(`(^|[^a-záéíóúñ])${ac.toLowerCase().replace(/\./g, '\\.')}(?=[^a-záéíóúñ]|$)`, 'g');
      out = out.replace(re, (m, pre) => pre + ac);
    });
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  /** "MARTHA ISABEL HERNANDEZ" → "Martha Isabel Hernandez". */
  function personName(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/(^|[\s-])([a-záéíóúñ])/g, (m, pre, ch) => pre + ch.toUpperCase());
  }

  function modalityLabel(item) {
    return Dash.modalityLabel(item) || '';
  }

  /** Cifra de persona natural de la modalidad si supera el umbral (DashboardEngine); si no, null. */
  function friendlyShare(item) {
    return Dash.personaNaturalFriendly(BIDDER_SHARES, item);
  }

  function cardBadges(item) {
    return Engine.cardBadges(item, new Date(), { personaNatural: friendlyShare(item) });
  }

  function badgeHtml(b) {
    return `<span class="badge badge-${b.tone}" title="${escapeHtml(b.tip)}">${b.icon} ${escapeHtml(b.label)}</span>`;
  }

  function winnerName(item) {
    const n = item.contratista?.nombre;
    return n && !['Pendiente por Adjudicar', 'No Definido', 'No definido'].includes(n) ? n : '';
  }

  function validNit(nit) {
    return nit && !['N/A', 'No Definido', 'No definido'].includes(nit) ? nit : '';
  }

  function historyLine(h) {
    if (!h || !h.contratos) return '';
    const since = h.primero ? ` desde ${new Date(h.primero).getFullYear()}` : '';
    return `${h.contratos} ${h.contratos === 1 ? 'contrato' : 'contratos'} en SECOP II · ${Engine.formatCopShort(h.valor_total || 0)}${since}`;
  }

  // ---------- Estructura común de las fichas (tablero, fuera del tablero y PAA) ----------

  /** Cifras de la entidad: las del registro (tablero) o las del diccionario por NIT (fichas livianas y PAA). */
  function entityStatsOf(item) {
    if (item.entidad_stats) return item.entidad_stats;
    const nit = String(item.nit_entidad || '').replace(/\D/g, '');
    return (nit && ENTITY_STATS[nit]) || null;
  }

  /**
   * Un registro liviano (hidden.js) con la forma que esperan bidWindow, cardDatesHtml, nextStep y
   * cardBadges: las fechas van dentro de `fechas` y las cifras de la entidad salen del diccionario.
   */
  function boardShape(item) {
    return {
      ...item,
      fechas: { publicacion: item.fecha_publicacion, cierre_ofertas: item.cierre_ofertas, adjudicacion: item.fecha_adjudicacion },
      entidad_stats: entityStatsOf(item)
    };
  }

  function badgeRowHtml(badges, max = 4) {
    if (!badges.length) return '';
    const visible = badges.slice(0, max);
    const more = badges.length - visible.length;
    return `<div class="badge-row">${visible.map(badgeHtml).join('')}${more > 0 ? `<span class="badge badge-more" title="Ver todos en el detalle">+${more}</span>` : ''}</div>`;
  }

  function stepHtml(step) {
    const date = step.date ? ` · <b>${escapeHtml(formatDate(step.date))}</b> (${escapeHtml(relativeDays(step.date))})` : '';
    return `<div class="next-step">➜ ${escapeHtml(step.text)}${date}</div>`;
  }

  /**
   * Esqueleto común de todas las fichas. `c`: { item, light, pill: {cls, text, title}, corner,
   * price, meta, dates, badges, extra, step, actions }. Lo dinámico llega ya escapado, salvo los
   * campos de `item`, que se escapan aquí.
   */
  function cardShell(c) {
    const item = c.item;
    const location = [item.ciudad, item.departamento].filter(v => v && v !== 'No Definido').join(', ');
    return `
      <article class="opp-card${c.light ? ' opp-card-light' : ''}" id="card-${escapeHtml(item.id)}" data-id="${escapeHtml(item.id)}">
        <div>
          <div class="opp-card-header">
            <div>
              <span class="stage-pill ${c.pill.cls}" title="${escapeHtml(c.pill.title || '')}"><span class="pulse-dot"></span>${escapeHtml(c.pill.text)}</span>
              <div class="card-sectors">${(item.sectores || []).map(s => escapeHtml(s.name)).join(' • ')}</div>
            </div>
            ${c.corner ? `<div class="card-badges">${c.corner}</div>` : ''}
          </div>
          <div class="opp-price">${escapeHtml(Engine.formatCopShort(c.price || 0))}</div>
          ${c.meta ? `<div class="opp-meta">${c.meta}</div>` : ''}
          <div class="opp-entity"><span>🏛️</span><strong>${escapeHtml(item.entidad || 'Entidad no especificada')}</strong></div>
          ${location ? `<div class="opp-location">📍 ${escapeHtml(location)}</div>` : ''}
          ${c.dates || ''}
          ${badgeRowHtml(c.badges || [])}
          <p class="opp-desc" title="${escapeHtml(item.descripcion || '')}">${escapeHtml(readableText(item.descripcion) || 'Sin descripción detallada.')}</p>
          ${c.extra || ''}
          ${c.step ? stepHtml(c.step) : ''}
        </div>
        <div class="card-actions">${c.actions || ''}</div>
      </article>`;
  }

  function secopLinkHtml(url, label = '') {
    if (!url) return '';
    return label
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">${label}</a>`
      : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-icon" title="Abrir expediente en SECOP II" aria-label="Abrir en SECOP II">🔗</a>`;
  }

  /** Ficha liviana (fuera del tablero y "Otros"): misma estructura, solo con lo que trae hidden.js. */
  function lightCardHtml(item) {
    const view = boardShape(item);
    const bw = Engine.bidWindow(view);
    const reason = HIDDEN_REASONS[item.motivo] || { label: item.motivo, tone: 'info', tip: '' };
    const badges = [{ icon: '', ...reason }];
    if (Dash.isInsurance(item)) badges.push(Engine.BADGES.seguros);
    // El motivo "convenio" ya lo dice el primer badge.
    badges.push(...cardBadges(view).filter(b => !(b.id === 'convenio' && item.motivo === 'convenio')));
    const winner = item.contratista && item.contratista.nombre;
    const winnerBox = winner ? `
          <div class="contractor-box">
            <div class="contractor-box-title"><span>🏆 Contratista</span>${item.contratista.es_consorcio ? '<span>Consorcio / UT</span>' : ''}</div>
            <div class="contractor-name">${escapeHtml(winner)}</div>
          </div>` : '';
    return cardShell({
      item,
      light: true,
      pill: { cls: STATE_LABELS[bw.state].cls, text: STATE_LABELS[bw.state].text, title: `Estado SECOP: ${item.estado_secop || 'N/D'}` },
      corner: `<span class="badge badge-info" title="Familia UNSPSC (primeros 4 dígitos del código ${escapeHtml(item.unspsc || 'no reportado')})">UNSPSC ${escapeHtml(Dash.familyOf(item))}</span>`,
      price: item.precio,
      meta: [modalityLabel(item), item.tipo_contrato].filter(v => v && v !== 'No Definido').map(escapeHtml).join(' · '),
      dates: cardDatesHtml(view),
      badges,
      extra: winnerBox,
      step: Engine.nextStep(view),
      actions: secopLinkHtml(item.url_secop, '🔗 Abrir en SECOP II')
    });
  }

  /** Ficha del PAA: misma estructura; sus fechas son un mes esperado, no un cierre. */
  function paaCardHtml(item) {
    const nowMonth = new Date().getMonth() + 1;
    const monthName = MONTH_NAMES[(item.mes_esperado || 1) - 1];
    const monthsAway = (item.mes_esperado || nowMonth) - nowMonth;
    const when = monthsAway <= 0 ? 'este mes' : monthsAway === 1 ? 'el próximo mes' : `en ${monthsAway} meses`;
    // El plazo solo se muestra si trae número (algunas entidades digitan solo la unidad).
    const term = item.duracion && /\d/.test(item.duracion) ? item.duracion.replace('(s)', 's').replace('(es)', 'es') : '';
    const badges = [{ icon: '🗓️', label: 'Plan Anual', tone: 'info', tip: 'Proviene del Plan Anual de Adquisiciones (SECOP II): la entidad planea contratarlo, pero el proceso aún puede no existir.' }];
    if (item.origen_recursos) badges.push({ icon: '💰', label: item.origen_recursos, tone: 'info', tip: 'Origen de los recursos según el PAA' });
    // De los badges del tablero, solo los que aplican a una compra futura: la entidad y la persona natural.
    badges.push(...Engine.cardBadges({ entidad_stats: entityStatsOf(item) }, new Date(), { personaNatural: friendlyShare(item) })
      .filter(b => ['gran_comprador', 'pagos_registrados', 'persona_natural'].includes(b.id)));
    return cardShell({
      item,
      pill: { cls: 'stage-planeada', text: `Planeada · ${monthName}` },
      price: item.valor,
      meta: [readableText(modalityLabel(item)), term].filter(Boolean).map(escapeHtml).join(' · '),
      dates: `<div class="card-dates"><div class="date-main">🗓️ Publicación esperada ${escapeHtml(when)}<span>${escapeHtml(monthName)} de ${escapeHtml(item.anio)}${item.version_paa ? ` · PAA versión ${escapeHtml(item.version_paa)}` : ''}</span></div></div>`,
      badges,
      step: { text: 'Prepárate antes de que publiquen: revisa requisitos habituales y busca aliados desde ya' },
      actions: item.url_proceso ? secopLinkHtml(item.url_proceso, '🔗 Proceso relacionado') : '<span class="paa-note">Aún sin proceso publicado en SECOP II</span>'
    });
  }

  // Create Card HTML Template
  function createCardHtml(item) {
    const currentStatus = crmState[item.id]?.status || 'ninguno';
    const bw = Engine.bidWindow(item);
    const stateLabel = STATE_LABELS[bw.state];
    const match = getMatch(item);

    // Un solo puntaje visible: afinidad si hay perfil; si no, calidad del lead.
    const scoreBadge = match
      ? `<span class="match-pill ${match.score >= 75 ? 'match-high' : match.score >= MIN_MATCH_SCORE ? '' : 'match-low'}" title="Afinidad con tu perfil">✨ ${match.score}%</span>`
      : `<div class="score-badge ${item.score_calidad >= 80 ? 'score-high' : 'score-med'}" title="Calidad del lead: sector, valor y etapa (0-100)">⚡ ${item.score_calidad} pts</div>`;

    const metaLine = [modalityLabel(item), Engine.formatTerm(item.plazo)].filter(Boolean).map(escapeHtml).join(' · ');
    const reasons = match && match.reasons.length
      ? `<div class="match-line">✨ ${match.reasons.slice(0, 3).map(escapeHtml).join(' · ')}</div>`
      : '';

    const winner = winnerName(item);
    const legalRep = item.contrato?.contactos?.representante_legal;
    const history = historyLine(item.historial_contratista);
    const contractorBlock = winner ? `
          <div class="contractor-box">
            <div class="contractor-box-title"><span>🏆 Contratista</span>${validNit(item.contratista?.nit) ? `<span>NIT ${escapeHtml(item.contratista.nit)}</span>` : ''}</div>
            <div class="contractor-name">${escapeHtml(winner)}</div>
            ${legalRep ? `<div class="contractor-meta">Representante legal: ${escapeHtml(personName(legalRep))}</div>` : ''}
            ${history ? `<div class="contractor-meta">${escapeHtml(history)}</div>` : ''}
            ${(item.integrantes || []).length ? `<div class="contractor-meta">🤝 Integrantes: ${item.integrantes.slice(0, 3).map(m => `${escapeHtml(m.nombre)}${m.participacion ? ` (${m.participacion}%${m.lider ? ', líder' : ''})` : ''}`).join(' · ')}${item.integrantes.length > 3 ? ` · +${item.integrantes.length - 3}` : ''}</div>` : ''}
          </div>` : '';

    return cardShell({
      item,
      pill: { cls: stateLabel.cls, text: stateLabel.text, title: `${item.etapa_comercial} · Estado SECOP: ${item.estado_secop || 'N/D'}` },
      corner: scoreBadge,
      price: item.precio,
      meta: metaLine,
      dates: cardDatesHtml(item),
      badges: cardBadges(item),
      extra: reasons + contractorBlock,
      step: Engine.nextStep(item),
      actions: `
          <button class="btn btn-primary btn-pitch">💬 Pitch</button>
          <button class="btn btn-outline btn-detail">🔎 Detalle</button>
          ${secopLinkHtml(item.url_secop)}
          <select class="filter-select crm-select" aria-label="Guardar en CRM">
            <option value="ninguno" ${currentStatus === 'ninguno' ? 'selected' : ''}>📌 Guardar</option>
            <option value="nuevo" ${currentStatus === 'nuevo' ? 'selected' : ''}>📥 Nuevo Lead</option>
            <option value="contactado" ${currentStatus === 'contactado' ? 'selected' : ''}>📞 Contactado</option>
            <option value="negociacion" ${currentStatus === 'negociacion' ? 'selected' : ''}>💼 En Cotización</option>
            <option value="ganado" ${currentStatus === 'ganado' ? 'selected' : ''}>🏆 Ganado</option>
          </select>`
    });
  }

  // ---------- Vista de detalle ----------
  function detailRow(label, value) {
    return value ? `<div class="dl-row"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>` : '';
  }

  function openDetailModal(item) {
    const bw = Engine.bidWindow(item);
    const c = item.contrato;
    const h = item.historial_contratista;
    const e = item.entidad_stats;
    const f = item.fechas || {};
    const d = v => (v ? escapeHtml(formatDate(new Date(v))) : '');
    const money = v => (v || v === 0 ? escapeHtml(Engine.formatCopShort(v)) : '');
    const badges = cardBadges(item);
    const step = Engine.nextStep(item);
    const share = Dash.personaNaturalShare(BIDDER_SHARES, item);
    const profile = META && META.perfil_proponente;

    const timeline = [
      ['Publicación', f.publicacion],
      ['Cierre de ofertas', f.cierre_ofertas],
      ['Adjudicación', f.adjudicacion],
      ['Firma del contrato', c?.fecha_firma],
      ['Inicio de ejecución', c?.inicio_ejecucion],
      ['Fin de ejecución', c?.fin_ejecucion]
    ].filter(([, v]) => v).sort((a, b) => new Date(a[1]) - new Date(b[1]));
    const now = Date.now();

    const contacts = c ? [
      ['Representante legal del contratista', c.contactos?.representante_legal, winnerName(item)],
      ['Ordenador del gasto (entidad)', c.contactos?.ordenador_gasto, item.entidad],
      ['Supervisor del contrato (entidad)', c.contactos?.supervisor, item.entidad],
      ['Ordenador de pago (entidad)', c.contactos?.ordenador_pago, item.entidad]
    ].filter(([, name]) => name) : [];

    modalBody.innerHTML = `
      <div class="detail">
        <span class="stage-pill ${STATE_LABELS[bw.state].cls}"><span class="pulse-dot"></span>${STATE_LABELS[bw.state].text}</span>
        <h2 class="detail-title">${escapeHtml(item.entidad || '')}</h2>
        <div class="detail-sub">${escapeHtml(Engine.formatCopShort(item.precio || 0))} · ${escapeHtml(modalityLabel(item))} · Ref. <code>${escapeHtml(item.referencia || item.id)}</code></div>
        <div class="next-step">➜ ${escapeHtml(step.text)}${step.date ? ` · <b>${escapeHtml(formatDate(step.date))}</b>` : ''}</div>
        ${badges.length ? `<div class="badge-row">${badges.map(b => `${badgeHtml(b)}`).join('')}</div>` : ''}

        <section class="detail-section">
          <h3>Objeto</h3>
          <p>${escapeHtml(readableText(item.descripcion) || 'Sin descripción.')}</p>
        </section>

        ${share ? `
        <section class="detail-section">
          <h3>¿Quién gana en esta modalidad?</h3>
          <p>Desde el ${escapeHtml(formatDate(new Date(`${profile.desde}T00:00:00`)))}, <b>${escapeHtml(String(share.pct).replace('.', ','))}%</b> de los contratos de ${escapeHtml(modalityLabel(item))} (${share.natural} de ${share.contratos} con tipo de proponente conocido) los ganó una persona natural; el resto, empresas.</p>
          <p class="legal-note">Fuente: SECOP II · Contratos. Contratos de ${escapeHtml((profile.tipos_contrato || []).join(', ').toLowerCase())} de ${escapeHtml(Engine.formatCopShort(profile.valor_min || 0))} o más. Es una observación del mercado, no un requisito: el pliego define RUP, experiencia y capacidad.</p>
        </section>` : ''}

        ${timeline.length ? `
        <section class="detail-section">
          <h3>Cronograma</h3>
          <ol class="timeline">
            ${timeline.map(([label, v]) => `<li class="${new Date(v).getTime() > now ? 'future' : ''}"><span>${escapeHtml(label)}</span><b>${d(v)}</b><em>${escapeHtml(relativeDays(new Date(v)))}</em></li>`).join('')}
          </ol>
        </section>` : ''}

        ${c ? `
        <section class="detail-section">
          <h3>Contrato ${c.cantidad > 1 ? `(${c.cantidad} lotes)` : ''}</h3>
          <dl>
            ${detailRow('Estado', escapeHtml(c.estado || ''))}
            ${detailRow('Valor', money(c.valor))}
            ${detailRow('Facturado / pagado', c.valor_facturado || c.valor_pagado ? `${money(c.valor_facturado || 0)} / ${money(c.valor_pagado || 0)}` : '')}
            ${detailRow('Días adicionados', c.dias_adicionados ? `${c.dias_adicionados} días` : '')}
            ${detailRow('Origen de los recursos', escapeHtml((c.origen_recursos || []).join(', ')))}
            ${detailRow('Destino del gasto', escapeHtml(c.destino_gasto || ''))}
            ${detailRow('Lugar de ejecución', escapeHtml(c.direccion_ejecucion || ''))}
            ${detailRow('Condiciones de entrega', escapeHtml(c.condiciones_entrega || ''))}
          </dl>
        </section>` : ''}

        ${winnerName(item) ? `
        <section class="detail-section">
          <h3>Contratista</h3>
          <dl>
            ${detailRow('Nombre', escapeHtml(winnerName(item)))}
            ${detailRow('NIT', escapeHtml(validNit(item.contratista?.nit)))}
            ${detailRow('Trayectoria', escapeHtml(historyLine(h)))}
            ${detailRow('Último contrato', h?.ultimo ? d(h.ultimo) : '')}
            ${detailRow('Entidades con las que más contrata', h?.entidades_top?.length ? h.entidades_top.map(t => `${escapeHtml(t.nombre)} <small>(${t.contratos} · ${money(t.valor)})</small>`).join('<br>') : '')}
          </dl>
        </section>` : ''}

        ${(item.integrantes || []).length ? `
        <section class="detail-section">
          <h3>Integrantes del consorcio o unión temporal</h3>
          <table class="sync-table">
            <thead><tr><th>Empresa</th><th>NIT</th><th>Participación</th><th>Trayectoria en SECOP II</th></tr></thead>
            <tbody>${item.integrantes.map(m => `<tr><td>${escapeHtml(m.nombre)}${m.lider ? ' <span class="badge badge-info">Líder</span>' : ''}</td><td>${escapeHtml(m.nit || '—')}</td><td>${m.participacion != null ? `${m.participacion}%` : '—'}</td><td>${m.contratos ? `${m.contratos} contratos · ${money(m.valor_total)}` : '—'}</td></tr>`).join('')}</tbody>
          </table>
          <p class="legal-note">Fuente: SECOP II · Grupos de proveedores. Las compras del contrato suelen hacerlas los integrantes, sobre todo el líder.</p>
        </section>` : ''}

        ${item.ofertas ? `
        <section class="detail-section">
          <h3>Competencia: ${plural(item.ofertas.cantidad, 'oferta recibida', 'ofertas recibidas')}</h3>
          <table class="sync-table">
            <thead><tr><th>Proponente</th><th>NIT</th><th>Valor ofertado</th></tr></thead>
            <tbody>${item.ofertas.proveedores.map(o => `<tr><td>${escapeHtml(o.proveedor || '—')}${o.ganador ? ' <span class="badge badge-good">Ganador</span>' : ''}</td><td>${escapeHtml(o.nit || '—')}</td><td>${o.valor ? money(o.valor) : '—'}</td></tr>`).join('')}</tbody>
          </table>
          <p class="legal-note">Fuente: SECOP II · Ofertas por proceso. Los proponentes que no ganaron son posibles aliados o competidores en procesos similares.</p>
        </section>` : ''}

        ${(item.sanciones || []).length ? `
        <section class="detail-section">
          <h3>⚠️ Sanciones registradas</h3>
          <ul class="contact-list">${item.sanciones.map(s => `<li><b>${escapeHtml(s.sancionado || '')}</b><span>${escapeHtml(s.entidad || '')}${s.resolucion ? ` · ${escapeHtml(s.resolucion)}` : ''}${s.valor ? ` · ${money(s.valor)}` : ''}${s.fecha ? ` · ${d(s.fecha)}` : ''}${s.url ? ` · <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">ver</a>` : ''}</span></li>`).join('')}</ul>
          <p class="legal-note">Fuente: SECOP I · Multas y sanciones (datos abiertos). Puede no incluir sanciones recientes registradas en otras plataformas.</p>
        </section>` : ''}

        ${contacts.length ? `
        <section class="detail-section">
          <h3>Contactos por rol</h3>
          <ul class="contact-list">
            ${contacts.map(([role, name, org]) => `<li><b>${escapeHtml(personName(name))}</b><span>${escapeHtml(role)}${org ? ` · ${escapeHtml(org)}` : ''}</span></li>`).join('')}
          </ul>
          <p class="legal-note">Fuente: SECOP II · Contratos electrónicos (datos abiertos). Son datos públicos de la contratación (Ley 1712 de 2014); úsalos solo con finalidad comercial legítima (Ley 1581 de 2012). Las comunicaciones con la entidad sobre un proceso se hacen por los canales formales de SECOP II.</p>
        </section>` : ''}

        ${e ? `
        <section class="detail-section">
          <h3>La entidad en los últimos 12 meses</h3>
          <dl>
            ${detailRow('Contratos firmados', escapeHtml(String(e.contratos_12m)))}
            ${detailRow('Valor contratado', money(e.valor_12m))}
            ${detailRow('Pagos registrados', e.pagado_sobre_facturado_pct != null ? `${e.pagado_sobre_facturado_pct}% de lo facturado <small>(muchas entidades no registran todos sus pagos en SECOP)</small>` : '')}
            ${detailRow('Principales contratistas (obra y suministro)', e.proveedores_top?.length ? e.proveedores_top.map(t => `${escapeHtml(t.nombre)} <small>(${money(t.valor)})</small>`).join('<br>') : '')}
          </dl>
        </section>` : ''}

        <div class="detail-actions">
          ${item.url_secop ? `<a href="${escapeHtml(item.url_secop)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">🔗 Abrir en SECOP II</a>` : ''}
          <button class="btn btn-primary" id="detailPitch">💬 Generar pitch</button>
        </div>
      </div>
    `;
    document.getElementById('detailPitch').addEventListener('click', () => openPitchModal(item));
    detailModal.classList.add('active');
    detailModal.querySelector('.modal-content').scrollTop = 0;
  }

  // ---------- Estado de la sincronización con SECOP ----------
  const BOGOTA = { timeZone: 'America/Bogota' };

  function colombiaTime(iso, withDate = true) {
    const d = new Date(iso);
    const opts = withDate
      ? { ...BOGOTA, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
      : { ...BOGOTA, hour: 'numeric', minute: '2-digit' };
    return d.toLocaleString('es-CO', opts);
  }

  function plural(n, singular, pluralForm) {
    return `${n} ${n === 1 ? singular : pluralForm}`;
  }

  function hoursAgo(iso) {
    return (Date.now() - new Date(iso).getTime()) / 3600000;
  }

  function agoText(iso) {
    const h = hoursAgo(iso);
    if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `hace ${Math.round(h)} h`;
    return `hace ${Math.round(h / 24)} días`;
  }

  // Verde: sincronización diaria al día; ámbar: se saltó una; rojo: datos viejos.
  function syncHealth() {
    const updated = META?.generated_at || window.PROSPECTS_UPDATED_AT;
    if (!updated) return { cls: 'unknown', label: 'Sin información de sincronización' };
    const h = hoursAgo(updated);
    if (h <= 30) return { cls: 'ok', label: 'Al día' };
    if (h <= 54) return { cls: 'late', label: 'Atrasada: no corrió la última sincronización' };
    return { cls: 'stale', label: 'Desactualizada: revisa el workflow de GitHub Actions' };
  }

  function renderSyncStatus() {
    const pill = document.getElementById('syncStatus');
    const text = document.getElementById('syncStatusText');
    const updated = META?.generated_at || window.PROSPECTS_UPDATED_AT;
    const health = syncHealth();
    pill.className = `sync-pill sync-${health.cls}`;
    if (!updated) {
      text.textContent = 'SECOP II · sin datos de sincronización';
      return;
    }
    const nuevas = META ? ` · +${plural(META.nuevas, 'nueva', 'nuevas')}` : '';
    text.textContent = `SECOP ${agoText(updated)}${nuevas}`;
    pill.title = `Última sincronización: ${colombiaTime(updated)} (hora Colombia) · ${health.label}`;
  }

  const CROSS_STATES = {
    ok: '✅ Completo',
    parcial: '⚠️ Parcial (se reutilizaron datos de la corrida anterior)',
    con_errores: '⚠️ Con errores',
    sin_datos: '— Sin datos'
  };

  function openSyncModal() {
    const updated = META?.generated_at || window.PROSPECTS_UPDATED_AT;
    const health = syncHealth();
    if (!META) {
      modalBody.innerHTML = `<div class="detail"><h2 class="detail-title">Sincronización con SECOP II</h2>
        <p class="detail-sub">${updated ? `Última actualización: <b>${escapeHtml(colombiaTime(updated))}</b> (hora Colombia).` : 'Aún no hay información de sincronización.'} El detalle por corrida aparecerá después de la próxima sincronización.</p></div>`;
      detailModal.classList.add('active');
      return;
    }
    const c = META.fuentes?.contratos || {};
    const history = META.historial || [];
    modalBody.innerHTML = `
      <div class="detail">
        <span class="sync-pill sync-${health.cls}"><span class="sync-dot"></span>${escapeHtml(health.label)}</span>
        <h2 class="detail-title">Sincronización con SECOP II</h2>
        <div class="detail-sub">Última corrida: <b>${escapeHtml(colombiaTime(META.generated_at))}</b> (hora Colombia) · ${escapeHtml(agoText(META.generated_at))} · duró ${escapeHtml(String(Math.round(META.duracion_s)))} s</div>

        <section class="reveal-kpis sync-kpis">
          <div class="rk"><div class="rk-value">+${META.nuevas}</div><div class="rk-label">Oportunidades nuevas (nunca vistas)</div></div>
          <div class="rk"><div class="rk-value">${META.nuevas_adjudicadas}</div><div class="rk-label">Pasaron a adjudicadas</div></div>
          <div class="rk"><div class="rk-value">${META.curadas}</div><div class="rk-label">Oportunidades curadas (${META.adjudicadas} adjudicadas)</div></div>
          <div class="rk"><div class="rk-value">${META.procesos_consultados}</div><div class="rk-label">Procesos consultados en SECOP</div></div>
        </section>
        <p class="detail-sub">${plural(META.salieron, 'oportunidad salió', 'oportunidades salieron')} de la selección respecto a la corrida anterior.
          Próxima sincronización programada: <b>${escapeHtml(colombiaTime(META.proxima_programada))}</b>.</p>
        ${META.reclasificacion ? '<p class="detail-sub">ℹ️ Esta corrida amplió los sectores del motor: los procesos que entraron al tablero solo por tener un sector nuevo no cuentan como nuevos.</p>' : ''}
        ${META.nuevas ? `<button class="btn btn-primary" id="showOnlyNew">🔔 Ver ${META.nuevas === 1 ? 'la oportunidad nueva' : `solo las ${META.nuevas} nuevas`}</button>` : ''}

        <section class="detail-section">
          <h3>Fuentes</h3>
          <dl>
            ${detailRow('SECOP II · Procesos', `✅ ${META.procesos_consultados} registros <small>(p6dx-8zbt)</small>`)}
            ${detailRow('SECOP II · Contratos', `${escapeHtml(CROSS_STATES[META.cruce_contratos] || META.cruce_contratos)} <small>(jbjy-vk9h)</small><br><small>${c.contratos ?? 0} contratos · ${c.historial ?? 0} historiales · ${c.entidades ?? 0} entidades${c.promovidos ? ` · ${c.promovidos} procesos con contrato firmado pasaron a adjudicados` : ''}${c.reutilizados ? ` · ${c.reutilizados} datos reutilizados` : ''}</small>`)}
            ${(c.errores || []).length ? detailRow('Errores', c.errores.map(e => `<small>${escapeHtml(e)}</small>`).join('<br>')) : ''}
            ${[['ofertas', 'SECOP II · Ofertas por proceso', 'wi7w-2nvm', 'procesos con ofertas'], ['consorcios', 'SECOP II · Grupos de proveedores', 'ceth-n4bn', 'consorcios con integrantes'], ['sanciones', 'SECOP I · Multas y sanciones', '4n4q-k399', 'procesos con sanciones'], ['paa', 'SECOP II · Plan Anual de Adquisiciones', '9sue-ezhx', 'compras planeadas']]
              .filter(([k]) => META.fuentes?.[k])
              .map(([k, label, ds, unit]) => {
                const f = META.fuentes[k];
                const state = f.estado === 'ok' ? '✅' : `⚠️ Error${f.reutilizados ? ` (se reutilizaron ${f.reutilizados} datos anteriores)` : ''}`;
                return detailRow(label, `${state} ${f.registros} ${unit} <small>(${ds})</small>${f.error ? `<br><small>${escapeHtml(f.error)}</small>` : ''}`);
              }).join('')}
          </dl>
        </section>

        ${history.length ? `
        <section class="detail-section">
          <h3>Últimas sincronizaciones</h3>
          <table class="sync-table">
            <thead><tr><th>Fecha (Colombia)</th><th>Nuevas</th><th>A adjudicadas</th><th>Curadas</th><th>Contratos</th></tr></thead>
            <tbody>${history.slice(0, 10).map(h => `<tr><td>${escapeHtml(colombiaTime(h.generated_at))}</td><td>+${h.nuevas}</td><td>${h.nuevas_adjudicadas}</td><td>${h.curadas}</td><td>${escapeHtml((CROSS_STATES[h.cruce_contratos] || '').split(' ')[0])}</td></tr>`).join('')}</tbody>
          </table>
        </section>` : ''}
        <p class="legal-note">La sincronización corre automáticamente todos los días a las 6:00 a. m. (hora Colombia) en GitHub Actions. "Nueva" significa que el proceso nunca había aparecido en la selección.</p>
      </div>`;
    const btn = document.getElementById('showOnlyNew');
    if (btn) btn.addEventListener('click', () => {
      onlyNew = true;
      detailModal.classList.remove('active');
      if (currentTab === 'crm') activateTab('observatorio');
      else renderView();
      showToast(`Mostrando solo las oportunidades nuevas de esta pestaña`, 'info');
    });
    detailModal.classList.add('active');
  }

  renderSyncStatus();

  // ---------- Guía de badges ----------
  function openBadgeGuide() {
    const byTone = Object.keys(Engine.TONES).map(tone => ({
      tone,
      ...Engine.TONES[tone],
      items: Object.values(Engine.BADGES).filter(b => b.tone === tone)
    }));
    modalBody.innerHTML = `
      <div class="detail">
        <h2 class="detail-title">Cómo leer los badges</h2>
        <p class="detail-sub">El color indica el significado y el ícono, el tema. En cada ficha los badges van ordenados de mayor a menor importancia.</p>
        ${byTone.map(t => `
          <section class="detail-section">
            <h3><span class="badge badge-${t.tone}">${escapeHtml(t.label)}</span> ${escapeHtml(t.hint)}</h3>
            <ul class="guide-list">${t.items.map(b => `<li>${badgeHtml(b)}<span>${escapeHtml(b.tip)}</span></li>`).join('')}</ul>
          </section>`).join('')}
        <section class="detail-section">
          <h3><span class="match-pill">✨ 85%</span> Afinidad con tu perfil</h3>
          <p>Aparece cuando creaste tu perfil. Sin perfil verás <span class="score-badge score-med">⚡ 66 pts</span>, la calidad general del lead.</p>
        </section>
      </div>`;
    detailModal.classList.add('active');
  }

  document.getElementById('btnBadgeGuide').addEventListener('click', openBadgeGuide);

  // CRM Kanban Rendering
  function renderCrmKanban() {
    const statuses = ['nuevo', 'contactado', 'negociacion', 'ganado'];
    const columns = {
      nuevo: document.getElementById('kanbanNuevo'),
      contactado: document.getElementById('kanbanContactado'),
      negociacion: document.getElementById('kanbanNegociacion'),
      ganado: document.getElementById('kanbanGanado'),
    };

    statuses.forEach(st => {
      columns[st].innerHTML = '';
    });

    let counts = { nuevo: 0, contactado: 0, negociacion: 0, ganado: 0 };

    Object.entries(crmState).forEach(([oppId, meta]) => {
      const opp = rawData.find(o => o.id === oppId);
      if (!opp) return;

      const st = meta.status;
      if (columns[st]) {
        counts[st]++;
        const itemEl = document.createElement('div');
        itemEl.className = 'kanban-item';
        itemEl.innerHTML = `
          <div class="kanban-item-head">
            <span class="kanban-ref">${escapeHtml(opp.referencia || opp.id)}</span>
            <span class="kanban-price">${escapeHtml(opp.precio_formateado)}</span>
          </div>
          <div class="kanban-entity">${escapeHtml(opp.entidad || '')}</div>
          <div class="kanban-contractor">${escapeHtml(opp.contratista?.nombre || 'Sin contratista')}</div>
          <div class="kanban-actions">
            <button class="btn btn-outline btn-sm btn-crm-move">Mover Estado</button>
            <button class="btn btn-primary btn-sm btn-crm-pitch">Pitch</button>
          </div>
        `;

        itemEl.querySelector('.btn-crm-pitch').addEventListener('click', (e) => {
          e.stopPropagation();
          openPitchModal(opp);
        });

        itemEl.querySelector('.btn-crm-move').addEventListener('click', (e) => {
          e.stopPropagation();
          cycleCrmStatus(opp.id);
        });

        columns[st].appendChild(itemEl);
      }
    });

    document.getElementById('countColNuevo').textContent = counts.nuevo;
    document.getElementById('countColContactado').textContent = counts.contactado;
    document.getElementById('countColNegociacion').textContent = counts.negociacion;
    document.getElementById('countColGanado').textContent = counts.ganado;
    // Una oportunidad guardada puede salir del dataset en una sincronización posterior:
    // se cuenta aparte en vez de mostrar un total que no coincide con las columnas.
    const crm = Dash.crmSummary(crmState, rawData);
    const missing = crm.missing
      ? ` · <span class="freshness">${crm.missing} ${crm.missing === 1 ? 'guardada ya no está' : 'guardadas ya no están'} en la selección actual de SECOP II</span>`
      : '';
    resultsCount.innerHTML = `Mostrando <b>${crm.active}</b> ${crm.active === 1 ? 'oportunidad' : 'oportunidades'} en tu Pipeline CRM${missing}`;
  }

  // Update CRM Status
  function updateCrmStatus(id, newStatus) {
    if (newStatus === 'ninguno') {
      delete crmState[id];
      showToast('Oportunidad retirada del Pipeline CRM', 'info');
    } else {
      crmState[id] = {
        status: newStatus,
        updatedAt: new Date().toISOString()
      };
      showToast(`Guardado en CRM como: ${newStatus.toUpperCase()}`, 'success');
    }
    localStorage.setItem('secop_crm_state', JSON.stringify(crmState));
    // Los KPIs se recalculan con los filtros activos (antes volvían al total sin filtrar).
    updateKpis(getFilteredData());
    if (currentTab === 'crm') renderCrmKanban();
  }

  function cycleCrmStatus(id) {
    const sequence = ['nuevo', 'contactado', 'negociacion', 'ganado', 'ninguno'];
    const current = crmState[id]?.status || 'nuevo';
    const nextIdx = (sequence.indexOf(current) + 1) % sequence.length;
    updateCrmStatus(id, sequence[nextIdx]);
  }

  // Modal: Pitch & Outreach Generator
  function openPitchModal(item) {
    const materials = (item.materiales_detectados || []).join(', ') || 'suministros y maquinaria técnica';
    const isAdjudicado = item.etapa_comercial.includes('Adjudicado');
    const bw = Engine.bidWindow(item);
    const closingLine = bw.state === 'abierta' && bw.date ? `\nCierre de ofertas: ${formatDate(bw.date, { withTime: true })} (${relativeDays(bw.date)})` : '';
    const contractor = item.contratista?.nombre || 'su equipo';
    const legalRep = item.contrato?.contactos?.representante_legal;
    const start = item.contrato?.inicio_ejecucion ? new Date(item.contrato.inicio_ejecucion) : null;
    const startLine = start && start.getTime() > Date.now() ? ` Entendemos que la ejecución inicia el ${formatDate(start)}, por lo que es un buen momento para planear el abastecimiento.` : '';
    const greeting = legalRep ? `Apreciado(a) ${personName(legalRep)}, representante legal de ${contractor}` : `Apreciados señores de ${contractor}`;
    const profile = Profile && Profile.getProfile();
    const company = profile?.companyName?.trim();
    const offer = profile?.offerTags?.length ? profile.offerTags.slice(0, 4).join(', ') : materials;
    const signature = company ? `\n\nCordialmente,\n${company}${profile.nit ? ` · NIT ${profile.nit}` : ''}${profile.website ? `\n${profile.website}` : ''}` : '';

    let pitchTemplate = '';
    if (isAdjudicado) {
      pitchTemplate = `${greeting},\n\nUn saludo cordial. Nos comunicamos en relación con la reciente adjudicación del proceso ${item.referencia} con la entidad ${item.entidad} por un valor de ${item.precio_formateado} para la ejecución de: "${readableText(item.descripcion)?.slice(0, 140)}...".${startLine}\n\n${company ? `En ${company} somos` : 'Somos'} especialistas en el suministro y entrega inmediata de ${offer}. Ponemos a su disposición nuestra capacidad operativa, cotizaciones competitivas y disponibilidad técnica en la región.\n\n¿Con quién de su equipo de compras o ingeniería del proyecto podríamos coordinar el envío de nuestra propuesta técnica y comercial?${signature}`;
    } else {
      pitchTemplate = `Estimado aliado / cliente contratista,\n\nQueremos compartirte esta oportunidad estratégica identificada en SECOP II antes de su cierre:\n\nProceso: ${item.referencia}\nEntidad: ${item.entidad}\nPresupuesto Oficial: ${item.precio_formateado}\nUbicación: ${item.ciudad}, ${item.departamento}${closingLine}\nAlcance: "${readableText(item.descripcion)?.slice(0, 160)}..."\n\nPodemos respaldar tu propuesta con ${company ? `la experiencia de ${company} en` : 'nuestros suministros de'} ${offer}. Si deseas que revisemos los pliegos juntos para presentar oferta o estructurar el consorcio, avísanos para coordinar de inmediato.${signature}`;
    }

    modalBody.innerHTML = `
      <div class="pitch-head">
        <span class="badge-count pitch-type">${escapeHtml(item.tipo_oportunidad)}</span>
        <h2 class="pitch-title">${escapeHtml(item.entidad)}</h2>
        <div class="pitch-sub">
          Proceso: <b>${escapeHtml(item.referencia)}</b> • Monto: <b>${escapeHtml(item.precio_formateado)}</b>
        </div>
      </div>

      <div class="pitch-body">
        <div class="pitch-label">Mensaje de Contacto Generado Automáticamente:</div>
        <div class="pitch-box" id="pitchText">${escapeHtml(pitchTemplate)}</div>
      </div>

      <div class="pitch-actions">
        <button class="btn btn-outline" id="btnCopyPitch">
          📋 Copiar al Portapapeles
        </button>
        <button class="btn btn-primary" id="btnShareWhatsApp">
          📱 Enviar por WhatsApp
        </button>
      </div>
    `;

    document.getElementById('btnCopyPitch').addEventListener('click', () => {
      navigator.clipboard.writeText(pitchTemplate).then(() => {
        showToast('¡Mensaje copiado al portapapeles!', 'success');
      });
    });

    document.getElementById('btnShareWhatsApp').addEventListener('click', () => {
      const url = `https://wa.me/?text=${encodeURIComponent(pitchTemplate)}`;
      window.open(url, '_blank');
    });

    detailModal.classList.add('active');
  }

  // Export CSV
  function exportFilteredToCsv() {
    const dataToExport = getFilteredData();
    if (!dataToExport.length) {
      showToast('No hay oportunidades para exportar con estos filtros', 'warning');
      return;
    }
    if (currentTab === 'hidden' || otherMode()) {
      exportHiddenToCsv(dataToExport);
      return;
    }

    const headers = [
      'ID', 'Referencia', 'Score', 'Etapa Comercial', 'Tipo Oportunidad',
      'Sectores', 'Materiales Detectados', 'Valor COP', 'Entidad',
      'Departamento', 'Ciudad', 'Contratista', 'NIT Contratista', 'Enlace SECOP',
      'Estado real', 'Cierre de ofertas', 'Adjudicación', 'Inicio de ejecución', 'Fin de ejecución',
      'Estado del contrato', 'Representante legal (contratista)', 'Contratos previos del contratista', 'Próximo paso'
    ];

    const rows = dataToExport.map(item => [
      item.id || '',
      item.referencia || '',
      item.score_calidad || 0,
      item.etapa_comercial || '',
      item.tipo_oportunidad || '',
      (item.sectores || []).map(s => s.name).join(', '),
      (item.materiales_detectados || []).join(', '),
      item.precio || 0,
      item.entidad || '',
      item.departamento || '',
      item.ciudad || '',
      item.contratista?.nombre || '',
      item.contratista?.nit || '',
      item.url_secop || '',
      STATE_LABELS[Engine.bidWindow(item).state].text,
      (item.fechas?.cierre_ofertas || '').slice(0, 10),
      (item.fechas?.adjudicacion || '').slice(0, 10),
      (item.contrato?.inicio_ejecucion || '').slice(0, 10),
      (item.contrato?.fin_ejecucion || '').slice(0, 10),
      item.contrato?.estado || '',
      personName(item.contrato?.contactos?.representante_legal || ''),
      item.historial_contratista?.contratos ?? '',
      Engine.nextStep(item).text
    ]);

    downloadCsv(Dash.buildCsv(headers, rows), `secop_oportunidades_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`Se exportaron ${dataToExport.length} oportunidades a CSV`, 'success');
  }

  /** La vista "fuera del tablero" usa la lista liviana: exporta sus propias columnas. */
  function exportHiddenToCsv(items) {
    const headers = ['ID', 'Referencia', 'Motivo', 'Sectores', 'Familia UNSPSC', 'C\u00F3digo UNSPSC', 'Valor COP', 'Entidad',
      'Departamento', 'Ciudad', 'Modalidad', 'Tipo de contrato', 'Etapa', 'Publicaci\u00F3n', 'Cierre de ofertas', 'Descripci\u00F3n', 'Enlace SECOP'];
    const rows = items.map(item => [
      item.id || '',
      item.referencia || '',
      HIDDEN_REASONS[item.motivo]?.label || item.motivo || '',
      (item.sectores || []).map(s => s.name).join(', '),
      Dash.familyOf(item),
      item.unspsc || '',
      item.precio || 0,
      item.entidad || '',
      item.departamento || '',
      item.ciudad || '',
      item.modalidad || '',
      item.tipo_contrato || '',
      item.etapa_comercial || '',
      (item.fecha_publicacion || '').slice(0, 10),
      (item.cierre_ofertas || '').slice(0, 10),
      item.descripcion || '',
      item.url_secop || ''
    ]);
    downloadCsv(Dash.buildCsv(headers, rows), `secop_fuera_del_tablero_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast(`Se exportaron ${items.length} procesos fuera del tablero a CSV`, 'success');
  }

  function downloadCsv(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Toast System
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    document.getElementById('toastContainer').appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
