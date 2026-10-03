# AGENTS.md

Guía única para los agentes que trabajan en este repositorio (**Claude Code** y **Google Antigravity**). `CLAUDE.md` importa este archivo; Antigravity lo lee de forma nativa desde la raíz. Si cambias una regla, cámbiala aquí y en ningún otro lado.

**Antes de continuar trabajo en curso, lee `docs/ESTADO.md`** (estado de la última sesión de cualquiera de los dos agentes) y luego `docs/HANDOFF.md` (decisiones tomadas y backlog priorizado). Para el razonamiento de diseño del sistema de perfiles (recorrido, modelo de afinidad, estrategia de desbloqueo, alternativas descartadas y preguntas abiertas), lee `docs/DISENO_PERFILES.md`. Para las fichas de oportunidad (fechas, qué mostrar y cruces con otras fuentes), lee `docs/PROPUESTA_FICHAS.md`. Para las funciones de pago bajo demanda (monedero de créditos IA, análisis de anexos, perfil con skills, fuentes adicionales verificadas), lee `docs/CREDITOS_IA.md`. Para las fuentes públicas que el motor aún no usa y la evaluación de Croma, lee `docs/FUENTES_ADICIONALES.md`. La hoja de ruta está en `docs/PLAN_ITERACIONES.md` y el guion de la demo en `docs/GUION_DEMO.md`.

## Qué es

Motor que descarga procesos de contratación pública colombiana (SECOP II, API Socrata de datos.gov.co), filtra ruido (OPS, montos bajos), los enriquece por sector y los publica en una web estática en GitHub Pages. La web conecta oportunidades con **perfiles de empresa** creados con cuenta de Google.

## Trabajo en pareja: Claude y Antigravity

- **Un agente por carpeta.** Hay dos worktrees del mismo repositorio:

  | Carpeta | Agente | Rama |
  |---|---|---|
  | `Antigravity/Oportunities Engine` | Antigravity | `main` (u otra rama propia) |
  | `Antigravity/oportunities-engine-pro` | Claude Code | `pro/*` |

  Ningún agente edita archivos en la carpeta del otro ni cambia de rama en ella.
- **Actualiza antes de empezar.** `git fetch origin` y revisa si tu rama está detrás. `main` puede recibir trabajo de sesiones de Claude en la nube. Desde el 2026-10-01 el bot de datos ya no hace commits: publica en GitHub Pages.
- **Nunca `git stash` / `git stash pop` a secas.** Los worktrees comparten una sola pila de stash y el otro agente puede sacar tu entrada. Usa un commit temporal `WIP:`.
- **No edites a mano los archivos generados** (`web/data.js`, `web/taxonomy.js`, `data/*`). Tampoco se hace commit de datos regenerados (`web/data.js`, `web/hidden.js`, `data/*`). Los del repositorio son una foto fija para pruebas y desarrollo local; los vigentes viven en el sitio publicado, que actualiza el workflow diario. `web/taxonomy.js` sí se versiona, porque cambia con `config/taxonomy.json`.
- **Relevo por documento, no por memoria.** Al terminar una sesión, agrega un bloque `## Estado de la sesión` al final de `docs/ESTADO.md` (formato en ese archivo). Debe bastar para que el otro agente retome con solo leerlo.
- **Una corrección, una prueba, un commit.** Corre las dos suites antes de dar algo por terminado.
- **Subir cambios (`git push`) y abrir PR lo decide el dueño**, salvo la autorización permanente de Claude Code que está en `CLAUDE.md`. Los cambios en `.github/workflows/` requieren un token con alcance `workflow`.
- **Un PR por entregable**, en una rama corta que se fusiona apenas pasa el CI. Los arreglos pequeños que se publicarían o revertirían juntos van en una sola rama, con un commit por arreglo.

## Integridad de datos

- No escribas un dato (conteos, fechas, valores, nombres de entidades) que no salga de un archivo o comando leído en la sesión. Si falta, escribe `[POR VERIFICAR]`.
- Las cifras de reportes y documentos las calcula el código; no se teclean a mano.
- Para comprobar comportamiento contra datos.gov.co usa solo consultas de lectura.

## Estructura

