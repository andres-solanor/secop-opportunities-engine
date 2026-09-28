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
  const sortSelect = document.getElementById('sortSelect');
  const DAY_MS = 24 * 3600 * 1000;
  // Nota: las constantes usadas por las fichas deben declararse aquí, antes del primer renderView().
  const ACRONYMS = ['PAE', 'ESP', 'E.S.P.', 'SAS', 'S.A.S.', 'LED', 'SGR', 'SGP', 'IPS', 'ESE', 'ICBF', 'SENA', 'EPM', 'UT', 'BPIN', 'CDP', 'INVIAS', 'ANI', 'IE', 'PTAR', 'PTAP', 'SENA', 'EDU'];
  const MODALITY_LABELS = [
    ['licitacion publica', 'Licitación pública'],
    ['menor cuantia', 'Menor cuantía'],
    ['subasta', 'Subasta inversa'],
    ['concurso de meritos', 'Concurso de méritos'],
    ['minima cuantia', 'Mínima cuantía'],
    ['contratacion directa', 'Contratación directa'],
    ['regimen especial', 'Régimen especial']
  ];

  // Etiqueta de la ficha según la ventana real de participación (ProfileEngine.bidWindow).
  const STATE_LABELS = {
    abierta: { text: 'Recibe ofertas', cls: 'stage-ofertas' },
    borrador: { text: 'Borrador de pliegos', cls: 'stage-borrador' },
    cerrada: { text: 'Ofertas cerradas', cls: 'stage-cerrada' },
    adjudicado: { text: 'Adjudicado', cls: 'stage-adjudicado' }
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
  const resultsCount = document.getElementById('resultsCount');
  const btnResetFilters = document.getElementById('btnResetFilters');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const btnNewScan = document.getElementById('btnNewScan');
  const detailModal = document.getElementById('detailModal');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');

  // KPIs
  const kpiTotalPipeline = document.getElementById('kpiTotalPipeline');
  const kpiTotalOpps = document.getElementById('kpiTotalOpps');
  const kpiAvgScore = document.getElementById('kpiAvgScore');

  window.showAppToast = showToast;

  // Initialize
  initDepartments();
  if (Profile && Profile.getProfile()) activateTab('parati');
  updateKpis(rawData);
  renderView();

  // Tab listeners
  document.querySelectorAll('.view-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => activateTab(tabBtn.dataset.tab));
  });

  function activateTab(tab) {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    currentTab = tab;
    renderView();
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
  [searchInput, sectorSelect, stageSelect, budgetSelect, departmentSelect, sortSelect].forEach(el => {
    el.addEventListener('input', () => renderView());
  });

  btnResetFilters.addEventListener('click', () => {
    searchInput.value = '';
    sectorSelect.value = 'todos';
    stageSelect.value = 'todos';
    budgetSelect.value = '0';
    departmentSelect.value = 'todos';
    sortSelect.value = 'relevancia';
    renderView();
    showToast('Filtros restablecidos', 'info');
  });

  btnExportCsv.addEventListener('click', () => {
    exportFilteredToCsv();
  });

  btnNewScan.addEventListener('click', () => {
    showToast('Datos sincronizados con SECOP II', 'success');
  });

  modalClose.addEventListener('click', () => {
    detailModal.classList.remove('active');
  });

  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) detailModal.classList.remove('active');
  });

  // Helper: Extract unique departments for dropdown
  function initDepartments() {
    const depts = new Set();
    rawData.forEach(item => {
      if (item.departamento && item.departamento !== 'No Definido') {
        depts.add(item.departamento);
      }
    });

    const sortedDepts = Array.from(depts).sort();
    sortedDepts.forEach(dept => {
      const opt = document.createElement('option');
      opt.value = dept;
      opt.textContent = dept;
      departmentSelect.appendChild(opt);
    });
  }

  // Filter Pipeline
  function getFilteredData() {
    const query = searchInput.value.toLowerCase().trim();
    const sectorVal = sectorSelect.value;
    const stageVal = stageSelect.value;
    const minBudget = parseFloat(budgetSelect.value) || 0;
    const deptVal = departmentSelect.value;

    const filtered = rawData.filter(item => {
      // Tab based filtering: STRICTLY MUTUALLY EXCLUSIVE
      const isAdjudicado = (item.etapa_comercial || '').toLowerCase().includes('adjudicado');
      if (currentTab === 'parati') {
        // Para Ti: ambas etapas, solo oportunidades con alta afinidad al perfil
        if ((getMatch(item)?.score || 0) < MIN_MATCH_SCORE) return false;
      } else if (currentTab === 'proveedores') {
        // Radar B2B: Strictly for awarded contracts (direct supplier sales to the winning contractor)
        if (!isAdjudicado) return false;
      } else if (currentTab === 'observatorio') {
        // Observatorio: Strictly for open tenders & drafts (prospective bidding before tender closes)
        if (isAdjudicado) return false;
      }

      // Keyword query
      if (query) {
        const corpus = [
          item.referencia,
          item.entidad,
          item.descripcion,
          item.contratista?.nombre,
          item.contratista?.nit,
          ...(item.materiales_detectados || [])
        ].join(' ').toLowerCase();
        if (!corpus.includes(query)) return false;
      }

      // Sector
      if (sectorVal !== 'todos') {
        const inSector = item.sectores && item.sectores.some(s => s.id === sectorVal);
        if (!inSector) return false;
      }

      // Stage
      if (stageVal !== 'todos') {
        const stageStr = item.etapa_comercial.toLowerCase();
        if (stageVal === 'adjudicado' && !stageStr.includes('adjudicado')) return false;
        if (stageVal === 'ofertas' && !stageStr.includes('ofertas') && !stageStr.includes('abierta')) return false;
        if (stageVal === 'borrador' && !stageStr.includes('borrador')) return false;
      }

      // Budget
      if (minBudget > 0 && (item.precio || 0) < minBudget) {
        return false;
      }

      // Department
      if (deptVal !== 'todos' && item.departamento !== deptVal) {
        return false;
      }

      return true;
    });

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

  function freshnessText() {
    const updated = window.PROSPECTS_UPDATED_AT ? new Date(window.PROSPECTS_UPDATED_AT) : null;
    if (!updated || isNaN(updated.getTime())) return '';
    return ` · <span class="freshness">Datos SECOP actualizados ${escapeHtml(formatDate(updated, { withTime: true }))}</span>`;
  }

  // Helper: Format currency in Colombian business terms
  function formatCop(val) {
    if (val >= 1_000_000_000_000) {
      return `$${(val / 1_000_000_000_000).toFixed(2).replace('.', ',')} Billones COP`;
    } else if (val >= 1_000_000_000) {
      return `$${(val / 1_000_000_000).toFixed(1).replace('.', ',')} Mil Millones COP`;
    } else {
      return `$${Math.round(val / 1_000_000).toLocaleString('es-CO')} Millones COP`;
    }
  }

  // Update Top KPIs dynamically per active tab AND active filters
  function updateKpis(filteredItems = []) {
    let tabBaseline = rawData;
    let baseName = 'esta vista';

    if (currentTab === 'parati') {
      tabBaseline = forYouItems();
      baseName = 'oportunidades para ti';
    } else if (currentTab === 'proveedores') {
      tabBaseline = rawData.filter(i => (i.etapa_comercial || '').toLowerCase().includes('adjudicado'));
      baseName = 'contratos adjudicados';
    } else if (currentTab === 'observatorio') {
      tabBaseline = rawData.filter(i => !(i.etapa_comercial || '').toLowerCase().includes('adjudicado'));
      baseName = 'licitaciones abiertas';
    } else if (currentTab === 'crm') {
      tabBaseline = rawData.filter(i => crmState[i.id]);
      baseName = 'oportunidades en CRM';
    }

    const baselineSum = tabBaseline.reduce((acc, curr) => acc + (curr.precio || 0), 0);
    const filteredSum = filteredItems.reduce((acc, curr) => acc + (curr.precio || 0), 0);
    const avgScore = filteredItems.length ? Math.round(filteredItems.reduce((acc, c) => acc + (c.score_calidad || 0), 0) / filteredItems.length) : 0;

    const isFiltered = (filteredItems.length !== tabBaseline.length) || 
                       searchInput.value.trim() !== '' || 
                       sectorSelect.value !== 'todos' || 
                       stageSelect.value !== 'todos' || 
                       budgetSelect.value !== '0' || 
                       departmentSelect.value !== 'todos';

    // 1. Pipeline Total Card
    kpiTotalPipeline.textContent = formatCop(filteredSum);
    const kpiPipelineSub = document.querySelector('.kpi-emerald .kpi-sub');
    if (kpiPipelineSub) {
      if (isFiltered && baselineSum > 0) {
        const pct = Math.round((filteredSum / baselineSum) * 100);
        kpiPipelineSub.textContent = `de ${formatCop(baselineSum)} en ${baseName} (${pct}%)`;
      } else {
        kpiPipelineSub.textContent = `Total en ${tabBaseline.length} ${baseName}`;
      }
    }

    // 2. Count Card
    document.getElementById('kpiTotalOpps').textContent = filteredItems.length;
    const kpiOppsSub = document.querySelector('.kpi-cyan .kpi-sub');
    if (kpiOppsSub) {
      kpiOppsSub.textContent = isFiltered ? `de ${tabBaseline.length} disponibles en ${baseName}` : `Calificadas sin OPS ni prestación de servicios`;
    }

    // 3. Sector / Filter Card
    const kpiSecTitle = document.getElementById('kpiSectorTitle');
    const kpiSecVal = document.getElementById('kpiSectorValue');
    const kpiSecSub = document.getElementById('kpiSectorSub');
    if (kpiSecTitle && kpiSecVal && kpiSecSub) {
      if (sectorSelect.value !== 'todos') {
        kpiSecTitle.textContent = 'Sector Filtrado';
        kpiSecVal.textContent = sectorSelect.options[sectorSelect.selectedIndex].text;
        kpiSecSub.textContent = `Visualizando este vertical específico`;
      } else if (departmentSelect.value !== 'todos') {
        kpiSecTitle.textContent = 'Región Filtrada';
        kpiSecVal.textContent = departmentSelect.value;
        kpiSecSub.textContent = `Filtro geográfico activo`;
      } else {
        kpiSecTitle.textContent = 'Sectores Clave';
        kpiSecVal.textContent = 'Acero, Solar & HORECA';
        kpiSecSub.textContent = 'Metalmecánica, Energía & Gastronomía';
      }
    }

    // 4. Quality Score Card
    document.getElementById('kpiAvgScore').textContent = `${avgScore} / 100`;

    // Tab badges (Zero duplication: Adjudicados vs Open Tenders)
    const provCount = rawData.filter(i => (i.etapa_comercial || '').toLowerCase().includes('adjudicado')).length;
    const obsCount = rawData.filter(i => !(i.etapa_comercial || '').toLowerCase().includes('adjudicado')).length;
    const crmCount = Object.keys(crmState).length;

    document.getElementById('countProveedores').textContent = provCount;
    document.getElementById('countObservatorio').textContent = obsCount;
    document.getElementById('countCrm').textContent = crmCount;
    document.getElementById('countParaTi').textContent = Profile && Profile.getProfile() ? forYouItems().length : '✨';
  }

  // Render View depending on current tab
  function renderView() {
    const filtered = getFilteredData();
    updateKpis(filtered);

    if (currentTab === 'crm') {
      cardsGrid.style.display = 'none';
      crmKanban.style.display = 'grid';
      renderCrmKanban();
    } else {
      cardsGrid.style.display = 'grid';
      crmKanban.style.display = 'none';
      renderCards(filtered);
    }
  }

  // Render Card Grid
  function renderCards(filtered = []) {
    resultsCount.innerHTML = `Mostrando <b>${filtered.length}</b> oportunidades calificadas${freshnessText()}`;

    if (currentTab === 'parati' && !(Profile && Profile.getProfile())) {
      resultsCount.innerHTML = 'Oportunidades ordenadas por afinidad con tu perfil';
      cardsGrid.innerHTML = `
        <div class="empty-foryou">
          <div style="font-size: 3rem; margin-bottom: 0.75rem;">✨</div>
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
        <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🔍</div>
          <h3>No se encontraron oportunidades con los filtros seleccionados</h3>
          <p style="margin-top: 0.5rem;">Intenta cambiar el sector, reducir el presupuesto mínimo o limpiar la búsqueda.</p>
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
    const m = Engine.normalize(item.modalidad);
    const found = MODALITY_LABELS.find(([k]) => m.includes(k));
    return found ? found[1] : (item.modalidad || '');
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

    const sectors = (item.sectores || []).map(s => escapeHtml(s.name)).join(' • ');
    const metaLine = [modalityLabel(item), Engine.formatTerm(item.plazo)].filter(Boolean).map(escapeHtml).join(' · ');
    const badges = Engine.cardBadges(item);
    const visibleBadges = badges.slice(0, 4);
    const moreBadges = badges.length - visibleBadges.length;
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
          </div>` : '';

    const step = Engine.nextStep(item);
    const stepDate = step.date ? ` · <b>${escapeHtml(formatDate(step.date))}</b> (${escapeHtml(relativeDays(step.date))})` : '';

    return `
      <article class="opp-card" id="card-${item.id}">
        <div>
          <div class="opp-card-header">
            <div>
              <span class="stage-pill ${stateLabel.cls}" title="${escapeHtml(item.etapa_comercial)} · Estado SECOP: ${escapeHtml(item.estado_secop || 'N/D')}">
                <span class="pulse-dot"></span>
                ${stateLabel.text}
              </span>
              <div class="card-sectors">${sectors}</div>
            </div>
            <div class="card-badges">${scoreBadge}</div>
          </div>

          <div class="opp-price">${escapeHtml(Engine.formatCopShort(item.precio || 0))}</div>
          ${metaLine ? `<div class="opp-meta">${metaLine}</div>` : ''}
          <div class="opp-entity">
            <span>🏛️</span>
            <strong>${escapeHtml(item.entidad || 'Entidad no especificada')}</strong>
          </div>
          <div class="opp-location">📍 ${escapeHtml([item.ciudad, item.departamento].filter(v => v && v !== 'No Definido').join(', '))}</div>
          ${cardDatesHtml(item)}
          ${visibleBadges.length ? `<div class="badge-row">${visibleBadges.map(badgeHtml).join('')}${moreBadges > 0 ? `<span class="badge badge-more" title="Ver todos en el detalle">+${moreBadges}</span>` : ''}</div>` : ''}

          <p class="opp-desc" title="${escapeHtml(item.descripcion || '')}">
            ${escapeHtml(readableText(item.descripcion) || 'Sin descripción detallada.')}
          </p>
          ${reasons}
          ${contractorBlock}

          <div class="next-step">➜ ${escapeHtml(step.text)}${stepDate}</div>
        </div>

        <div class="card-actions">
          <button class="btn btn-primary btn-pitch">💬 Pitch</button>
          <button class="btn btn-outline btn-detail">🔎 Detalle</button>
          ${item.url_secop ? `<a href="${escapeHtml(item.url_secop)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-icon" title="Abrir expediente en SECOP II" aria-label="Abrir en SECOP II">🔗</a>` : ''}
          <select class="filter-select crm-select" aria-label="Guardar en CRM">
            <option value="ninguno" ${currentStatus === 'ninguno' ? 'selected' : ''}>📌 Guardar</option>
            <option value="nuevo" ${currentStatus === 'nuevo' ? 'selected' : ''}>📥 Nuevo Lead</option>
            <option value="contactado" ${currentStatus === 'contactado' ? 'selected' : ''}>📞 Contactado</option>
            <option value="negociacion" ${currentStatus === 'negociacion' ? 'selected' : ''}>💼 En Cotización</option>
            <option value="ganado" ${currentStatus === 'ganado' ? 'selected' : ''}>🏆 Ganado</option>
          </select>
        </div>
      </article>
    `;
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
    const badges = Engine.cardBadges(item);
    const step = Engine.nextStep(item);

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
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.4rem;">
            <span style="font-size: 0.7rem; color: var(--accent-cyan); font-weight: 700;">${escapeHtml(opp.referencia || opp.id)}</span>
            <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-emerald);">${opp.precio_formateado}</span>
          </div>
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.3rem;">
            ${escapeHtml(opp.entidad || '')}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.6rem;">
            ${escapeHtml(opp.contratista?.nombre || 'Sin contratista')}
          </div>
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
            <button class="btn btn-outline btn-crm-move" data-id="${opp.id}" style="padding: 0.25rem 0.5rem; font-size: 0.7rem;">Mover Estado</button>
            <button class="btn btn-primary btn-crm-pitch" data-id="${opp.id}" style="padding: 0.25rem 0.5rem; font-size: 0.7rem;">Pitch</button>
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
    resultsCount.innerHTML = `Mostrando <b>${Object.keys(crmState).length}</b> oportunidades en tu Pipeline CRM`;
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
    updateKpis(rawData);
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
      <div style="margin-bottom: 1.25rem;">
        <span class="badge-count" style="background: rgba(6, 182, 212, 0.2); color: var(--accent-cyan); font-size: 0.75rem;">
          ${item.tipo_oportunidad}
        </span>
        <h2 style="font-family: var(--font-heading); font-size: 1.4rem; margin-top: 0.5rem;">
          ${escapeHtml(item.entidad)}
        </h2>
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.25rem;">
          Proceso: <b>${escapeHtml(item.referencia)}</b> • Monto: <b>${escapeHtml(item.precio_formateado)}</b>
        </div>
      </div>

      <div style="margin-bottom: 1rem;">
        <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);">
          Mensaje de Contacto Generado Automáticamente:
        </div>
        <div class="pitch-box" id="pitchText">${escapeHtml(pitchTemplate)}</div>
      </div>

      <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
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

    const headers = [
      'ID', 'Referencia', 'Score', 'Etapa Comercial', 'Tipo Oportunidad',
      'Sectores', 'Materiales Detectados', 'Valor COP', 'Entidad',
      'Departamento', 'Ciudad', 'Contratista', 'NIT Contratista', 'Enlace SECOP',
      'Estado real', 'Cierre de ofertas', 'Adjudicación', 'Inicio de ejecución', 'Fin de ejecución',
      'Estado del contrato', 'Representante legal (contratista)', 'Contratos previos del contratista', 'Próximo paso'
    ];

    const rows = dataToExport.map(item => [
      `"${item.id || ''}"`,
      `"${item.referencia || ''}"`,
      item.score_calidad || 0,
      `"${item.etapa_comercial || ''}"`,
      `"${item.tipo_oportunidad || ''}"`,
      `"${(item.sectores || []).map(s => s.name).join(', ')}"`,
      `"${(item.materiales_detectados || []).join(', ')}"`,
      item.precio || 0,
      `"${(item.entidad || '').replace(/"/g, '""')}"`,
      `"${item.departamento || ''}"`,
      `"${item.ciudad || ''}"`,
      `"${(item.contratista?.nombre || '').replace(/"/g, '""')}"`,
      `"${item.contratista?.nit || ''}"`,
      `"${item.url_secop || ''}"`,
      ...[
        STATE_LABELS[Engine.bidWindow(item).state].text,
        (item.fechas?.cierre_ofertas || '').slice(0, 10),
        (item.fechas?.adjudicacion || '').slice(0, 10),
        (item.contrato?.inicio_ejecucion || '').slice(0, 10),
        (item.contrato?.fin_ejecucion || '').slice(0, 10),
        item.contrato?.estado || '',
        personName(item.contrato?.contactos?.representante_legal || ''),
        item.historial_contratista?.contratos ?? '',
        Engine.nextStep(item).text
      ].map(v => `"${String(v).replace(/"/g, '""')}"`)
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `secop_oportunidades_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Se exportaron ${dataToExport.length} oportunidades a CSV`, 'success');
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
