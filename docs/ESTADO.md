# Estado de trabajo (relevo entre agentes)

Documento compartido por **Claude Code** y **Antigravity**. Cada sesión termina agregando un bloque al final. El bloque más reciente es el que manda; los anteriores quedan como historial.

Plan vigente: profesionalización del prototipo (base de ingeniería, calidad de datos, más sectores y grupo "sin clasificar"). Fases:

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Worktree `oportunities-engine-pro`, rama `pro/foundation` desde `origin/main` | Hecha |
| 1 | `AGENTS.md` compartido, `CLAUDE.md` que lo importa, este documento | Hecha |
| 2 | Herramientas y CI: `pyproject.toml` (ruff), `package.json` (ESLint, Prettier, Playwright), `ci.yml`, pruebas antes del commit diario | Hecha, salvo Prettier (no está en `package.json`) |
| 3 | Contrato de datos (`src/schema.py`), fallas de descarga visibles, paginación y reintentos, precios ajustados marcados, `--out`, renombrar `prospects_prototype_50.*` | Hecha |
| 4 | Calidad de datos: valores reales de modalidad y estado, términos de exclusión, duplicados, adjudicados recientes | Hecha en parte: falta separar PAE de HORECA y revisar "vigas" |
| 4b | Taxonomía en `config/taxonomy.json`, consultas generadas, descarga sin sector, grupo "sin clasificar" oculto por defecto, reporte de descubrimiento para elegir sectores nuevos | Hecha la base; **los sectores nuevos ya están decididos y faltan por implementar** (ver el bloque de abajo) |
| 5 | Frontend: `web/dashboard-engine.js` con pruebas, sin estilos en línea, accesibilidad de modales, pruebas de humo con Playwright | Hecha en parte: quedan `style=` en `web/profile.js` (9) y `web/index.html` (1) |
| 6 | README y documentación | Hecha |

## Formato del bloque

```markdown
## Estado de la sesión — AAAA-MM-DD · <agente> · rama `<rama>`

- **Terminado y con commit:** qué, con SHA.
- **En curso:** qué y exactamente dónde quedó.
- **Sin commit:** qué y por qué.
- **Errores abiertos conocidos:**
- **Próximas tres acciones:**
```

## Estado de la sesión — 2026-09-30 · Claude Code · rama `pro/foundation`

Bloque reconstruido al inicio de la sesión siguiente: la sesión original se cortó por errores 529 del API antes de escribirlo. Fuentes: `git log`, la transcripción de la sesión y las verificaciones corridas al reconstruir.

- **Terminado y con commit** (9 commits locales sobre `origin/main` `ec67501`):
  - `0ee8ffc` `AGENTS.md` compartido y este documento.
  - `d1370b7` `pyproject.toml` con ruff, `.editorconfig`, reglas de `.gitignore`.
  - `4c6ec86` correcciones de ruff.
  - `11dc1b9` `ci.yml` para PR, pruebas antes del commit diario, prueba que compara `ci/` con `.github/workflows/`.
  - `fbff4d5` taxonomía en `config/taxonomy.json`, `src/harvest.py`, `src/curation.py`, `src/discovery.py`, `src/schema.py`, cliente Socrata con paginación, reintentos y `SOCRATA_APP_TOKEN`, `precio_ajustado`, `--out`, archivos renombrados a `data/prospects.*`.
  - `edc1d42` `web/dashboard-engine.js` con pruebas, filtro de sector desde la taxonomía, vista "Fuera del tablero", modales con `role="dialog"` y `aria-modal`.
  - `d8c8572` ESLint y prueba de humo de Playwright (`tests/e2e/smoke.spec.js`), conectadas a CI.
  - `c43a4a0` reporte de descubrimiento: agrupa por tipo de contrato lo que llega sin código UNSPSC.
  - `6f87598` README, `AGENTS.md`, `PLAN_ITERACIONES.md` y `docs/DESCUBRIMIENTO_SECTORES_2026-09-30.md`.
- **Verificado al reconstruir (2026-09-30):** `ruff check .` sin hallazgos; `python -m unittest discover tests` 88 pruebas OK; `npm test` 29 de 29; `npm run lint` sin salida de errores. `npm run test:e2e` **no** se volvió a correr.
- **En curso:** cambios de taxonomía ya decididos por el dueño y **sin empezar** (ningún archivo tocado):
  1. **PAE como sector propio** "Alimentación escolar (PAE)": sacar `pae` y `alimentación escolar` de las keywords de `horeca_industrial` y el patrón `ALIMENTACI%ESCOLAR` de su `harvest.titulo`. HORECA queda solo para equipos de cocina.
  2. **Obra civil más amplia**: más keywords para `obra_civil_general` (mejoramiento, mantenimiento, adecuación, alcantarillado, malla vial).
  3. Sectores nuevos: **Interventoría y consultoría**, **Tecnología**, **Agua y saneamiento**.
  4. Pedido textual del dueño: "Explore the rest and see if there are any sectors left out (or just group them under "Other" category or something like that)". Es decir, revisar el resto de "sin clasificar" y proponer sectores faltantes o un grupo "Otros".
- **Sin commit:** nada. El árbol de trabajo estaba limpio al reconstruir. La última corrida del pipeline se hizo con `--out` a una carpeta temporal de la sesión anterior; `data/*` y `web/data.js` de la rama **no** se regeneraron con el pipeline nuevo.
- **Sin publicar:** `pro/foundation` no tiene rama remota. El plan aprobado dice que el push y el PR esperan el visto bueno del dueño.
- **Errores abiertos conocidos:**
  - Contratos de operación del PAE aparecen etiquetados como HORECA hasta que se haga el punto 1.
  - La keyword `vigas` de Acero sigue sin revisar (`PLAN_ITERACIONES.md`, iteración 8).
  - El tablero sigue con tope de 150 registros; subirlo a 400–600 está pendiente (misma tabla).
  - Prettier figuraba en el plan y no se instaló.
  - Quedan `style=` en línea en `web/profile.js` (9) y `web/index.html` (1).
  - Archivo de reglas para Antigravity que apunte a `AGENTS.md`: `[POR VERIFICAR]` si se creó.
- **Próximas tres acciones:**
  1. Editar `config/taxonomy.json` con los puntos 1 a 3, con una prueba por sector en `tests/test_harvest_curation.py`; regenerar `web/taxonomy.js` con el pipeline, no a mano.
  2. Correr `python -m src.export_prospects --out <carpeta temporal>` y leer el embudo y `hidden_summary.md` para resolver el punto 4 con cifras calculadas; mostrarle al dueño la propuesta de "Otros" antes de aplicarla.
  3. Correr `npm run test:e2e`, abrir el tablero con los datos nuevos y confirmar que muestra registros reales en cada sector; después pedir el visto bueno para el push y el PR.