| Ruta | Rol |
|---|---|
| `config/taxonomy.json` | **Fuente única del vocabulario de sectores:** grupos (familias del filtro de la web), y por sector: grupo, palabras clave, exclusiones, prefijos UNSPSC, tipos de contrato que clasifican (`tipos_contrato`) o excluyen (`excluir_tipos_contrato`), a quién le compra el ganador (`compra_a`) y con qué códigos UNSPSC vende un proveedor del sector (`vende_unspsc`, solo códigos con nombre público), peso y lo que se le pide a SECOP II (`harvest`). La carga `src/taxonomy.py`. Subir `version` al cambiar sectores: el pipeline no marca como "nuevas" las que solo entran por la reclasificación. |
| `src/services/socrata_client.py` | Cliente HTTP de la API SODA (solo biblioteca estándar): reintentos, paginación (`query_all`) y token opcional `SOCRATA_APP_TOKEN`. |
| `src/harvest.py` | Descarga: una consulta por sector (obligatorias: si falla una, la corrida se detiene) y dos generales (publicados y adjudicados de los últimos 14 días). Reporta el estado de cada consulta. Además mide en el servidor, sin descargar, el universo publicado (`universe_summary`) y qué parte trae código UNSPSC por semana (`unspsc_coverage`, en `meta.cobertura_unspsc`). |
| `src/filters/noise_filter.py` | Descarta OPS, prestación de servicios y montos < umbral. `reason_group` agrupa los motivos de rechazo. `is_agreement` detecta convenios con entidades sin ánimo de lucro (Decreto 092, "aunar esfuerzos"): no se rechazan, se marcan (`convenio`). |
| `src/curation.py` | Embudo: duplicados por portafolio, rechazados, sin clasificar, clasificados; selección del tablero (`select_curated`: 500, con un mínimo de 20 por sector y cupo de adjudicados) y lista "fuera del tablero" (motivos `sin_sector`, `fuera_de_corte`, `convenio`). Los convenios abiertos no van al tablero; los adjudicados sí. `check_funnel` exige que todo sume. |
| `src/discovery.py` | Reporte `data/hidden_summary.md`: lo sin clasificar por familia UNSPSC, tipo de contrato y frases frecuentes, para decidir sectores nuevos. |
| `src/schema.py` | Contrato de datos entre Python y la web. Se valida antes de escribir cualquier archivo. |
| `src/enrichers/scope_extractor.py` | Clasifica por sector con la taxonomía (`ScopeExtractor.TAXONOMIES`), etapa comercial, score de calidad, precio (con `precio_ajustado` si se corrigió). |
| `src/enrichers/contract_enricher.py` | Cruce con SECOP II Contratos (`jbjy-vk9h`): `contrato`, `historial_contratista`, `entidad_stats`. Promueve a adjudicados los procesos con contrato firmado. **Nunca** copia documentos, datos bancarios ni género. |
| `src/enrichers/open_sources.py` | Fuentes abiertas gratuitas: ofertas por proceso (`wi7w-2nvm`), integrantes de consorcios (`ceth-n4bn`), sanciones SECOP I (`4n4q-k399`) y compras planeadas del PAA (`9sue-ezhx`, publicado como `window.PAA_DATA`). Perfil del proponente (`meta.perfil_proponente`):
  - una consulta agregada a `jbjy-vk9h` con los contratos y el valor por modalidad, ganados por persona natural o por empresa;
  - por cada modalidad, los 10 contratistas que más ganan (`top`: nombre, contratos, valor y si es persona natural; nunca el documento).

  La web calcula el porcentaje, el umbral del badge (`DashboardEngine.PERSONA_NATURAL_MIN_PCT`) y "quién gana" (`modalityWinners`). **Nunca** copia teléfonos, correos ni documentos de personas. |
