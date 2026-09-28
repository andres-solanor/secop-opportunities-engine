/**
 * Motor de Perfiles: funciones puras (sin DOM) que convierten un perfil de
 * empresa en inteligencia accionable usando el dataset curado de SECOP II.
 *
 *  - detectSectors: clasifica la oferta libre en los mismos sectores del pipeline Python.
 *  - analyzeProfile: propuesta de valor, tamaño de mercado, cliente ideal,
 *    conexiones concretas, recomendaciones según necesidades y fuerza del perfil.
 *  - matchOpportunity: puntaje de afinidad perfil ↔ oportunidad con razones legibles.
 *
 * Se expone como window.ProfileEngine y como módulo CommonJS para pruebas con Node.
 */
(function (root) {
  const ROLES = {
    proveedor: {
      label: 'Proveedor / Fabricante de insumos',
      short: 'Proveedor',
      icon: '🏭',
      verb: 'suministra',
      buyers: 'contratistas y consorcios que ganan obras y suministros públicos',
      stageFit: { adjudicado: 10, ofertas: 7, borrador: 6 }
    },
    contratista: {
      label: 'Contratista / Licitante',
      short: 'Contratista',
      icon: '🏗️',
      verb: 'ejecuta proyectos de',
      buyers: 'entidades públicas que contratan por SECOP II',
      stageFit: { adjudicado: 3, ofertas: 10, borrador: 10 }
    },
    consultor: {
      label: 'Consultor / Estructurador / Abogado',
      short: 'Consultor',
      icon: '⚖️',
      verb: 'estructura y acompaña ofertas de',
      buyers: 'contratistas y consorcios que licitan con el Estado',
      stageFit: { adjudicado: 3, ofertas: 9, borrador: 10 }
    }
  };

  const NEEDS = {
    consorcio: '🤝 Socios para consorcio / unión temporal',
    experiencia: '📜 Experiencia habilitante (RUP)',
    capital: '💰 Capital de trabajo / financiación',
    polizas: '🛡️ Pólizas y garantías',
    juridico: '⚖️ Estructuración jurídica de ofertas',
    proveedores: '📦 Proveedores de insumos confiables',
    clientes: '🎯 Nuevos clientes contratistas',
    visibilidad: '📣 Visibilidad ante entidades'
  };

  const CONNECTIONS = {
    contratistas_ganadores: '🏆 Contratistas que acaban de ganar',
    entidades: '🏛️ Entidades públicas compradoras',
    aliados_consorcio: '🤝 Aliados para consorcio',
    proveedores_complementarios: '🧩 Proveedores complementarios',
    consultores: '⚖️ Consultores y estructuradores'
  };

  const TICKETS = {
    micro: { label: 'Hasta $200 Millones', min: 0, max: 200e6 },
    pyme: { label: '$200M – $1.000M', min: 200e6, max: 1e9 },
    mediano: { label: '$1.000M – $5.000M', min: 1e9, max: 5e9 },
    grande: { label: 'Más de $5.000M', min: 5e9, max: Infinity }
  };

  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function containsTerm(haystackNorm, term) {
    const t = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(haystackNorm);
  }

  function stageOf(item) {
    const s = normalize(item.etapa_comercial);
    if (s.includes('adjudicado')) return 'adjudicado';
    if (s.includes('borrador')) return 'borrador';
    return 'ofertas';
  }

  function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const DAY_MS = 24 * 3600 * 1000;
  // Estados de SECOP II en los que ya no se reciben ofertas aunque no haya adjudicación.
  const CLOSED_STATES = ['evaluacion', 'seleccionado', 'en aprobacion', 'aprobado', 'suspendido'];

  /**
   * Ventana de participación real de una oportunidad en la fecha `now`:
   *  - 'adjudicado': ya hay ganador (vender al contratista).
   *  - 'abierta': recibe ofertas (cierre futuro o, sin fecha, estado publicado/abierto).
   *  - 'borrador': pliego en borrador; aún se pueden presentar observaciones.
   *  - 'cerrada': ya no recibe ofertas (cierre vencido o estado de evaluación/selección).
   * `days` son los días hasta el cierre (negativos si ya pasó).
   */
  function bidWindow(item, now = new Date()) {
    const fechas = item.fechas || {};
    const published = toDate(fechas.publicacion || item.fecha_publicacion);
    const stage = stageOf(item);
    if (stage === 'adjudicado') {
      return { state: 'adjudicado', date: toDate(fechas.adjudicacion), published };
    }
    const closing = toDate(fechas.cierre_ofertas);
    // SECOP publica el cierre como fecha sin hora: se considera abierto hasta el final de ese día.
    const deadline = closing && closing.getHours() === 0 && closing.getMinutes() === 0
      ? new Date(closing.getTime() + DAY_MS - 1000)
      : closing;
    if (closing && stage !== 'borrador') {
      const days = (deadline - now) / DAY_MS;
      return { state: days >= 0 ? 'abierta' : 'cerrada', date: closing, days, published };
    }
    const estado = normalize(item.estado_secop);
    if (CLOSED_STATES.some(st => estado.includes(st))) {
      return { state: 'cerrada', date: closing, published };
    }
    return { state: stage === 'borrador' ? 'borrador' : 'abierta', date: closing, days: deadline ? (deadline - now) / DAY_MS : null, published };
  }

  /** "107 día(s)" → "107 días"; "1 mes(es)" → "1 mes". Tolera datos ya normalizados. */
  function formatTerm(plazo) {
    if (!plazo || !plazo.valor) return '';
    const unit = normalize(plazo.unidad).replace(/\(.*\)/, '').trim();
    const forms = { dia: ['día', 'días'], mes: ['mes', 'meses'], ano: ['año', 'años'], semana: ['semana', 'semanas'] };
    const key = Object.keys(forms).find(k => unit.startsWith(k));
    if (!key) return plazo.texto || `${plazo.valor} ${plazo.unidad || ''}`.trim();
    return `${plazo.valor} ${forms[key][plazo.valor === 1 ? 0 : 1]}`;
  }

  function isActionable(item, now) {
    const st = bidWindow(item, now).state;
    return st === 'abierta' || st === 'borrador';
  }

  function uniqueByNormalized(list) {
    const seen = new Set();
    return list.filter(x => {
      const k = normalize(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Catálogo de capacidades sugeridas (chips) por sector, desde la taxonomía del pipeline. */
  function offerCatalog(taxonomy) {
    return Object.entries(taxonomy).map(([id, s]) => ({
      id,
      name: s.name,
      tags: uniqueByNormalized(s.keywords).filter(k => k.length > 3).slice(0, 14)
    }));
  }

  /** Detecta sectores y palabras clave a partir de la oferta libre + chips + sectores elegidos. */
  function detectSectors(profile, taxonomy) {
    const corpus = normalize([profile.offerText, ...(profile.offerTags || [])].join(' | '));
    const chosen = new Set(profile.sectors || []);
    const result = [];

    Object.entries(taxonomy).forEach(([id, s]) => {
      const keywords = uniqueByNormalized(s.keywords.filter(kw => containsTerm(corpus, kw)));
      const strength = keywords.length * 20 + (chosen.has(id) ? 40 : 0);
      if (strength > 0) {
        result.push({ id, name: s.name, keywords, strength: Math.min(100, strength) });
      }
    });

    return result.sort((a, b) => b.strength - a.strength);
  }

  function ticketRange(profile) {
    const keys = (profile.tickets || []).filter(k => TICKETS[k]);
    if (!keys.length) return null;
    return {
      min: Math.min(...keys.map(k => TICKETS[k].min)),
      max: Math.max(...keys.map(k => TICKETS[k].max))
    };
  }

  /** Puntaje 0-100 de afinidad entre el perfil y una oportunidad, con razones legibles. */
  function matchOpportunity(profile, item, detected, now = new Date()) {
    const reasons = [];
    let score = 0;

    const detectedIds = new Set(detected.map(d => d.id));
    const itemSectors = (item.sectores || []).map(s => s.id);
    const sharedSectors = (item.sectores || []).filter(s => detectedIds.has(s.id));
    if (sharedSectors.length) {
      score += 40;
      reasons.push(`Sector: ${sharedSectors.map(s => s.name).join(', ')}`);
    }

    const profileKeywords = new Set(detected.flatMap(d => d.keywords.map(normalize)));
    const sharedMaterials = (item.materiales_detectados || []).filter(m => profileKeywords.has(normalize(m)));
    if (sharedMaterials.length) {
      score += Math.min(15, sharedMaterials.length * 8);
      reasons.push(`Pide lo que ofreces: ${sharedMaterials.slice(0, 3).join(', ')}`);
    }

    const depts = profile.departments || [];
    if (profile.nationwide || !depts.length) {
      score += 10;
    } else if (depts.includes(item.departamento)) {
      score += 15;
      reasons.push(`En tu zona: ${item.departamento}`);
    }

    const range = ticketRange(profile);
    const price = item.precio || 0;
    if (!range) {
      score += 8;
    } else if (price >= range.min && price <= range.max) {
      score += 15;
      reasons.push('Dentro de tu ticket de contrato');
    } else if (price > range.max && price <= range.max * 3) {
      score += 7;
      reasons.push('Supera tu ticket: viable en consorcio');
    }

    const role = ROLES[profile.role];
    const stage = stageOf(item);
    const bw = bidWindow(item, now);
    if (role) {
      // Un proceso que ya no recibe ofertas solo sirve para monitorear: puntaje mínimo de etapa.
      const fit = bw.state === 'cerrada' ? 2 : role.stageFit[stage];
      score += fit;
      if (fit >= 9) {
        if (stage === 'adjudicado') reasons.push('Ganador conocido: vende directo');
        else if (bw.state === 'abierta' && bw.days != null) reasons.push(`Cierra en ${Math.max(0, Math.ceil(bw.days))} días`);
        else reasons.push('Aún abierta: llegas a tiempo');
      }
    }

    // Sin sector compartido la afinidad no puede ser alta, aunque coincidan zona y ticket.
    if (!sharedSectors.length && itemSectors.length) score = Math.min(score, 35);

    return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function topBy(items, keyFn, valueFn, n) {
    const acc = new Map();
    items.forEach(it => {
      const k = keyFn(it);
      if (!k) return;
      const cur = acc.get(k) || { name: k, value: 0, count: 0 };
      cur.value += valueFn(it);
      cur.count += 1;
      acc.set(k, cur);
    });
    return [...acc.values()].sort((a, b) => b.value - a.value).slice(0, n);
  }

  function winnerName(item) {
    const name = item.contratista && item.contratista.nombre;
    return name && name !== 'Pendiente por Adjudicar' ? name : null;
  }

  function profileStrength(profile, detected) {
    const checks = [
      [!!profile.role, 10, 'Elige tu rol en el mercado'],
      [!!(profile.companyName || '').trim(), 10, 'Agrega el nombre de tu empresa'],
      [(profile.offerText || '').trim().length >= 40, 15, 'Describe tu oferta en al menos una frase completa'],
      [detected.length > 0, 15, 'Menciona productos o servicios concretos para detectar tu sector'],
      [(profile.needs || []).length > 0, 10, 'Cuéntanos qué necesitas para crecer'],
      [(profile.connections || []).length > 0, 10, 'Elige qué conexiones buscas'],
      [!!profile.nationwide || (profile.departments || []).length > 0, 10, 'Define tu cobertura geográfica'],
      [(profile.tickets || []).length > 0, 10, 'Indica el tamaño de contratos que puedes atender'],
      [!!profile.experienceYears || !!profile.hasRup, 10, 'Agrega tu experiencia o registro RUP']
    ];
    const score = checks.reduce((acc, [ok, pts]) => acc + (ok ? pts : 0), 0);
    const missing = checks.filter(([ok]) => !ok).map(([, , tip]) => tip);
    return { score, missing };
  }

  function formatCopShort(val) {
    if (val >= 1e12) return `$${(val / 1e12).toFixed(2).replace('.', ',')} billones`;
    if (val >= 1e9) return `$${(val / 1e9).toFixed(1).replace('.', ',')} mil millones`;
    return `$${Math.round(val / 1e6).toLocaleString('es-CO')} millones`;
  }

  function joinHuman(list) {
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
  }

  /** Análisis completo del perfil: el "momento wow" antes de conectar oportunidades. */
  function analyzeProfile(profile, data, taxonomy, now = new Date()) {
    const detected = detectSectors(profile, taxonomy);
    const role = ROLES[profile.role] || ROLES.proveedor;
    const detectedIds = new Set(detected.map(d => d.id));
    const depts = profile.nationwide ? [] : (profile.departments || []);

    const inSector = data.filter(it => (it.sectores || []).some(s => detectedIds.has(s.id)));
    const inZone = depts.length ? inSector.filter(it => depts.includes(it.departamento)) : inSector;
    const range = ticketRange(profile);

    // --- Mercado direccionable ---
    const sum = list => list.reduce((a, it) => a + (it.precio || 0), 0);
    const adjudicados = inZone.filter(it => stageOf(it) === 'adjudicado');
    // Solo cuenta como abierto lo que todavía admite ofertas u observaciones.
    const abiertas = inZone.filter(it => isActionable(it, now));
    // Los ganadores son compradores/aliados sin importar dónde ejecuten: se buscan a nivel nacional.
    const adjudicadosPais = inSector.filter(it => stageOf(it) === 'adjudicado');
    const market = {
      total: inZone.length,
      totalValue: sum(inZone),
      nationalTotal: inSector.length,
      nationalValue: sum(inSector),
      open: abiertas.length,
      openValue: sum(abiertas),
      awarded: adjudicados.length,
      awardedValue: sum(adjudicados),
      entities: new Set(inZone.map(it => it.entidad).filter(Boolean)).size,
      winners: new Set(adjudicadosPais.map(winnerName).filter(Boolean)).size,
      winnersValue: sum(adjudicadosPais.filter(winnerName)),
      typicalTicket: median(inZone.map(it => it.precio || 0).filter(v => v > 0)),
      inTicket: range ? inZone.filter(it => it.precio >= range.min && it.precio <= range.max).length : null,
      aboveTicket: range ? inZone.filter(it => it.precio > range.max).length : null,
      topDepartments: topBy(inSector, it => it.departamento !== 'No Definido' && it.departamento, it => it.precio || 0, 3),
      topEntities: topBy(inZone, it => it.entidad, it => it.precio || 0, 3),
      topWinners: topBy(adjudicadosPais, winnerName, it => it.precio || 0, 3)
    };

    // --- Propuesta de valor clarificada ---
    const offerWords = uniqueByNormalized([
      ...(profile.offerTags || []),
      ...detected.flatMap(d => d.keywords)
    ]).slice(0, 4);
    const company = (profile.companyName || '').trim() || 'Tu empresa';
    const zone = depts.length ? joinHuman(depts.slice(0, 3)) + (depts.length > 3 ? ' y más' : '') : 'todo el país';
    const offerPhrase = offerWords.length ? joinHuman(offerWords) : (detected[0] ? detected[0].name.toLowerCase() : 'sus productos y servicios');
    const ticketPhrase = range
      ? `Atiende contratos ${range.max === Infinity ? `desde ${formatCopShort(range.min)}` : `de hasta ${formatCopShort(range.max)}`}`
      : '';
    const valueProp = `${company} ${role.verb} ${offerPhrase} para ${role.buyers} en ${zone}.` +
      (ticketPhrase ? ` ${ticketPhrase}.` : '');

    const differentiator = [
      profile.experienceYears ? `${profile.experienceYears} años de experiencia` : null,
      profile.hasRup ? 'inscrita en el RUP' : null,
      depts.length ? `presencia en ${zone}` : 'cobertura nacional'
    ].filter(Boolean);

    const elevatorPitch = market.total
      ? `Somos ${company}: ${offerPhrase}, con ${joinHuman(differentiator)}. Este año identificamos ${market.total} procesos públicos por ${formatCopShort(market.totalValue)} que requieren exactamente lo que hacemos, y queremos ser su aliado para ejecutarlos a tiempo y sin sobrecostos.`
      : `Somos ${company}: ${offerPhrase}, con ${joinHuman(differentiator)}. Buscamos aliados para llevar nuestra oferta a la contratación pública colombiana.`;

    const idealClient = profile.role === 'contratista'
      ? `Entidades como ${joinHuman(market.topEntities.map(e => e.name).slice(0, 2)) || 'alcaldías y gobernaciones'} con procesos de ${offerPhrase} en etapa de borrador u ofertas.`
      : profile.role === 'consultor'
        ? `Contratistas que licitan procesos de ${offerPhrase} por encima de ${formatCopShort(market.typicalTicket || 300e6)} y necesitan estructurar su oferta o consorcio.`
        : `Contratistas ganadores como ${joinHuman(market.topWinners.map(w => w.name).slice(0, 2)) || 'consorcios de obra y suministro'} que necesitan comprar ${offerPhrase} en las próximas semanas.`;

    // --- Conexiones concretas ---
    const coSectors = new Map();
    inSector.forEach(it => (it.sectores || []).forEach(s => {
      if (!detectedIds.has(s.id)) coSectors.set(s.name, (coSectors.get(s.name) || 0) + 1);
    }));
    const complementary = [...coSectors.entries()].sort((a, b) => b[1] - a[1]);
    const consortia = uniqueByNormalized(adjudicadosPais.filter(it => it.contratista && it.contratista.es_consorcio).map(winnerName).filter(Boolean));

    const connectionBuilders = {
      contratistas_ganadores: () => ({
        count: market.winners,
        examples: market.topWinners.map(w => w.name),
        insight: market.winners
          ? `${market.winners} empresas ganaron ${formatCopShort(market.winnersValue)} en contratos de tu sector en el país: son compradores con presupuesto aprobado hoy.`
          : 'Aún no hay adjudicaciones recientes en tu sector; te avisaremos cuando aparezcan ganadores.'
      }),
      entidades: () => ({
        count: market.entities,
        examples: market.topEntities.map(e => e.name),
        insight: market.entities
          ? `${market.entities} entidades públicas compran lo que ofreces en ${zone}; ${market.open} procesos siguen abiertos.`
          : `No vemos compras recientes en ${zone}; a nivel nacional hay ${market.nationalTotal} procesos de tu sector.`
      }),
      aliados_consorcio: () => ({
        count: consortia.length + (market.aboveTicket || 0),
        examples: consortia.slice(0, 3),
        insight: [
          market.aboveTicket ? `${market.aboveTicket} procesos superan tu ticket: con un aliado puedes presentarte.` : null,
          consortia.length ? `${consortia.length} ${consortia.length === 1 ? 'consorcio ya ganó' : 'consorcios ya ganaron'} en tu sector: modelos de alianza que puedes replicar.` : null
        ].filter(Boolean).join(' ') || 'Tu tamaño cubre la mayoría de procesos; un aliado te abre licitaciones más grandes.'
      }),
      proveedores_complementarios: () => ({
        count: complementary.length,
        examples: complementary.slice(0, 3).map(([name]) => name),
        insight: complementary.length
          ? `${Math.round((complementary[0][1] / Math.max(1, inSector.length)) * 100)}% de tus oportunidades también piden ${complementary[0][0]}: un aliado ahí te hace más competitivo.`
          : 'Tus oportunidades son muy especializadas en tu sector.'
      }),
      consultores: () => ({
        count: abiertas.length,
        examples: [],
        insight: `${abiertas.length} procesos abiertos o en borrador donde un estructurador puede mejorar tu probabilidad de ganar.`
      })
    };

    const connections = (profile.connections || [])
      .filter(id => connectionBuilders[id])
      .map(id => ({ id, label: CONNECTIONS[id], ...connectionBuilders[id]() }));

    // --- Recomendaciones según necesidades ---
    const menorCuantia = abiertas.filter(it => normalize(it.modalidad).includes('menor cuantia')).length;
    const needAdvice = {
      consorcio: (market.aboveTicket
        ? `${market.aboveTicket} procesos de tu sector superan tu ticket y se pueden abordar en consorcio.`
        : 'Un consorcio te permite sumar experiencia y capacidad financiera para licitaciones más grandes.') +
        ` Te conectaremos con empresas complementarias${complementary[0] ? ` de ${complementary[0][0]}` : ''}.`,
      experiencia: menorCuantia
        ? `Hay ${menorCuantia} procesos de menor cuantía abiertos: son la ruta más rápida para acumular experiencia habilitante.`
        : 'Participa como subcontratista o en consorcio con ganadores recientes para sumar experiencia certificable.',
      capital: `El contrato típico de tu mercado es de ${formatCopShort(market.typicalTicket || market.nationalValue / Math.max(1, market.nationalTotal))}. Planea un capital de trabajo del 20–30% o negocia anticipos con el contratista.`,
      polizas: `Los procesos de tu sector suelen exigir garantía de seriedad (~10%) y cumplimiento. Tener aseguradora pre-aprobada acelera tu respuesta.`,
      juridico: `${abiertas.length} procesos abiertos o en borrador: presentar observaciones a tiempo mejora las condiciones del pliego a tu favor.`,
      proveedores: `Tus oportunidades piden también ${joinHuman(complementary.slice(0, 2).map(([n]) => n)) || 'insumos especializados'}: prioriza proveedores con cobertura en ${zone}.`,
      clientes: market.winners
        ? `${market.winners} contratistas ganadores en tu sector (${formatCopShort(market.winnersValue)}) son clientes potenciales inmediatos.`
        : 'Aún no hay ganadores recientes en tu sector; las licitaciones abiertas son tu mejor canal hoy.',
      visibilidad: `${market.entities} entidades compran en tu sector. Un perfil completo te permite aparecer en búsquedas de aliados.`
    };
    const recommendations = (profile.needs || [])
      .filter(id => needAdvice[id])
      .map(id => ({ id, label: NEEDS[id], advice: needAdvice[id] }));

    // --- Palabras clave para alertas ---
    const materialCounts = new Map();
    inZone.forEach(it => (it.materiales_detectados || []).forEach(m => materialCounts.set(m, (materialCounts.get(m) || 0) + 1)));
    const alertKeywords = uniqueByNormalized([
      ...detected.flatMap(d => d.keywords),
      ...[...materialCounts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
    ]).slice(0, 8);

    const matches = data
      .map(it => ({ item: it, ...matchOpportunity(profile, it, detected, now) }))
      .filter(m => m.score >= 55)
      .sort((a, b) => b.score - a.score);

    return {
      role,
      detected,
      market,
      valueProp,
      elevatorPitch,
      idealClient,
      connections,
      recommendations,
      alertKeywords,
      strength: profileStrength(profile, detected),
      matchCount: matches.length,
      topMatches: matches.slice(0, 3)
    };
  }

  const api = {
    ROLES,
    NEEDS,
    CONNECTIONS,
    TICKETS,
    normalize,
    stageOf,
    bidWindow,
    isActionable,
    formatTerm,
    offerCatalog,
    detectSectors,
    matchOpportunity,
    analyzeProfile,
    formatCopShort
  };

  root.ProfileEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
