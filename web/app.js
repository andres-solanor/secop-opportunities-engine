/**
 * SECOP II Opportunities Engine & Lead Observatory
 * Frontend Controller & Mini-CRM Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let rawData = window.PROSPECTS_DATA || [];
  let currentTab = 'proveedores'; // 'proveedores' | 'observatorio' | 'crm'
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

  // Initialize
  initDepartments();
  updateKpis(rawData);
  renderView();

  // Tab listeners
  document.querySelectorAll('.view-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      currentTab = tabBtn.dataset.tab;
      renderView();
    });
  });

  // Filter input listeners
  [searchInput, sectorSelect, stageSelect, budgetSelect, departmentSelect].forEach(el => {
    el.addEventListener('input', () => renderView());
  });

  btnResetFilters.addEventListener('click', () => {
    searchInput.value = '';
    sectorSelect.value = 'todos';
    stageSelect.value = 'todos';
    budgetSelect.value = '0';
    departmentSelect.value = 'todos';
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

    return rawData.filter(item => {
      // Tab based filtering
      if (currentTab === 'proveedores') {
        // Focus on leads with materials/equipment needs (Adjudicados or Open Bids)
        const hasSpecificMaterials = (item.materiales_detectados && item.materiales_detectados.length > 0);
        if (!hasSpecificMaterials) return false;
      } else if (currentTab === 'observatorio') {
        // Focus on tenders open for bidding or in draft
        const isBidding = item.etapa_comercial.includes('Licitación') || item.etapa_comercial.includes('Borrador') || item.etapa_comercial.includes('Activo');
        if (!isBidding) return false;
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
  }

  // Update Top KPIs
  function updateKpis(items) {
    const totalPipeline = items.reduce((acc, curr) => acc + (curr.precio || 0), 0);
    const avgScore = items.length ? Math.round(items.reduce((acc, c) => acc + (c.score_calidad || 0), 0) / items.length) : 0;

    kpiTotalPipeline.textContent = `$${Math.round(totalPipeline / 1_000_000).toLocaleString('es-CO')} M`;
    kpiTotalOpps.textContent = items.length;
    kpiAvgScore.textContent = `${avgScore} / 100`;

    // Tab badges
    const provCount = rawData.filter(i => i.materiales_detectados?.length > 0).length;
    const obsCount = rawData.filter(i => i.etapa_comercial.includes('Licitación') || i.etapa_comercial.includes('Borrador') || i.etapa_comercial.includes('Activo')).length;
    const crmCount = Object.keys(crmState).length;

    document.getElementById('countProveedores').textContent = provCount;
    document.getElementById('countObservatorio').textContent = obsCount;
    document.getElementById('countCrm').textContent = crmCount;
  }

  // Render View depending on current tab
  function renderView() {
    if (currentTab === 'crm') {
      cardsGrid.style.display = 'none';
      crmKanban.style.display = 'grid';
      renderCrmKanban();
    } else {
      cardsGrid.style.display = 'grid';
      crmKanban.style.display = 'none';
      renderCards();
    }
  }

  // Render Card Grid
  function renderCards() {
    const filtered = getFilteredData();
    resultsCount.innerHTML = `Mostrando <b>${filtered.length}</b> oportunidades calificadas`;

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

      // CRM Status Selector
      const crmSelect = cardEl.querySelector('.crm-select');
      if (crmSelect) {
        crmSelect.addEventListener('change', (e) => {
          updateCrmStatus(item.id, e.target.value);
        });
      }
    });
  }

  // Create Card HTML Template
  function createCardHtml(item) {
    const isHigh = item.score_calidad >= 80;
    const scoreClass = isHigh ? 'score-high' : 'score-med';
    const currentStatus = crmState[item.id]?.status || 'ninguno';

    let stagePillClass = 'stage-ofertas';
    if (item.etapa_comercial.includes('Adjudicado')) stagePillClass = 'stage-adjudicado';
    if (item.etapa_comercial.includes('Borrador')) stagePillClass = 'stage-borrador';

    const materialBadges = (item.materiales_detectados || []).map(mat => {
      const isSteel = ['acero', 'vigas', 'estructura metálica', 'cerchas', 'varilla'].some(k => mat.includes(k));
      const isSolar = ['solar', 'fotovoltaic', 'alumbrado', 'luminaria', 'eléctrica', 'electrica', 'transformador'].some(k => mat.includes(k));
      let tagClass = 'horeca';
      if (isSteel) tagClass = 'steel';
      else if (isSolar) tagClass = 'solar';
      return `<span class="material-tag ${tagClass}">🏷️ ${escapeHtml(mat)}</span>`;
    }).join('');

    const sectorsBadges = (item.sectores || []).map(s => {
      return `<span style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 600;">${escapeHtml(s.name)}</span>`;
    }).join(' • ');

    const contractorName = item.contratista?.nombre || 'Pendiente por Adjudicar';
    const isConsortium = item.contratista?.es_consorcio;

    return `
      <article class="opp-card" id="card-${item.id}">
        <div>
          <div class="opp-card-header">
            <div>
              <span class="stage-pill ${stagePillClass}">
                <span class="pulse-dot"></span>
                ${escapeHtml(item.etapa_comercial.split('(')[0].trim())}
              </span>
              <div style="margin-top: 0.4rem;">${sectorsBadges}</div>
            </div>
            <div class="score-badge ${scoreClass}">
              <span>⚡</span> ${item.score_calidad} pts
            </div>
          </div>

          <div class="opp-price">${escapeHtml(item.precio_formateado)}</div>
          <div class="opp-entity">
            <span>🏛️</span>
            <strong>${escapeHtml(item.entidad || 'Entidad no especificada')}</strong>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.75rem;">
            📍 ${escapeHtml(item.ciudad || '')}, ${escapeHtml(item.departamento || '')} • Ref: <code>${escapeHtml(item.referencia || item.id)}</code>
          </div>

          <p class="opp-desc" title="${escapeHtml(item.descripcion || '')}">
            ${escapeHtml(item.descripcion || 'Sin descripción detallada.')}
          </p>

          ${materialBadges ? `<div class="material-tags">${materialBadges}</div>` : ''}

          <div class="contractor-box">
            <div class="contractor-box-title">
              <span>Contratista / Adjudicatario</span>
              ${isConsortium ? `<span class="consortium-tag">Consorcio</span>` : ''}
            </div>
            <div class="contractor-name">${escapeHtml(contractorName)}</div>
            ${item.contratista?.nit && item.contratista.nit !== 'N/A' && item.contratista.nit !== 'No Definido' ? 
              `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">NIT: ${escapeHtml(item.contratista.nit)}</div>` : ''}
          </div>

          <div class="action-banner">
            <strong>🎯 Estrategia:</strong> ${escapeHtml(item.accion_sugerida)}
          </div>
        </div>

        <div class="card-actions">
          <button class="btn btn-primary btn-pitch" style="padding: 0.5rem 0.75rem;">
            <span>💬</span> Generar Pitch
          </button>
          ${item.url_secop ? `
            <a href="${item.url_secop}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="padding: 0.5rem 0.75rem;" title="Abrir expediente en SECOP II">
              <span>🔗</span> SECOP II
            </a>
          ` : ''}
          <select class="filter-select crm-select" style="min-width: 130px; font-size: 0.75rem; padding: 0.4rem 0.6rem;">
            <option value="ninguno" ${currentStatus === 'ninguno' ? 'selected' : ''}>📌 Guardar en CRM</option>
            <option value="nuevo" ${currentStatus === 'nuevo' ? 'selected' : ''}>📥 Nuevo Lead</option>
            <option value="contactado" ${currentStatus === 'contactado' ? 'selected' : ''}>📞 Contactado</option>
            <option value="negociacion" ${currentStatus === 'negociacion' ? 'selected' : ''}>💼 En Cotización</option>
            <option value="ganado" ${currentStatus === 'ganado' ? 'selected' : ''}>🏆 Ganado</option>
          </select>
        </div>
      </article>
    `;
  }

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
    const contractor = item.contratista?.nombre || 'su equipo';

    let pitchTemplate = '';
    if (isAdjudicado) {
      pitchTemplate = `Apreciados señores de ${contractor},\n\nUn saludo cordial. Nos comunicamos en relación con la reciente adjudicación del proceso ${item.referencia} con la entidad ${item.entidad} por un valor de ${item.precio_formateado} para la ejecución de: "${item.descripcion?.slice(0, 140)}...".\n\nSomos especialistas en el suministro y entrega inmediata de ${materials}. Ponemos a su disposición nuestra capacidad operativa, cotizaciones competitivas y disponibilidad técnica en la región.\n\n¿Con quién de su equipo de compras o ingeniería del proyecto podríamos coordinar el envío de nuestra propuesta técnica y comercial?`;
    } else {
      pitchTemplate = `Estimado aliado / cliente contratista,\n\nQueremos compartirte esta oportunidad estratégica identificada en SECOP II antes de su cierre:\n\nProceso: ${item.referencia}\nEntidad: ${item.entidad}\nPresupuesto Oficial: ${item.precio_formateado}\nUbicación: ${item.ciudad}, ${item.departamento}\nAlcance: "${item.descripcion?.slice(0, 160)}..."\n\nPodemos respaldar tu propuesta con nuestros suministros de ${materials}. Si deseas que revisemos los pliegos juntos para presentar oferta o estructurar el consorcio, avísanos para coordinar de inmediato.`;
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
      'Departamento', 'Ciudad', 'Contratista', 'NIT Contratista', 'Enlace SECOP'
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
      `"${item.url_secop || ''}"`
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