| `src/sync_status.py` | Estado de la sincronización: nuevas (nunca vistas, registro en `data/seen_ids.json`), salidas, nuevas adjudicadas, estado del cruce e historial (`data/sync_history.json`). Se publica como `window.PROSPECTS_META`. |
| `src/tools/probe_sources.py` | Diagnóstico de solo lectura de datasets de datos.gov.co; también se puede correr con el workflow manual "Probe SECOP sources". Con `--valores` lista los valores reales de modalidad, estado, tipo y fase. |
| `src/tools/stamp_assets.py` | Sella en `web/index.html` la versión (`?v=`) de cada JS y CSS según su contenido. |
| `src/tools/unspsc_catalog.py` | Catálogo UNSPSC en español (manual, no corre a diario). `descargar` trae, solo de lectura, los nombres que el Estado publica en datos abiertos (CC BY-SA 4.0). `construir` cruza el clasificador de Colombia Compra Eficiente (archivo del dueño, fuera del repositorio) con esos nombres. Deja una base SQLite con una bandera por código (`publicado_igual`, `publicado_distinto`, `no_publicado`) en `local/` (en .gitignore, porque contiene la traducción de CCE, que no puede explotarse comercialmente), y exporta solo los nombres públicos a `config/unspsc_publico.json`. **Nunca** se versiona ni se publica un nombre que solo esté en la traducción de CCE. |
| `src/services/croma_client.py` | Cliente de Croma (`https://api.croma.run`), portado de la hackatón `andres-solanor/croma-hackaton`. Solo biblioteca estándar. Tiene:<ul><li>caché SQLite propia en `local/croma.db`, porque los aciertos de la caché de Croma también cobran;</li><li>registro de cada petición;</li><li>presupuesto diario leído del registro (`CROMA_DAILY_BUDGET`, 60 por defecto, de 100 por organización);</li><li>manejo de 429 con `Retry-After`;</li><li>cortacircuitos tras 3 errores 5xx;</li><li>sondeo de trabajos 202, sin guardar en caché uno sin resolver.</li></ul>La llave (`CROMA_API_KEY`) nunca va al repositorio ni al navegador. |
| `src/services/croma_endpoints.py` | Un adaptador por endpoint de Croma: RUES por NIT, sanciones SECOP, Procuraduría, Contraloría y Contaduría. Valida el documento antes de gastar cuota y lee los campos reales, no los documentados. Policía no se consulta (dato sensible, Ley 1581). |
| `src/dossier.py` | Señales puras, sin red, del dossier por NIT. Usa los tonos de los badges. Cada señal lleva fuente, fecha y contra-explicación. Lo no consultado queda "sin revisar", nunca "limpio". El documento de una persona solo aparece enmascarado. |
| `src/tools/croma_dossier.py` | Dossier por NIT. Es manual, no corre a diario y no publica nada. Deja el resultado en `local/dossiers/` y lo imprime. Cuesta 2 peticiones por empresa y 3 por representante legal; `--sin-red` lee solo la caché y `--cuota` muestra el gasto. **Nunca** se publica lo de Croma en el sitio: sus términos prohíben redistribuir. |
| `config/unspsc_publico.json` | 3128 nombres UNSPSC (familias y clases) tomados de datos abiertos del Estado, con atribución y licencia CC BY-SA 4.0. Lo genera `unspsc_catalog.py construir`; no se edita a mano. |
| `src/export_prospects.py` | Pipeline: descarga → curaduría → cruces → valida → exporta `data/*`, `web/data.js`, `web/hidden.js` y `web/taxonomy.js`. Con `--out DIR` escribe fuera del repositorio. |
| `web/index.html` | Página única. Orden de scripts importa: `theme.js` va en el `<head>`, antes de `style.css`; al final del `<body>`, `config → data → taxonomy → profile-engine → dashboard-engine → secop-live → auth → app → profile`. |
| `web/theme.js` | Tema: sistema, claro, oscuro o Matrix. Pone `data-theme` en `<html>` antes del primer pintado y llena el selector `#themeSelect`. Los colores son tokens de `:root` en `style.css` (uno por tema); fuera de ellos solo el botón de Google lleva colores literales. Lógica pura (`normalize`, `resolve`) también en CommonJS. |
| `web/dashboard-engine.js` | Motor **puro, sin DOM** del tablero: pestañas, filtros, KPIs, CSV, lista "fuera del tablero" y seguimiento de lo guardado en el CRM (`follow*`: foto de los campos de `FOLLOW_FIELDS`, qué cambió desde la última revisión y lo que cierra en `FOLLOW_CLOSING_DAYS` días o menos). Exporta a `window.DashboardEngine` y CommonJS. |
| `web/secop-live.js` | Consultas **en vivo, solo de lectura** a datos.gov.co desde el navegador (CORS abierto): contrato, ofertas y cifras de la entidad para el detalle de lo que no está en el tablero (fuera del tablero y PAA). También, en cualquier detalle, a quién le contrata la entidad en la modalidad del proceso (`entityWinners`), con los mismos filtros que `meta.perfil_proponente`. Devuelve las mismas formas que el pipeline; caché por sesión; tiempo límite de 15 s. Sin DOM: `window.SecopLive` y CommonJS. Las pruebas de humo simulan datos.gov.co con `page.route`: nunca consultan el servicio real. |
| `web/app.js` | Tablero: pestañas (Para Ti, Radar B2B, Observatorio, PAA, CRM y "Fuera del tablero", oculta por defecto), tarjetas, pitch, detalle. El filtro de sector va agrupado por familia (`SECTOR_GROUPS`), con conteo por pestaña y, al final, "Otros" (sin sector y seguros), que se carga de `hidden.js`. Lee los controles y pinta; la lógica va en los motores. |
| `web/profile-engine.js` | Motor **puro, sin DOM**: `detectSectors`, `analyzeProfile`, `matchOpportunity`, `bidWindow` (estado real: abierta, borrador, cerrada o adjudicado), `cardBadges` y `BADGES`/`TONES` (convención de badges), `nextStep`. Exporta a `window.ProfileEngine` y CommonJS. |
| `web/profile.js` | UI de perfiles: onboarding de 4 pasos, vista "Perfil de Oportunidades", banner, menú de cuenta. Expone `window.SecopProfile`. |
| `web/auth.js` | Google Identity Services. Expone `window.SecopAuth`. Modo demo si no hay `GOOGLE_CLIENT_ID`. |
| `web/config.js` | `window.APP_CONFIG.GOOGLE_CLIENT_ID` (público, no es secreto). |
| `web/unspsc.js` | Generado por `export_taxonomy` desde `config/unspsc_publico.json` (`window.UNSPSC_NAMES`: atribución y nombres de familias y clases). Se versiona como `taxonomy.js`. Lo usa el detalle: el código UNSPSC del proceso (o, si SECOP II no lo publicó, el del contrato firmado, en vivo con `SecopLive.contractCode`) y, en "Qué puede necesitar el ganador", los códigos con los que vende cada sector proveedor (`vende_unspsc` en la taxonomía, `ProfileEngine.supplierCodes`). Todo nombre mostrado lleva la atribución CC BY-SA 4.0. |
| `web/data.js`, `web/hidden.js`, `web/taxonomy.js`, `data/*` | **Generados** por el pipeline. No editar a mano. `data.js` va en JSON compacto y trae `window.ENTITY_STATS` (una entrada por NIT de entidad con las cifras que leen los badges); las fichas livianas y el PAA lo cruzan por `nit_entidad`. En `hidden.js`, solo los adjudicados llevan `fecha_adjudicacion` y `contratista`. `data/seen_ids.json` y `data/sync_history.json` persisten entre corridas: no borrarlos. `data/paa.json` y `data/perfil_proponente.json` se reutilizan si su fuente falla. |
| `.github/workflows/daily_secop_refresh.yml` | Publica el sitio en GitHub Pages desde un artefacto (fuente de Pages: "GitHub Actions"). El cron diario de las 11:00 UTC y el disparo manual corren las pruebas, descargan del sitio publicado el estado anterior (`DATA_FILES`), corren el pipeline y publican. Un push a `main` publica el código nuevo con los datos ya publicados, sin consultar SECOP. Si la descarga del estado falla, no publica: queda lo de ayer. No hace commits. Si un cambio de código necesita datos regenerados, dispara el workflow a mano después de fusionar. |
| `.github/workflows/ci.yml` | En cada pull request y push a `main`: ruff, pruebas Python (3.11 y 3.14), ESLint, pruebas Node y pruebas de humo con Playwright. |
| `ci/` | Copia de plantilla de los workflows (para tokens sin alcance `workflow`). Una prueba falla si difiere de `.github/workflows/`. |

