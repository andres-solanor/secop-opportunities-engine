/**
 * Perfiles de empresa: onboarding guiado, revelación de inteligencia de mercado
 * ("momento wow") y cuenta con Google.
 *
 * Flujo de activación:
 *   1. Cualquier visitante construye su perfil sin registrarse (borrador local).
 *   2. Mientras responde, ve en vivo cuánto mercado público coincide con su oferta.
 *   3. Al terminar recibe su Perfil de Oportunidades; los nombres de contactos y
 *      las oportunidades concretas se desbloquean al guardar con Google.
 */
(function () {
  const DRAFT_KEY = 'secop_profile_draft';
  const PROFILES_KEY = 'secop_profiles';
  const E = window.ProfileEngine;
  const Auth = window.SecopAuth;
  const DATA = window.PROSPECTS_DATA || [];
  const TAXONOMY = window.SECTOR_TAXONOMY || {};

  const DEPARTMENTS = [
    'Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bolívar', 'Boyacá', 'Caldas', 'Caquetá',
    'Casanare', 'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca', 'Distrito Capital de Bogotá',
    'Guainía', 'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta', 'Nariño', 'Norte de Santander',
    'Putumayo', 'Quindío', 'Risaralda', 'San Andrés, Providencia y Santa Catalina', 'Santander',
    'Sucre', 'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada'
  ];

  const STEPS = [
    { title: '¿Quién eres en el mercado público?', hint: 'Así sabremos qué tipo de oportunidades y conexiones priorizar.' },
    { title: '¿Qué ofreces?', hint: 'Escríbelo como se lo contarías a un cliente. Detectamos tu sector en tiempo real.' },
    { title: '¿Qué necesitas y a quién buscas?', hint: 'Convertimos tus necesidades en conexiones concretas.' },
    { title: '¿Dónde y de qué tamaño?', hint: 'Afinamos el mercado a tu capacidad real.' }
  ];

  const listeners = [];
  let wizardStep = 0;
  let wizardDraft = null;
  let analysisCache = null;

  // ---------- Persistencia ----------
  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function getProfile() {
    const user = Auth.getUser();
    if (user) return readJson(PROFILES_KEY, {})[user.id] || null;
    return readJson(DRAFT_KEY, null);
  }

  function saveProfile(profile) {
    profile.updatedAt = new Date().toISOString();
    const user = Auth.getUser();
    if (user) {
      const all = readJson(PROFILES_KEY, {});
      all[user.id] = profile;
      localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(profile));
    }
    analysisCache = null;
    listeners.forEach(fn => fn(profile));
  }

  /** Al iniciar sesión, el borrador anónimo se convierte en el perfil de la cuenta. */
  function adoptDraft(user) {
    const draft = readJson(DRAFT_KEY, null);
    const all = readJson(PROFILES_KEY, {});
    if (draft && !all[user.id]) {
      all[user.id] = { ...draft, ownerEmail: user.email || '' };
      localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
    }
    localStorage.removeItem(DRAFT_KEY);
  }

  function getAnalysis() {
    const profile = getProfile();
    if (!profile) return null;
    if (!analysisCache) analysisCache = E.analyzeProfile(profile, DATA, TAXONOMY);
    return analysisCache;
  }

  function matchItem(item) {
    const profile = getProfile();
    const analysis = getAnalysis();
    if (!profile || !analysis) return null;
    return E.matchOpportunity(profile, item, analysis.detected);
  }

  // ---------- Utilidades de UI ----------
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toast(message, type) {
    if (window.showAppToast) window.showAppToast(message, type);
  }

  /** Catálogo de sugerencias agrupado por familia de sectores (window.SECTOR_GROUPS). */
  function catalogFamilies() {
    const catalog = E.offerCatalog(TAXONOMY);
    const families = (window.SECTOR_GROUPS || []).map(g => ({
      name: g.name,
      sectors: catalog.filter(sec => TAXONOMY[sec.id].grupo === g.id)
    }));
    const grouped = new Set(families.flatMap(f => f.sectors.map(s => s.id)));
    const rest = catalog.filter(sec => !grouped.has(sec.id));
    if (rest.length) families.push({ name: 'Otros sectores', sectors: rest });
    return families.filter(f => f.sectors.length);
  }

  function chip(label, { active = false, attrs = '' } = {}) {
    return `<button type="button" class="chip ${active ? 'active' : ''}" ${attrs}>${esc(label)}</button>`;
  }

  const modal = document.getElementById('profileModal');
  const modalBody = document.getElementById('profileModalBody');

  function openModal(html) {
    modalBody.innerHTML = html;
    modal.classList.add('active');
    modal.querySelector('.modal-content').scrollTop = 0;
  }

  function closeModal() {
    modal.classList.remove('active');
  }

  document.getElementById('profileModalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  // ---------- Onboarding ----------
  function emptyProfile() {
    const user = Auth.getUser();
    const domain = user && user.hostedDomain ? user.hostedDomain : '';
    return {
      role: '',
      companyName: '',
      nit: '',
      website: domain ? `https://${domain}` : '',
      offerText: '',
      offerTags: [],
      sectors: [],
      needs: [],
      connections: [],
      departments: [],
      nationwide: false,
      tickets: [],
      experienceYears: '',
      hasRup: false
    };
  }

  function openWizard(step = 0) {
    wizardDraft = { ...emptyProfile(), ...(getProfile() || {}) };
    wizardStep = step;
    renderWizard();
  }

  function liveMarketLine(profile) {
    const detected = E.detectSectors(profile, TAXONOMY);
    if (!detected.length) {
      return '<span class="live-dot"></span> Cuéntanos qué ofreces y calcularemos tu mercado en SECOP II…';
    }
    const a = E.analyzeProfile(profile, DATA, TAXONOMY);
    const zone = profile.nationwide || !(profile.departments || []).length ? 'en el país' : 'en tu zona';
    return `<span class="live-dot on"></span> <b>${a.market.total}</b> procesos por <b>${E.formatCopShort(a.market.totalValue)}</b> ${zone} ya coinciden con tu perfil · <b>${a.matchCount}</b> con alta afinidad`;
  }

  function detectedHtml(profile) {
    const detected = E.detectSectors(profile, TAXONOMY);
    if (!detected.length) {
      return '<div class="detect-empty">Aún no detectamos tu sector. Menciona productos concretos (ej. "estructuras metálicas", "cocinas industriales", "paneles solares") o elige sugerencias abajo.</div>';
    }
    return detected.map(d => `
      <div class="detect-row">
        <div class="detect-name">✓ ${esc(d.name)}</div>
        <div class="strength-bar"><span style="width:${d.strength}%"></span></div>
        <div class="detect-kw">${d.keywords.slice(0, 6).map(k => `<span class="mini-tag">${esc(k)}</span>`).join('')}</div>
      </div>`).join('');
  }

  function wizardStepHtml(p) {
    if (wizardStep === 0) {
      return `
        <div class="role-grid">
          ${Object.entries(E.ROLES).map(([id, r]) => `
            <button type="button" class="role-card ${p.role === id ? 'active' : ''}" data-role="${id}">
              <span class="role-icon">${r.icon}</span>
              <span class="role-label">${esc(r.label)}</span>
              <span class="role-desc">${id === 'proveedor' ? 'Vendo insumos, equipos o materiales a quienes ejecutan contratos públicos.' : id === 'contratista' ? 'Me presento a licitaciones y ejecuto obras, suministros o servicios.' : 'Ayudo a otros a estructurar ofertas, consorcios y requisitos.'}</span>
            </button>`).join('')}
        </div>
        <div class="form-grid">
          <label>Nombre de tu empresa<input class="input" data-field="companyName" value="${esc(p.companyName)}" placeholder="Ej. Aceros del Caribe S.A.S."></label>
          <label>NIT <small>(opcional)</small><input class="input" data-field="nit" value="${esc(p.nit)}" placeholder="900123456-7"></label>
          <label class="span-2">Sitio web <small>(opcional)</small><input class="input" data-field="website" value="${esc(p.website)}" placeholder="https://"></label>
        </div>`;
    }

    if (wizardStep === 1) {
      const tags = new Set(p.offerTags || []);
      const detected = new Set(E.detectSectors(p, TAXONOMY).map(d => d.id));
      return `
        <label class="block-label">Describe tu oferta
          <textarea class="input textarea" data-field="offerText" rows="4" placeholder="Ej. Fabricamos y montamos estructuras metálicas, cerchas y cubiertas para colegios y escenarios deportivos. Entregamos en todo Antioquia en 15 días.">${esc(p.offerText)}</textarea>
        </label>
        <div class="detect-box" id="detectBox">${detectedHtml(p)}</div>
        <div class="catalog">
          <div class="catalog-title">Sugerencias rápidas: abre tu familia de sectores y toca lo que ofreces</div>
          ${catalogFamilies().map(fam => {
            // Abierta si ya eligió algo o detectamos uno de sus sectores; si no, cerrada para no abrumar.
            const open = fam.sectors.some(sec => detected.has(sec.id) || sec.tags.some(t => tags.has(t)));
            return `
            <details class="catalog-family" data-sectors="${esc(fam.sectors.map(s => s.id).join(','))}" ${open ? 'open' : ''}>
              <summary><span>${esc(fam.name)}</span><small>${esc(fam.sectors.map(s => s.name).join(' · '))}</small></summary>
              ${fam.sectors.map(sec => `
                <div class="catalog-group">
                  <div class="catalog-sector">${esc(sec.name)}</div>
                  <div class="chips">${sec.tags.map(t => chip(t, { active: tags.has(t), attrs: `data-tag="${esc(t)}"` })).join('')}</div>
                </div>`).join('')}
            </details>`;
          }).join('')}
        </div>`;
    }

    if (wizardStep === 2) {
      return `
        <div class="block-label">Lo que necesitas para crecer <small>(elige varias)</small></div>
        <div class="chips">${Object.entries(E.NEEDS).map(([id, label]) => chip(label, { active: p.needs.includes(id), attrs: `data-need="${id}"` })).join('')}</div>
        <div class="block-label section-gap">Conexiones que buscas</div>
        <div class="chips">${Object.entries(E.CONNECTIONS).map(([id, label]) => chip(label, { active: p.connections.includes(id), attrs: `data-conn="${id}"` })).join('')}</div>`;
    }

    return `
      <div class="block-label">Cobertura geográfica</div>
      <div class="chips">
        ${chip('🇨🇴 Todo el país', { active: p.nationwide, attrs: 'data-nationwide="1"' })}
        ${DEPARTMENTS.map(d => chip(d, { active: !p.nationwide && p.departments.includes(d), attrs: `data-dept="${esc(d)}"` })).join('')}
      </div>
      <div class="block-label section-gap">Tamaño de contratos que puedes atender <small>(COP)</small></div>
      <div class="chips">${Object.entries(E.TICKETS).map(([id, t]) => chip(t.label, { active: p.tickets.includes(id), attrs: `data-ticket="${id}"` })).join('')}</div>
      <div class="form-grid section-gap">
        <label>Años de experiencia<input class="input" type="number" min="0" max="80" data-field="experienceYears" value="${esc(p.experienceYears)}" placeholder="Ej. 8"></label>
        <label class="check-label"><input type="checkbox" data-field="hasRup" ${p.hasRup ? 'checked' : ''}> Inscrito en el RUP (Registro Único de Proponentes)</label>
      </div>`;
  }

  function canAdvance(p) {
    if (wizardStep === 0) return !!p.role;
    if (wizardStep === 1) return E.detectSectors(p, TAXONOMY).length > 0;
    return true;
  }

  function renderWizard() {
    const p = wizardDraft;
    const step = STEPS[wizardStep];
    openModal(`
      <div class="wizard">
        <div class="wizard-progress">
          ${STEPS.map((_, i) => `<span class="${i <= wizardStep ? 'done' : ''}"></span>`).join('')}
        </div>
        <div class="wizard-step-label">Paso ${wizardStep + 1} de ${STEPS.length}</div>
        <h2 class="wizard-title">${step.title}</h2>
        <p class="wizard-hint">${step.hint}</p>
        <div class="wizard-body">${wizardStepHtml(p)}</div>
        <div class="live-market" id="liveMarket">${liveMarketLine(p)}</div>
        <div class="wizard-actions">
          ${wizardStep > 0 ? '<button type="button" class="btn btn-outline" id="wizBack">← Atrás</button>' : '<span></span>'}
          <button type="button" class="btn btn-primary" id="wizNext" ${canAdvance(p) ? '' : 'disabled'}>
            ${wizardStep === STEPS.length - 1 ? '✨ Ver mi Perfil de Oportunidades' : 'Continuar →'}
          </button>
        </div>
      </div>`);
    bindWizard();
  }

  function refreshLive() {
    document.getElementById('liveMarket').innerHTML = liveMarketLine(wizardDraft);
    // Mientras escribe: se abre la familia del sector detectado (nunca se cierra una que abrió él).
    const detected = new Set(E.detectSectors(wizardDraft, TAXONOMY).map(d => d.id));
    modalBody.querySelectorAll('details.catalog-family').forEach(fam => {
      if (fam.dataset.sectors.split(',').some(id => detected.has(id))) fam.open = true;
    });
    const detectBox = document.getElementById('detectBox');
    if (detectBox) detectBox.innerHTML = detectedHtml(wizardDraft);
    document.getElementById('wizNext').disabled = !canAdvance(wizardDraft);
  }

  function toggleIn(list, value) {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else list.push(value);
  }

  function bindWizard() {
    const p = wizardDraft;

    modalBody.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () => {
      p.role = btn.dataset.role;
      modalBody.querySelectorAll('[data-role]').forEach(b => b.classList.toggle('active', b === btn));
      refreshLive();
    }));

    modalBody.querySelectorAll('[data-field]').forEach(input => {
      const evt = input.type === 'checkbox' ? 'change' : 'input';
      input.addEventListener(evt, () => {
        p[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
        refreshLive();
      });
    });

    const chipHandlers = {
      tag: (btn) => toggleIn(p.offerTags, btn.dataset.tag),
      need: (btn) => toggleIn(p.needs, btn.dataset.need),
      conn: (btn) => toggleIn(p.connections, btn.dataset.conn),
      ticket: (btn) => toggleIn(p.tickets, btn.dataset.ticket),
      dept: (btn) => {
        toggleIn(p.departments, btn.dataset.dept);
        p.nationwide = false;
        const nat = modalBody.querySelector('[data-nationwide]');
        if (nat) nat.classList.remove('active');
      },
      nationwide: () => {
        p.nationwide = !p.nationwide;
        if (p.nationwide) {
          p.departments = [];
          modalBody.querySelectorAll('[data-dept]').forEach(b => b.classList.remove('active'));
        }
      }
    };
    Object.entries(chipHandlers).forEach(([key, handler]) => {
      modalBody.querySelectorAll(`[data-${key}]`).forEach(btn => btn.addEventListener('click', () => {
        handler(btn);
        if (key !== 'dept' && key !== 'nationwide') btn.classList.toggle('active');
        else if (key === 'dept') btn.classList.toggle('active', p.departments.includes(btn.dataset.dept));
        else btn.classList.toggle('active', p.nationwide);
        refreshLive();
      }));
    });

    const back = document.getElementById('wizBack');
    if (back) back.addEventListener('click', () => {
      wizardStep -= 1;
      renderWizard();
    });

    document.getElementById('wizNext').addEventListener('click', () => {
      if (!canAdvance(p)) return;
      if (wizardStep < STEPS.length - 1) {
        wizardStep += 1;
        renderWizard();
        return;
      }
      saveProfile({ ...p });
      openProfileView({ celebrate: true });
    });
  }

  // ---------- Perfil de Oportunidades (momento wow) ----------
  function strengthRing(score) {
    const deg = Math.round((score / 100) * 360);
    return `<div class="strength-ring" style="--deg:${deg}deg"><span>${score}%</span></div>`;
  }

  /** Escapa el texto y, si el perfil no está guardado, difumina solo los nombres de empresas. */
  function maskNames(text, names, locked) {
    let html = esc(text);
    if (!locked) return html;
    names.filter(Boolean).forEach(n => {
      html = html.split(esc(n)).join(`<span class="soft-lock">${esc(n)}</span>`);
    });
    return html;
  }

  function lockedList(examples, locked) {
    if (!examples.length) return '';
    return `<ul class="example-list ${locked ? 'locked' : ''}">
      ${examples.map(x => `<li>${locked ? '██████ ████████' : esc(x)}</li>`).join('')}
    </ul>`;
  }

  function openProfileView({ celebrate = false } = {}) {
    const profile = getProfile();
    if (!profile) {
      openWizard();
      return;
    }
    const a = getAnalysis();
    const user = Auth.getUser();
    const locked = !user;
    const m = a.market;
    const zoneLabel = profile.nationwide || !(profile.departments || []).length ? 'Colombia' : (profile.departments.length > 2 ? `${profile.departments.length} departamentos` : profile.departments.join(' y '));

    openModal(`
      <div class="reveal">
        ${celebrate ? '<div class="reveal-kicker">✨ Listo. Esto es lo que vemos de tu negocio en SECOP II</div>' : ''}
        <div class="reveal-header">
          <div>
            <div class="reveal-role">${a.role.icon} ${esc(a.role.label)}</div>
            <h2 class="reveal-title">${esc(profile.companyName || 'Tu Perfil de Oportunidades')}</h2>
            <div class="reveal-sectors">${a.detected.map(d => `<span class="sector-pill">${esc(d.name)}</span>`).join('')}</div>
          </div>
          <div class="strength-box">
            ${strengthRing(a.strength.score)}
            <div class="strength-caption">Fuerza del perfil</div>
          </div>
        </div>

        <section class="reveal-block highlight">
          <div class="block-kicker">Tu propuesta de valor, clarificada</div>
          <p class="value-prop">${esc(a.valueProp)}</p>
        </section>

        <section class="reveal-kpis">
          <div class="rk"><div class="rk-value">${E.formatCopShort(m.totalValue)}</div><div class="rk-label">Mercado direccionable en ${esc(zoneLabel)}</div></div>
          <div class="rk"><div class="rk-value">${m.total}</div><div class="rk-label">Procesos que piden lo que ofreces</div></div>
          <div class="rk"><div class="rk-value">${m.open}</div><div class="rk-label">Aún abiertos: llegas a tiempo</div></div>
          <div class="rk"><div class="rk-value">${m.entities}</div><div class="rk-label">Entidades compradoras</div></div>
        </section>
        ${m.total === 0 && m.nationalTotal > 0 ? `<p class="reveal-note">En ${esc(zoneLabel)} no vemos procesos recientes, pero a nivel nacional hay <b>${m.nationalTotal}</b> por <b>${E.formatCopShort(m.nationalValue)}</b>. Considera ampliar tu cobertura.</p>` : ''}
        ${m.topDepartments.length ? `<p class="reveal-note">📍 Donde más se compra tu sector: ${m.topDepartments.map(d => `<b>${esc(d.name)}</b> (${E.formatCopShort(d.value)})`).join(' · ')}</p>` : ''}

        <section class="reveal-block">
          <div class="block-kicker">🎯 Tu cliente ideal</div>
          <p>${maskNames(a.idealClient, [...m.topWinners, ...m.topEntities].map(x => x.name), locked)}</p>
        </section>

        ${a.connections.length ? `
        <section class="reveal-block">
          <div class="block-kicker">🔗 Las conexiones que buscas, ya identificadas</div>
          <div class="conn-grid">
            ${a.connections.map(c => `
              <div class="conn-card">
                <div class="conn-head"><span>${esc(c.label)}</span><span class="conn-count">${c.count}</span></div>
                <p>${esc(c.insight)}</p>
                ${lockedList(c.examples, locked)}
              </div>`).join('')}
          </div>
        </section>` : ''}

        ${a.recommendations.length ? `
        <section class="reveal-block">
          <div class="block-kicker">🧭 Lo que necesitas → cómo lo resolvemos</div>
          <div class="need-list">
            ${a.recommendations.map(r => `<div class="need-item"><div class="need-label">${esc(r.label)}</div><div class="need-advice">${esc(r.advice)}</div></div>`).join('')}
          </div>
        </section>` : ''}

        <section class="reveal-block">
          <div class="block-kicker">🎤 Tu pitch de 30 segundos</div>
          <div class="pitch-box" id="elevatorPitch">${esc(a.elevatorPitch)}</div>
          <button type="button" class="btn btn-outline btn-sm" id="copyElevator">📋 Copiar pitch</button>
        </section>

        <section class="reveal-block">
          <div class="block-kicker">🔔 Palabras clave para tus alertas</div>
          <div class="chips">${a.alertKeywords.map(k => `<span class="mini-tag">${esc(k)}</span>`).join('')}</div>
        </section>

        ${a.topMatches.length ? `
        <section class="reveal-block">
          <div class="block-kicker">⚡ Tus mejores oportunidades hoy (${a.matchCount} con alta afinidad)</div>
          <div class="top-matches">
            ${a.topMatches.map(t => `
              <div class="tm-row">
                <span class="match-pill">${t.score}%</span>
                <span class="tm-entity ${locked ? 'soft-lock' : ''}">${esc(t.item.entidad)}</span>
                <span class="tm-value">${esc(E.formatCopShort(t.item.precio || 0))}</span>
              </div>`).join('')}
          </div>
        </section>` : ''}

        ${a.strength.missing.length ? `
        <section class="reveal-block">
          <div class="block-kicker">📈 Sube la fuerza de tu perfil</div>
          <ul class="tips">${a.strength.missing.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        </section>` : ''}

        <div class="reveal-cta">
          ${locked ? `
            <div class="cta-copy">
              <strong>Guarda tu perfil y desbloquea ${a.matchCount} oportunidades, los nombres de tus conexiones y tu radar diario.</strong>
              <span>Gratis. Con tu cuenta de Google, en un clic.</span>
            </div>
            <div id="revealGoogleBtn" class="google-slot"></div>
          ` : `
            <button type="button" class="btn btn-outline" id="editProfileBtn">✏️ Editar perfil</button>
            <button type="button" class="btn btn-primary" id="goMatchesBtn">⚡ Ver mis ${a.matchCount} oportunidades</button>
          `}
        </div>
        ${locked ? '<button type="button" class="link-btn" id="editProfileBtn">✏️ Ajustar respuestas</button>' : ''}
      </div>`);

    document.getElementById('copyElevator').addEventListener('click', () => {
      navigator.clipboard.writeText(a.elevatorPitch).then(() => toast('Pitch copiado al portapapeles', 'success'));
    });
    document.getElementById('editProfileBtn').addEventListener('click', () => openWizard(0));
    const go = document.getElementById('goMatchesBtn');
    if (go) go.addEventListener('click', () => {
      closeModal();
      if (window.showForYouTab) window.showForYouTab();
    });
    if (locked) Auth.renderButton(document.getElementById('revealGoogleBtn'), { text: 'signup_with' });
  }

  // ---------- Cuenta y banner ----------
  function openSignIn() {
    openModal(`
      <div class="signin">
        <div class="brand-icon">⚡</div>
        <h2 class="wizard-title">Entra a tu radar de contratación pública</h2>
        <p class="wizard-hint">Tu perfil, tus oportunidades con afinidad y tu pipeline, guardados en tu cuenta.</p>
        <div id="signinGoogleBtn" class="google-slot"></div>
        <p class="fine-print">Solo usamos tu nombre, correo y foto de Google. No publicamos nada en tu nombre.</p>
      </div>`);
    Auth.renderButton(document.getElementById('signinGoogleBtn'), { text: 'continue_with' });
  }

  function renderAccountArea() {
    const area = document.getElementById('accountArea');
    const user = Auth.getUser();
    if (!user) {
      area.innerHTML = '<button type="button" class="btn btn-outline" id="btnSignIn"><span class="g-mark">G</span> Iniciar sesión</button>';
      document.getElementById('btnSignIn').addEventListener('click', openSignIn);
      return;
    }
    const initials = (user.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    area.innerHTML = `
      <div class="account-menu">
        <button type="button" class="account-btn" id="accountBtn" aria-haspopup="true" aria-expanded="false">
          ${user.picture ? `<img src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar-fallback">${esc(initials)}</span>`}
          <span class="account-name">${esc(user.givenName || user.name)}</span>
        </button>
        <div class="account-dropdown" id="accountDropdown">
          <div class="account-email">${esc(user.email || 'Modo demo local')}</div>
          <button type="button" data-action="profile">👤 Mi perfil de oportunidades</button>
          <button type="button" data-action="edit">✏️ Editar perfil</button>
          <button type="button" data-action="signout">↩︎ Cerrar sesión</button>
        </div>
      </div>`;
    const btn = document.getElementById('accountBtn');
    const dd = document.getElementById('accountDropdown');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    dd.querySelectorAll('[data-action]').forEach(item => item.addEventListener('click', () => {
      dd.classList.remove('open');
      if (item.dataset.action === 'profile') openProfileView();
      if (item.dataset.action === 'edit') openWizard(0);
      if (item.dataset.action === 'signout') {
        Auth.signOut();
        toast('Sesión cerrada', 'info');
      }
    }));
  }

  function renderHero() {
    const hero = document.getElementById('profileHero');
    const user = Auth.getUser();
    const profile = getProfile();

    if (!profile) {
      hero.innerHTML = `
        <div class="hero-copy">
          <div class="hero-kicker">Nuevo · Perfil de Oportunidades</div>
          <h2>Descubre cuánto mercado público hay para lo que ofreces</h2>
          <p>Responde 4 preguntas y en 2 minutos te mostramos tu propuesta de valor clarificada, tu mercado en pesos, tu cliente ideal y las empresas con las que deberías conectar. Sin registro para empezar.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn btn-primary btn-lg" id="heroStart">✨ Crear mi perfil gratis</button>
          ${user ? '' : '<button type="button" class="link-btn" id="heroSignIn">Ya tengo cuenta</button>'}
        </div>`;
      document.getElementById('heroStart').addEventListener('click', () => openWizard(0));
      const si = document.getElementById('heroSignIn');
      if (si) si.addEventListener('click', openSignIn);
      return;
    }

    const a = getAnalysis();
    hero.innerHTML = `
      <div class="hero-profile">
        ${strengthRing(a.strength.score)}
        <div>
          <div class="hero-kicker">${a.role.icon} ${esc(profile.companyName || a.role.short)}${user ? '' : ' · perfil sin guardar'}</div>
          <h2>${a.matchCount} oportunidades con alta afinidad · ${E.formatCopShort(a.market.totalValue)} en tu mercado</h2>
          <p>${esc(a.valueProp)}</p>
        </div>
      </div>
      <div class="hero-actions">
        ${user
          ? '<button type="button" class="btn btn-primary" id="heroMatches">⚡ Ver para ti</button><button type="button" class="btn btn-outline" id="heroProfile">👤 Mi perfil</button>'
          : '<div id="heroGoogleBtn" class="google-slot"></div><button type="button" class="link-btn" id="heroProfile">Ver mi perfil</button>'}
      </div>`;
    document.getElementById('heroProfile').addEventListener('click', () => openProfileView());
    const hm = document.getElementById('heroMatches');
    if (hm) hm.addEventListener('click', () => window.showForYouTab && window.showForYouTab());
    if (!user) Auth.renderButton(document.getElementById('heroGoogleBtn'), { text: 'signup_with' });
  }

  document.addEventListener('click', () => {
    const dd = document.getElementById('accountDropdown');
    if (dd) dd.classList.remove('open');
  });

  // ---------- Ciclo de vida ----------
  Auth.onChange(user => {
    analysisCache = null;
    if (user) adoptDraft(user);
    renderAccountArea();
    renderHero();
    listeners.forEach(fn => fn(getProfile()));

    if (user) {
      toast(`Bienvenido, ${user.givenName || user.name}. Tu perfil quedó guardado.`, 'success');
      if (getProfile()) openProfileView();
      else openWizard(0);
    }
  });

  listeners.push(() => renderHero());

  window.SecopProfile = {
    getProfile,
    getAnalysis,
    matchItem,
    openWizard,
    openProfileView,
    openSignIn,
    onChange: fn => listeners.push(fn)
  };

  renderAccountArea();
  renderHero();
})();
