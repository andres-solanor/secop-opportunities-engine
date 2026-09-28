# CLAUDE.md

Guía para Claude Code en este repositorio. **Antes de continuar trabajo en curso, lee `docs/HANDOFF.md`**: tiene el estado actual, decisiones tomadas y el backlog priorizado. Para el razonamiento de diseño del sistema de perfiles (recorrido, modelo de afinidad, estrategia de desbloqueo, alternativas descartadas y preguntas abiertas), lee `docs/DISENO_PERFILES.md`.

## Qué es

Motor que descarga procesos de contratación pública colombiana (SECOP II, API Socrata de datos.gov.co), filtra ruido (OPS, montos bajos), los enriquece por sector y los publica en una web estática en GitHub Pages. La web conecta oportunidades con **perfiles de empresa** creados con cuenta de Google.

## Estructura

| Ruta | Rol |
|---|---|
| `src/services/socrata_client.py` | Cliente HTTP de la API SODA (solo biblioteca estándar). |
| `src/filters/noise_filter.py` | Descarta OPS, prestación de servicios y montos < umbral. |
| `src/enrichers/scope_extractor.py` | `TAXONOMIES` (sectores y palabras clave), etapa comercial, score de calidad. **Fuente única del vocabulario de sectores.** |
| `src/export_prospects.py` | Pipeline: descarga → filtra → enriquece → exporta `data/*`, `web/data.js` y `web/taxonomy.js`. |
| `web/index.html` | Página única. Orden de scripts importa: `config → data → taxonomy → profile-engine → auth → app → profile`. |
| `web/app.js` | Tablero: pestañas (Para Ti, Radar B2B, Observatorio, CRM), filtros, KPIs, tarjetas, pitch, CSV. |
| `web/profile-engine.js` | Motor **puro, sin DOM**: `detectSectors`, `analyzeProfile`, `matchOpportunity`. Exporta a `window.ProfileEngine` y CommonJS. |
| `web/profile.js` | UI de perfiles: onboarding de 4 pasos, vista "Perfil de Oportunidades", banner, menú de cuenta. Expone `window.SecopProfile`. |
| `web/auth.js` | Google Identity Services. Expone `window.SecopAuth`. Modo demo si no hay `GOOGLE_CLIENT_ID`. |
| `web/config.js` | `window.APP_CONFIG.GOOGLE_CLIENT_ID` (público, no es secreto). |
| `web/data.js`, `web/taxonomy.js`, `data/*` | **Generados** por el pipeline. No editar a mano. |
| `.github/workflows/daily_secop_refresh.yml` | Cron diario 11:00 UTC: corre el pipeline y hace commit de datos. `ci/` guarda una copia de plantilla; mantener ambas iguales. |

## Comandos

```bash
python -m unittest discover tests        # pruebas Python
node --test tests/                       # pruebas del motor de perfiles (Node 18+)
python -m src.export_prospects           # refrescar datos (requiere red a datos.gov.co)
python -m http.server 8000 --directory web   # servir la web en http://localhost:8000
```

Para regenerar solo la taxonomía web sin descargar datos:
`python -c "from src.export_prospects import export_taxonomy; export_taxonomy('web')"`

## Convenciones

- **Python:** solo biblioteca estándar, sin dependencias externas.
- **Frontend:** JavaScript vanilla, sin build ni frameworks, sin dependencias npm en producción. Cada archivo es un IIFE que expone un objeto en `window`.
- **Idioma:** textos de UI, comentarios y documentación en español; identificadores en inglés o español según el archivo existente.
- **Seguridad de HTML:** todo dato dinámico que va a `innerHTML` pasa por `escapeHtml` (app.js) o `esc` (profile.js).
- **Cache busting:** al cambiar un JS/CSS, actualiza el sufijo `?v=AAAAMMDD_NN` en `web/index.html`.
- **Taxonomía:** si cambias sectores o palabras clave, edita `ScopeExtractor.TAXONOMIES` y regenera `web/taxonomy.js`; nunca dupliques listas en JS.
- La lógica de puntaje y análisis va en `profile-engine.js` (testeable con Node); la manipulación del DOM va en `profile.js`/`app.js`.

## Almacenamiento en el navegador (`localStorage`)

| Clave | Contenido |
|---|---|
| `secop_session` | Usuario actual (claims del ID token de Google, o `demo:local`). |
| `secop_profiles` | Mapa `{ userId: perfil }` de perfiles guardados. |
| `secop_profile_draft` | Perfil de visitante sin cuenta; se adopta al iniciar sesión. |
| `secop_crm_state` | Estado del CRM `{ oppId: { status, updatedAt } }` (global, no por usuario). |

## Pruebas manuales en el navegador

En Claude Code web, Chromium está en `/opt/pw-browsers/chromium`; lanza Playwright con `executablePath` apuntando ahí (no ejecutes `playwright install`). Las fuentes de Google fallan por el proxy del sandbox: es esperado.