## Comandos

```bash
ruff check .                             # lint Python (pip install ruff)
python -m unittest discover tests        # pruebas Python
npm ci                                   # herramientas de desarrollo JS (una vez)
npm run lint                             # ESLint
npm test                                 # pruebas de los motores JS (Node 22+)
npm run test:e2e                         # pruebas de humo en Chromium (npx playwright install chromium, una vez)
python -m src.export_prospects --out out # corrida real de prueba sin tocar data/ ni web/
python -m src.export_prospects           # regenerar los datos locales (no se hace commit; el workflow diario publica en Pages)
python -m src.tools.probe_sources --valores  # valores reales de las columnas que usan los filtros
python -m src.tools.stamp_assets         # sellar versiones de JS/CSS tras cambiarlos
python -m http.server 8000 --directory web   # servir la web en http://localhost:8000
```

**Antes de dar un cambio por terminado** corre las cinco verificaciones (ruff, pruebas Python, ESLint, pruebas Node y pruebas de humo). Si tocaste el pipeline, además una corrida real con `--out`.

Para regenerar solo la taxonomía web sin descargar datos:
`python -c "from src.export_prospects import export_taxonomy; export_taxonomy('web')"`

## Convenciones

- **Python:** solo biblioteca estándar en producción, sin dependencias externas.
- **Frontend:** JavaScript vanilla, sin build ni frameworks, sin dependencias npm en producción. Cada archivo es un IIFE que expone un objeto en `window`.
- **Idioma:** textos de UI, comentarios y documentación en español (Colombia); identificadores en inglés o español según el archivo existente.
- **Seguridad de HTML:** todo dato dinámico que va a `innerHTML` pasa por `escapeHtml` (app.js) o `esc` (profile.js).
- **Cache busting:** al cambiar un JS/CSS de `web/`, corre `python -m src.tools.stamp_assets`. Una prueba falla si `web/index.html` queda con versiones viejas.
- **Taxonomía:** los sectores se editan en `config/taxonomy.json` (con su prueba) y `web/taxonomy.js` se regenera; nunca dupliques listas en JS ni en HTML. El filtro de sector de la web se arma solo. Antes de dar por bueno un sector, lee una muestra de 20 procesos clasificados: las palabras sueltas ("eventos", "muebles", "vehículo") traen falsos positivos, y cada uno que aparezca se excluye con `excluir_si` y una prueba.
- **Prefijos UNSPSC de dos dígitos** (segmentos: salud `42`/`51`, alimentos `50`) sirven para clasificar, pero el PAA no los usa en la consulta (`PAA_MIN_PREFIX`): la búsqueda por texto coincidiría con casi cualquier código.
- **Filtros contra SECOP II:** SoQL compara por igualdad exacta y un valor inexistente devuelve cero filas sin error. Antes de escribir un filtro por modalidad, estado o tipo, confirma los valores con `probe_sources --valores`. El código UNSPSC llega como `V1.72141000` o `UNSPECIFIED`: usa `normalize_unspsc`.
- **Nada desaparece sin contarse:** si agregas un paso que descarta procesos, súmalo al embudo de `src/curation.py`.
- La lógica va en los motores sin DOM (`profile-engine.js`, `dashboard-engine.js`, testeables con Node); la manipulación del DOM va en `profile.js`/`app.js`.
- **Sin estilos en línea** en el HTML que genera `app.js`: usa clases de `style.css`.
- **Badges:** el tono es el significado (`risk`, `warn`, `good`, `info`). Un badge nuevo se agrega en `BADGES` (con `tip`) y en `cardBadges`; la guía de la UI se genera sola.
- **`app.js`:** declara las constantes que usan las fichas al inicio del callback, antes del primer `renderView()`; si no, hay un error de "temporal dead zone" y la página queda sin fichas.
- **Recomendaciones comerciales:** deben ser realistas para una empresa pequeña; si una recomendación supone capacidad disponible, di de dónde sale.
- **Documentación comercial y propuestas externas:** Toda documentación nueva generada para clientes, presentaciones, propuestas comerciales, memorandos estratégicos, pitches o formatos de exportación (archivos `.html`, `.pdf` o documentos en `docs/comercial/`, `docs/propuestas/` o similares) **debe ignorarse en `.gitignore` y nunca subirse al repositorio**. Solo se versiona la documentación técnica y de relevo del motor (`docs/ESTADO.md`, `docs/HANDOFF.md`, etc.).

## Almacenamiento en el navegador (`localStorage`)

| Clave | Contenido |
|---|---|
| `secop_session` | Usuario actual (claims del ID token de Google, o `demo:local`). |
| `secop_profiles` | Mapa `{ userId: perfil }` de perfiles guardados. |
| `secop_profile_draft` | Perfil de visitante sin cuenta; se adopta al iniciar sesión. |
| `secop_client_book` | Empresas cliente por usuario `{ userId: { active, clients: [perfil + id] } }` (`ProfileEngine.clientBook`). `active` es `propia` (el perfil de `secop_profiles`) o el id de una empresa cliente; el perfil activo define "Para Ti", la afinidad y la lista corta. |
| `secop_crm_state` | Estado del CRM `{ oppId: { status, updatedAt, snap, seenAt } }` (global, no por usuario). Guardar es seguir: `snap` es la foto de los campos seguidos en la última revisión (`DashboardEngine.followSnapshot`) y `seenAt`, cuándo se marcó "Visto". Lo guardado antes del seguimiento recibe la foto al abrir el tablero. |
| `secop_show_hidden` | `'1'` si el usuario activó la pestaña "Fuera del tablero". |
| `secop_detail_expanded` | `'1'` si el usuario dejó el detalle en pantalla completa (solo aplica en escritorio, desde 900 px). |
| `secop_theme` | Tema elegido: `system` (por defecto), `light`, `dark` o `matrix`. Un valor inválido vuelve a `system`. |
