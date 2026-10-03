# Estado de trabajo (relevo entre agentes)

Documento compartido por **Claude Code** y **Antigravity**. Cada sesión termina agregando un bloque al final. El bloque más reciente es el que manda; los anteriores quedan como historial.

Plan vigente: profesionalización del prototipo (base de ingeniería, calidad de datos, más sectores y grupo "sin clasificar"). Fases:

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Worktree `oportunities-engine-pro`, rama `pro/foundation` desde `origin/main` | Hecha |
| 1 | `AGENTS.md` compartido, `CLAUDE.md` que lo importa, este documento | Hecha |
| 2 | Herramientas y CI: `pyproject.toml` (ruff), `package.json` (ESLint, Prettier, Playwright), `ci.yml`, pruebas antes del commit diario | Hecha, salvo Prettier (no está en `package.json`) |
| 3 | Contrato de datos (`src/schema.py`), fallas de descarga visibles, paginación y reintentos, precios ajustados marcados, `--out`, renombrar `prospects_prototype_50.*` | Hecha |
| 4 | Calidad de datos: valores reales de modalidad y estado, términos de exclusión, duplicados, adjudicados recientes | Hecha, salvo revisar "vigas" |
| 4b | Taxonomía en `config/taxonomy.json`, consultas generadas, descarga sin sector, grupo "sin clasificar" oculto por defecto, reporte de descubrimiento para elegir sectores nuevos | Hecha: 12 sectores en 3 familias, "Otros", convenios marcados, tablero de 500 |
| 5 | Frontend: `web/dashboard-engine.js` con pruebas, sin estilos en línea, accesibilidad de modales, pruebas de humo con Playwright | Hecha: filtro de sector agrupado con conteos; quedan 2 `style=` con valores de datos (ancho de barra, ángulo), a propósito |
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

## Estado de la sesión — 2026-09-30 (tarde) · Claude Code · rama `pro/foundation`

Plan de la sesión: `C:\Users\abner\.claude\plans\plan-to-do-the-mighty-peacock.md` (aprobado por el dueño).

- **Decisiones del dueño en esta sesión:**
  - Filtro de sector: un solo desplegable nativo, agrupado por familia, con conteo.
  - "Otros" (lo sin sector) va como opción del filtro, no como sector.
  - Tablero de unos 500 con mínimo por sector.
  - Sectores extra: Salud, Vehículos y maquinaria, Dotación y mobiliario, Eventos/logística/víveres.
  - Convenios con ESAL: marcarlos; los adjudicados quedan en el Radar y los abiertos salen del tablero.
  - Seguros: en "Otros", identificados.
- **Terminado y con commit:**
  - `c443671` bloque de estado reconstruido de la sesión anterior.
  - `0ec69fe` grupos de sectores y regla por tipo de contrato (`tipos_contrato`).
  - `ebc11a8` PAE como sector; Obra civil ampliada; Agua, Tecnología, Interventoría.
  - `c2f9cf4` cuatro sectores más; `excluir_tipos_contrato` (interventoría solo en su sector, seguros en ninguno); falsos positivos corregidos tras leer 20 procesos por sector; tope de consultas por sector 3000.
  - `b6ac5a0` tablero de 500 con mínimo de 20 por sector; convenios marcados; lista oculta con 3 motivos y tope 1500; regla de "nueva" tras reclasificación; consulta del PAA sin prefijos de 2 dígitos.
  - `6c3a4e5` web: filtro agrupado con conteos, "Otros" (sin sector / seguros) desde `hidden.js`, badges "Convenio ESAL" y "Solo aseguradoras", tarjeta KPI con los 2 sectores de más valor, onboarding por familias plegables, estilos en línea estáticos a CSS.
- **Cifras medidas (una descarga de 8805 registros, misma data para antes y después):**
  - Clasificados: 1466 → 3693. Sin clasificar: 3878 → 1651.
  - HORECA tenía 431 procesos y 424 clasificaban solo por "pae"/"alimentación escolar" (372 + 29 + 23).
  - Corrida completa con `--out`: 500 en tablero, todos los sectores con 20 o más; `web/data.js` 2.241.702 B (antes 614.665 B); `web/hidden.js` 1.315.029 B; 449 s (la última meta del repo decía 173,6 s).
  - PAA solo, tras el arreglo: 80 compras en 146,7 s.
- **Verificado:**
  - ruff sin hallazgos; 116 pruebas Python; 36 pruebas Node; ESLint sin errores; 9 de 9 pruebas de humo, contra los datos del repo y contra un sitio de prueba con los datos de la corrida de 500.
  - En el navegador, el número de cada opción del filtro coincide con las fichas mostradas (12 de 12 casos: 4 sectores y las 2 opciones de "Otros", en Radar y Observatorio).
  - Sin errores de consola y sin desbordamiento horizontal en 390 px.
- **Sin commit:** los cambios de documentación de este cierre (`AGENTS.md`, `README.md`, `docs/PLAN_ITERACIONES.md`, `docs/DESCUBRIMIENTO_SECTORES_2026-09-30.md`, este archivo) van en el commit de cierre.
- **Datos no regenerados, a propósito:** `data/*` y `web/data.js` de la rama siguen siendo los de `origin/main` (150 registros, taxonomía vieja). `AGENTS.md` prohíbe hacer commit de datos regenerados en una rama de trabajo; los publica el workflow diario en `main`. Hasta que corra ese workflow, la web de la rama muestra los 4 sectores viejos en los datos, "Otros" sin datos (no hay `hidden.js`) y los grupos del filtro con conteos en 0 para los sectores nuevos.
- **Sin publicar:** `pro/foundation` no tiene rama remota; el push y el PR esperan al dueño.
- **Errores abiertos conocidos:**
  - La tarjeta "Sectores Clave" ocupa 2 líneas en 390 px (el plan pedía 1; los nombres de sector son largos).
  - `hidden.js` es una muestra (1500 de 4844); "Otros" lo dice en el contador.
  - En la corrida de prueba, la primera consulta del PAA se venció antes del arreglo de prefijos; después del arreglo no se ha visto en una corrida completa, solo aislada.
  - Pendientes que vienen de antes: revisar "vigas"; Prettier no instalado; archivo de reglas de Antigravity `[POR VERIFICAR]`.
  - La corrida diaria tardará más (449 s frente a 173,6 s) y los commits de datos pesarán unos 3,5 MB al día: ver "Peso del repositorio" en `docs/PLAN_ITERACIONES.md`.
- **Próximas tres acciones:**
  1. Pedir al dueño el visto bueno para `git push -u origin pro/foundation` y abrir el PR a `main`; el workflow de CI (`ci.yml`) correrá las cinco verificaciones.
  2. Después de fusionar, revisar la primera corrida diaria en `main`: que salga con código 0, que `meta.reclasificacion` sea true, que el PAA quede en estado ok y que cada sector tenga fichas en la web publicada.
  3. Decidir con el dueño si publicar GitHub Pages desde un artefacto del workflow (fila "Peso del repositorio"), antes de que se acumulen commits diarios de unos 3,5 MB.

## Estado de la sesión — 2026-09-30 (cierre) · Claude Code · rama `pro/foundation` → `main`

- **Terminado y publicado** (con el visto bueno del dueño):
  - Push de `pro/foundation` y PR #1 (https://github.com/andres-solanor/secop-opportunities-engine/pull/1). El CI pasó en GitHub: python 3.11, python 3.14, node y e2e.
  - Fusionado en `main` como `320621e` (commit de fusión; antes se integró el commit de datos diario de `main`, `e2300cc`).
  - Corrida manual del refresco diario (run 36778941162): código 0, 116 pruebas antes de publicar, commit de datos `c2f71cb` con `web/hidden.js`.
  - Meta publicada:
    - `generated_at` 2026-09-30T21:25:49Z, `duracion_s` 232,5, 500 curadas (216 adjudicadas), `nuevas` 0.
    - `reclasificacion` true, `taxonomia_version` 2, 80 compras planeadas, `fuentes_con_error` vacío.
  - GitHub Pages construido desde `c2f71cb`. Verificado en el navegador sobre la URL publicada (https://andres-solanor.github.io/secop-opportunities-engine/web/):
    - 12 de 12 casos en que el conteo del filtro coincide con las fichas.
    - "Otros" carga, desactivado en el PAA; 300 convenios visibles en "Fuera del tablero".
    - Sin errores de consola, sin desbordamiento en 390 px.
- **Sin commit:** nada, salvo este bloque, que va en un PR de documentación.
- **Estado de las carpetas:** `pro/foundation` está al día con `origin/main`. La carpeta de Antigravity (`Antigravity/Oportunities Engine`, rama `main`) está 59 commits detrás de `origin/main` y no se tocó: el dueño o Antigravity deben hacer `git pull` ahí antes de trabajar.
- **Errores abiertos conocidos:**
  - La tarjeta "Sectores Clave" ocupa 2 líneas en 390 px.
  - `hidden.js` es una muestra (1500 de 4844 procesos fuera del tablero); "Otros" lo dice en el contador.
  - Sector "Eventos, Logística & Víveres" pequeño (29 clasificados en la medición) tras quitar "eventos" suelto: revisar palabras clave con el reporte.
  - Agua y saneamiento no tuvo compras planeadas en el PAA de esta corrida (el PAA solo usa el prefijo `4710`).
  - Avisos de GitHub Actions en la corrida: acciones con Node.js 20 (`actions/checkout@v4`, `actions/setup-python@v5`) forzadas a Node 24, y `ubuntu-latest` pasa a Ubuntu 26 desde el 2026-10-19.
  - Vienen de antes: revisar "vigas"; Prettier no instalado; archivo de reglas de Antigravity `[POR VERIFICAR]`.
- **Pendientes para la próxima sesión (en orden):**
  1. **Peso del repositorio** (decidido dejarlo para la próxima sesión): cada commit de datos agrega unos 3,5 MB (`web/data.js` 2,24 MB y `web/hidden.js` 1,32 MB en la corrida de prueba). Propuesta: publicar GitHub Pages desde un artefacto del workflow y dejar de versionar los archivos generados. Ver `docs/PLAN_ITERACIONES.md`, iteración 8.
  2. Revisar la primera corrida programada (2026-10-01, 11:00 UTC): que salga con código 0, que `reclasificacion` ya no aparezca (la versión 2 quedó registrada) y que `nuevas` vuelva a contar lo publicado desde la corrida anterior.
  3. Actualizar las versiones de las acciones de GitHub antes del cambio de runner del 2026-10-19. Las versiones nuevas están `[POR VERIFICAR]` en la documentación de cada acción. Cambiar también la copia en `ci/`: una prueba compara ambas.
  4. Calidad de sectores: Eventos (pocas coincidencias), "vigas" en Acero, compras planeadas de Agua; cada ajuste con su prueba y una muestra de 20 procesos.
  5. Deuda menor: Prettier, archivo de reglas de Antigravity, tarjeta KPI en una línea.

## Estado de la sesión — 2026-10-01 · Claude Code · rama `pro/ux-filters`

Plan de la sesión: `C:\Users\abner\.claude\plans\let-s-review-whats-next-bubbly-dongarra.md`. El dueño pidió entregar rápido lo crítico y dejar lo demás en la hoja de ruta, que quedó como iteración 9 de `docs/PLAN_ITERACIONES.md`.

- **Terminado y con commit** (rama `pro/ux-filters`, creada desde `origin/main` `6462bdf`):
  - `eb3ee21` Corrección: el filtro de ruido rechazaba toda la mínima cuantía. SECOP II publica la modalidad como "Mínima cuantía" y la lista solo tenía "contratación mínima cuantía". Incluye su prueba en `tests/test_engine.py`.
  - `96e86ee` Dos filtros nuevos en la web:
    - Modalidad: `DashboardEngine.MODALITIES`, con conteo por pestaña.
    - Fecha del estado actual: adjudicación en el Radar, publicación en el Observatorio, mes esperado en el PAA. El texto cambia con la pestaña, el filtro se oculta en el CRM y el resultado dice cuántos quedan fuera por no tener fecha.
    - Con pruebas en Node y dos pruebas de humo nuevas.
  - Commit de documentación: iteración 9 en `PLAN_ITERACIONES.md` y este bloque.
- **Cron diario** (diagnóstico de solo lectura): el workflow está activo. Las corridas programadas (cron 11:00 UTC) arrancaron a las 16:38, 16:47 y 18:26 UTC los días 30, 29 y 28 de septiembre. GitHub las retrasa de 5 a 7 horas, así que no está roto. A las 14:24 UTC del 2026-10-01 la de hoy aún no había corrido.
- **Corrida real** con `--out` a la carpeta temporal de la sesión: código 0, 370 s.
  - Embudo: 7125 descargados, 1678 rechazados, 1192 sin clasificar, 3284 clasificados, 500 en tablero.
  - "Modalidad no comercial": 3 rechazados. En la meta publicada el 2026-09-30T21:25:49Z eran 467. Son días distintos, así que no es una comparación exacta.
  - Mínima cuantía: 8 en el tablero (6 adjudicadas) y 127 en la muestra de `hidden.js`, todas `sin_sector`.
  - `web/data.js` 2.257.424 B, `web/hidden.js` 1.297.618 B (1500 de 3976).
  - Rara: una mínima cuantía de $6.800 millones (Tuluá, "CONVOCATORIA PÚBLICA 330.20.5.21-2026", suministro de energía). Ese valor supera de lejos el tope habitual de la modalidad; puede ser un error de la entidad en SECOP. `[POR VERIFICAR]` en el expediente.
- **Verificado:**
  - ruff sin hallazgos (con `uvx ruff`: en esta máquina `ruff` no está en el PATH); 117 pruebas Python; 40 pruebas Node; ESLint sin errores; 11 de 11 pruebas de humo.
  - En el navegador, sobre el sitio de la corrida nueva, a 1360 y 390 px: en Radar, Observatorio y PAA, el conteo de cada opción de modalidad coincide con las fichas (21 de 21 casos por ancho). En el Radar, los filtros de tiempo suman: 202 en 90 días + 21 de más de 90 + 3 sin fecha = 226 adjudicadas. Sin errores de consola y sin desbordamiento horizontal.
- **Sin commit:** nada. Los datos regenerados no se suben (regla de `AGENTS.md`); la mínima cuantía aparecerá en la web cuando corra el workflow diario en `main` después de fusionar.
- **Sin publicar:** `pro/ux-filters` no tiene rama remota; el push y el PR los decide el dueño.
- **Errores abiertos conocidos:**
  - En "Fuera del tablero", los adjudicados no tienen fecha de adjudicación (no viene en `light_record`) y el filtro de tiempo los excluye. Se corrige en 9.4.
  - Ninguna mínima cuantía por debajo de 50 M entra al tablero (`MIN_PRICE`). Ver 9.1.
  - "Próximos 3 meses" del PAA es igual a "todo", porque el PAA ya trae solo los meses que faltan del año (octubre a diciembre).
  - Vienen de antes: la tarjeta KPI ocupa 2 líneas en 390 px; "vigas"; Prettier; el archivo de reglas de Antigravity `[POR VERIFICAR]`.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: `git push -u origin pro/ux-filters` y abrir el PR a `main`.
  2. Iteración 9.0: actualizar las GitHub Actions en `.github/workflows/` y `ci/` **antes del 2026-10-19**. Las versiones están `[POR VERIFICAR]` en sus páginas de releases. El push requiere un token con alcance `workflow`.
  3. Iteración 9.3 (persona natural) y luego 9.4 (fichas del PAA y de lo oculto), según `PLAN_ITERACIONES.md`. 9.2 (temas) puede ir en paralelo.

## Estado de la sesión — 2026-10-01 (cierre) · Claude Code · rama `pro/next`

- **Publicado** (con el visto bueno del dueño):
  - Push de `pro/ux-filters` y PR #3 (https://github.com/andres-solanor/secop-opportunities-engine/pull/3). El CI pasó: python 3.11, python 3.14, node y e2e.
  - Fusionado en `main` como `7db3cc8`.
  - El dueño corrió a mano "Daily SECOP II Refresh & Deploy" (15:07 UTC): éxito, commit de datos `f0a549e`. GitHub Pages se construyó desde `f0a549e` (15:14 UTC).
- **Verificado en los datos publicados** (`f0a549e`):
  - `generated_at` 2026-10-01T15:13:57Z, 380,3 s, 500 curadas (226 adjudicadas), 129 nuevas, 133 salieron, 80 compras planeadas, `fuentes_con_error` vacío.
  - "Modalidad no comercial": 3 rechazados.
  - Mínima cuantía: 8 en el tablero (6 en el Radar, 2 en el Observatorio) y 127 en la muestra de `hidden.js`.
- **Verificado en el sitio publicado** (navegador, 1360 px):
  - "Mínima cuantía (6)" en el Radar muestra 6 fichas y "(2)" en el Observatorio, 2.
  - "Adjudicado: últimos 7 días": 41 fichas, con la nota "1 sin fecha conocida".
  - Sin errores de consola.
- **Pregunta del dueño: ¿bastan 500?** Respuesta con cifras en la iteración 9.5 de `PLAN_ITERACIONES.md`:
  - Para la demo, sí. Los sectores pequeños ya agotan su oferta y el navegador no es el límite (38 ms de carga).
  - Los límites reales son el peso del repositorio, la duración de la corrida y que `app.js` pinta todas las fichas a la vez.
  - Propuesta: paginar las fichas, publicar toda la lista liviana fuera del tablero, sacar los datos de git y solo después subir el tablero completo.
- **Sin commit:** nada. Este bloque y la fila 9.5 van en la rama `pro/next`, creada desde `origin/main` `f0a549e`.
- **Sin publicar:** `pro/next` (solo documentación). Push y PR los decide el dueño. Hasta entonces, el `ESTADO.md` de `main` termina en el bloque anterior.
- **Errores abiertos conocidos:**
  - La tarjeta "Pipeline analizado" muestra "(0%)" cuando el porcentaje filtrado es menor que 0,5 %. Ejemplo: $601 millones de $1,06 billones, que da 0,06 %. Es cosmético; mostrar "<1 %".
  - Adjudicados sin fecha de adjudicación en "Fuera del tablero" (se corrige en 9.4).
  - La mínima cuantía de $6.800 millones de Tuluá sigue `[POR VERIFICAR]` en el expediente.
  - Vienen de antes: la tarjeta KPI ocupa 2 líneas en 390 px; "vigas"; Prettier; el archivo de reglas de Antigravity `[POR VERIFICAR]`.
  - Las corridas programadas llegan de 5 a 7 h tarde (retraso de GitHub); se puede correr a mano.
- **Próximas tres acciones:**
  1. **9.0, antes del 2026-10-19:** actualizar las GitHub Actions en `.github/workflows/` y en `ci/`. Las versiones están `[POR VERIFICAR]` en sus páginas de releases. El push requiere un token con alcance `workflow`.
  2. **9.3, persona natural:** una consulta agregada a `jbjy-vk9h`, `meta.perfil_proponente`, el badge y una opción en el filtro de modalidad. El umbral se confirma con el dueño viendo la tabla calculada.
  3. **9.4, fichas del PAA y de lo oculto, y después 9.5, volumen.** 9.2 (temas) puede ir en paralelo.

## Estado de la sesión — 2026-10-01 (continuación) · Claude Code · rama `pro/persona-natural`

- **Terminado y publicado:**
  - PR #4 (https://github.com/andres-solanor/secop-opportunities-engine/pull/4), fusionado como `120a533` con el visto bueno del dueño.
  - Incluye `27d6512`: las GitHub Actions pasan a v7 (Node 24) en `.github/workflows/` y `ci/`, más una prueba que impide volver a versiones de Node 20.
  - Antes de cambiar, revisé las notas de cada versión mayor: ninguna entrada que usamos cambió.
  - El CI del PR pasó con v7, y las anotaciones de Node 20 desaparecieron. Solo queda el aviso informativo de Ubuntu 26.
  - Python 3.11.16 y 3.14.8 tienen binarios para Ubuntu 26.04, según el manifiesto de `actions/python-versions`.
- **Terminado y con commit, sin publicar** (rama `pro/persona-natural`, desde `120a533`):
  - `20511d9`, pipeline: `OpenSourcesEnricher.bidder_profile` hace una consulta agregada a `jbjy-vk9h`.
    - Cubre los últimos 12 meses, contratos de 50 M o más de obra, suministros, compraventa, interventoría y consultoría.
    - Cuenta, por modalidad, cuántos ganó una persona natural, una empresa o alguien sin dato.
    - Va en `meta.perfil_proponente`, se valida en `schema.py` y, si la fuente falla, se reutiliza `data/perfil_proponente.json`.
  - `46be449`, web:
    - `DashboardEngine.bidderShares` agrupa las modalidades como el filtro y exige 100 contratos con dato como mínimo.
    - Umbral `PERSONA_NATURAL_MIN_PCT` = 12, elegido por el dueño.
    - Badge "Persona natural gana N%", una opción en el filtro de modalidad y una sección "¿Quién gana en esta modalidad?" en el detalle.
  - `f19a36f`, corrección tras ver datos reales: lo adjudicado no se marca (en el Radar marcaba 89 procesos en los que ya no se puede ofertar), y las fichas del PAA pintan el badge.
  - Commit de documentación: este bloque, la iteración 9 actualizada y `AGENTS.md`.
- **Corrida real** con `--out` a la carpeta temporal: código 0. Fuente `perfil_proponente` ok, 27.334 contratos agregados, 11 modalidades desde 2025-10-01.
  - Porcentaje de persona natural:

    | Modalidad | % |
    |---|---:|
    | Mínima cuantía | 18,9 |
    | Subasta | 14,7 |
    | Menor cuantía | 14,2 |
    | Régimen especial (con y sin ofertas) | 11,8 |
    | Concurso | 9,8 |
    | Directa | 6,8 |
    | Licitación | 4,2 |

  - "Régimen especial" no se marca: por separado, la variante sin ofertas daba 12,8 % en la consulta exploratoria, pero la web la agrupa con la de ofertas.
- **Verificado:**
  - ruff; 121 pruebas Python; 43 pruebas Node; ESLint; 12 de 12 pruebas de humo, una nueva de persona natural que inyecta un perfil en `data.js`.
  - En el navegador, sobre el sitio de la corrida, a 1360 y 390 px:
    - Observatorio: 48 fichas y 48 badges.
    - PAA: 5 fichas y 5 badges.
    - Radar: 0 (opción oculta).
    - El detalle muestra la cifra.
    - Sin errores de consola ni desbordamiento.
- **Incidente local:** un servidor de prueba mío quedó abierto en el puerto 8765 (el `pkill` no funciona en Windows), y Playwright lo reutilizó (`reuseExistingServer`). Se detuvo con `taskkill`; a partir de ahí los servidores se cierran por PID. El CI no se afecta, porque siempre arranca un servidor nuevo.
- **Sin commit:** nada.
- **Sin publicar:** `pro/persona-natural`. Push y PR los decide el dueño. Mientras no se fusione y corra el refresco diario, la web publicada no muestra el badge: los datos actuales no traen `perfil_proponente`.
- **Errores abiertos conocidos:**
  - Si se elige "Más accesibles a persona natural" y se cambia al Radar, el filtro queda en "(0)" con el mensaje de vacío. Es coherente con el filtro de sector, pero se puede mejorar.
  - Vienen de antes: "(0%)" en la tarjeta "Pipeline analizado"; los adjudicados sin fecha en "Fuera del tablero"; la mínima cuantía de Tuluá `[POR VERIFICAR]`; la tarjeta KPI en 2 líneas a 390 px; "vigas"; Prettier.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: push de `pro/persona-natural`, PR, fusión si el CI pasa y una corrida del refresco diario para que el badge aparezca en la web publicada.
  2. **9.4:** fichas y detalle del PAA y de "Fuera del tablero" como las del Observatorio. Agrega `fecha_adjudicacion` a `light_record`, lo que también arregla el filtro de tiempo en esa vista.
  3. **9.2**, temas, o **9.5**, volumen, según prefiera el dueño.

## Estado de la sesión — 2026-10-01 (noche) · Claude Code · rama `pro/lean-cards`

- **Publicado antes de este bloque** (con el visto bueno del dueño):
  - PR #5 (persona natural), fusionado como `e06c7f7`.
  - Corrida manual del refresco: commit de datos `e06ddc4`, publicado en GitHub Pages.
  - Verificado en el sitio publicado:
    - Observatorio: 48 fichas con el badge.
    - PAA: 5 fichas con el badge.
    - Radar: opción oculta.
    - Sin errores de consola.
  - Después corrió el refresco programado: commit de datos `9ee1071`.
- **Decisión del dueño:** cuestionar la iteración 9.4 por rendimiento y escalabilidad antes de construirla, y agregar enlaces para compartir una ficha. Plan aprobado: `C:\Users\abner\.claude\plans\let-s-review-whats-next-bubbly-dongarra.md`. Resultado: tres niveles (ficha liviana, diccionario de entidades y detalle en vivo); el detalle está en la fila 9.4 de `PLAN_ITERACIONES.md`.
- **Terminado y con commit, sin publicar** (rama `pro/lean-cards`, desde `origin/main` `9ee1071`):
  - `33c5ca1`, pipeline: en `hidden.js`, los adjudicados llevan `fecha_adjudicacion` y `contratista`, y todas las fichas llevan `nit_entidad`. `window.ENTITY_STATS` se calcula desde los `entidad_stats` que ya existen. `data.js` va en JSON compacto.
  - `471b339`, web: `cardShell`, una sola estructura de ficha para el tablero, lo oculto y el PAA. Las fichas ocultas usan `bidWindow`, el bloque de fechas y el próximo paso, y muestran el ganador y los badges de la entidad.
  - `4d85407`, web: `web/secop-live.js`, el detalle en vivo para lo oculto y el PAA. También agrega `id_portafolio` a `light_record`.
  - `f1c9fb0`, web: compartir con el enlace `#op=<id>`.
    - Botón 📤 en fichas y detalle.
    - Un id que ya no está en los datos publicados se busca en vivo; si no existe, aparece el mensaje "ya no está disponible".
    - Etiquetas Open Graph genéricas.
  - Commit de documentación: este bloque, la iteración 9.4 reescrita, 9.5 ampliada y `AGENTS.md`.
- **Corrida real** con `--out` a la carpeta temporal: código 0, mismo embudo que el día (7125 descargados, 500 en tablero).
  - `hidden.js` creció 12,1 % (1.297.446 → 1.454.148 B), **por encima de la meta de 10 %**.
  - En la corrida anterior, sin `id_portafolio`: `data.js` −22,4 % (2.192.037 → 1.701.219 B) y `hidden.js` +8,0 %.
  - Adjudicados ocultos: 541 de 543 con fecha y 531 con ganador.
  - Cifras de entidad: llegan a 523 de 1500 ocultos y a 37 de 80 compras del PAA.
- **Verificado:**
  - ruff; 123 pruebas Python; 52 pruebas Node (7 nuevas de `secop-live`); ESLint; 17 de 17 pruebas de humo. Las nuevas cubren las fichas livianas, el detalle en vivo con datos.gov.co simulado (éxito y caída), el detalle del PAA, compartir con el portapapeles simulado y los enlaces a oculto y a inexistente.
  - Contra SECOP II real, sin simular: `SecopLive` devolvió para un proceso del tablero el mismo contrato, las mismas ofertas y las mismas cifras de entidad que el pipeline.
  - En el navegador, sobre el sitio de la corrida con SECOP II real, a 1360 y 390 px:
    - El detalle oculto se completó en vivo en 2,0 a 2,5 s.
    - "Últimos 30 días" en lo oculto: 1174 fichas.
    - El PAA mostró 56 badges de entidad.
    - El enlace `#op=` abrió el detalle correcto en la pestaña correcta.
    - Sin errores de consola y sin desbordamiento.
- **Incidente:** una corrida de pruebas de humo falló entera con `MemoryError` del servidor de prueba de Python mientras el pipeline corría en paralelo. Al terminar la corrida, las 13 pruebas pasaron sin cambios en el código. La causa exacta de memoria no está verificada. Recomendación: no correr el pipeline y las pruebas de humo a la vez.
- **Sin commit:** nada.
- **Sin publicar:** `pro/lean-cards`. Push, PR y fusión los decide el dueño. Después de fusionar hace falta una corrida del refresco para publicar los campos nuevos de `hidden.js` y `ENTITY_STATS`. Hasta entonces la web funciona igual, pero sin ganador ni fecha en lo oculto, y el detalle en vivo de lo oculto solo trae la entidad, porque falta `id_portafolio`.
- **Errores abiertos conocidos:**
  - `hidden.js` +12,1 % frente a la meta de 10 %. Hay una propuesta para recortarlo (`noticeUID` en vez de la URL) en 9.5.
  - La vista previa al compartir es genérica: el sitio es estático.
  - Límites de uso anónimo de datos.gov.co `[POR VERIFICAR]`; solo se consulta cuando alguien abre un detalle.
  - Vienen de antes: la etiqueta "Más accesibles a persona natural" se corta en el filtro de escritorio; "(0%)" en la tarjeta "Pipeline analizado"; la mínima cuantía de Tuluá `[POR VERIFICAR]`; la tarjeta KPI en 2 líneas a 390 px; "vigas"; Prettier; el e2e del CI tardó 8 min por la descarga de Chromium.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: push de `pro/lean-cards`, PR, fusión si el CI pasa y una corrida del refresco. Luego, verificar en el sitio publicado el ganador en lo oculto, el detalle en vivo y un enlace `#op=` abierto desde otro dispositivo.
  2. **9.2**, temas: claro, oscuro, sistema y Matrix.
  3. **9.5**, volumen: paginar las fichas, toda la lista oculta, sacar los datos de git, separar ficha y detalle, y `noticeUID`.

## Estado de la sesión — 2026-10-01 (cierre de la noche) · Claude Code · rama `pro/themes`

- **Publicado antes de este bloque:** PR #6 (`pro/lean-cards`) fusionado como `0f070dd`; después corrió el refresco `ebb63f3` (2026-10-01 18:13 UTC). En ese commit, `hidden.js` trae 1500 fichas con `id_portafolio` y 530 con `contratista`, y `data.js` trae `window.ENTITY_STATS` (225 entidades, leído en el sitio publicado).
- **Verificado en el sitio publicado** (`https://andres-solanor.github.io/secop-opportunities-engine/web/`), en Chrome de escritorio:
  - el enlace `#op=CO1.REQ.11080376`, un adjudicado fuera del tablero, abrió su detalle;
  - el detalle mostró el ganador ("EMPRESA DE DESARROLLO URBANO DE MEDELLIN"), la fecha de adjudicación y "Datos consultados en vivo en SECOP II";
  - sin errores de consola.
  - **No verificado:** abrir el enlace desde otro dispositivo.
- **Terminado y con commit, sin publicar** (rama `pro/themes`, desde `origin/main` `ebb63f3`):
  - `26e4b55`, 9.2, selector de tema: sistema, claro, oscuro y Matrix. Detalle en la fila 9.2 de `PLAN_ITERACIONES.md`, y `theme.js` y `secop_theme` en `AGENTS.md`.
  - Commit de documentación: este bloque y el plan.
- **Verificado:** ruff (con `uvx ruff`: no está instalado en el Python del sistema); 123 pruebas Python; 55 pruebas Node (3 nuevas); ESLint; 22 de 22 pruebas de humo (5 nuevas). Capturas con Playwright de los tres temas a 1360 y 390 px (tablero, Observatorio y detalle): sin desbordamiento horizontal, y el oscuro se ve igual que antes.
- **Sin commit:** nada.
- **Sin publicar:** `pro/themes`. Push, PR y fusión los decide el dueño. No hace falta corrida del refresco: solo cambian JS, CSS y HTML.
- **Errores abiertos conocidos:**
  - A 390 px la barra superior ocupa tres filas: tema y CSV; sincronización; sesión. Ya se partía antes del selector. Se podría compactar, por ejemplo con el CSV solo como ícono en móvil.
  - Matrix: el texto atenuado (`--text-muted` `#15803d`) se lee, pero con poco contraste sobre negro. No está medido.
  - Playwright emula por defecto `prefers-color-scheme: light`. Desde ahora, las pruebas de humo que no eligen tema corren en el tema claro.
  - Vienen de antes: `hidden.js` +12,1 % frente a la meta de 10 %; la vista previa genérica al compartir; los límites de datos.gov.co `[POR VERIFICAR]`; la etiqueta de persona natural cortada; "(0%)" en "Pipeline analizado"; Tuluá `[POR VERIFICAR]`; la tarjeta KPI en 2 líneas a 390 px; "vigas"; Prettier; el e2e del CI en 8 min.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: push de `pro/themes`, PR y fusión si el CI pasa. Luego, probar los cuatro temas en el sitio publicado y abrir un enlace `#op=` desde el celular.
  2. **9.5 (1):** pintar las fichas en páginas de unas 60, con "ver más" (`app.js` hoy pinta todas). Medir el tiempo de pintado antes y después.
  3. **9.5 (6) y (2):** `noticeUID` en vez de la URL en `hidden.js`, para volver a la meta de peso. Después, publicar toda la lista oculta (3976), midiendo el peso con `--out`.

## Estado de la sesión — 2026-10-01 (madrugada) · Claude Code · rama `pro/look-and-feel`

- **Publicado:** con el visto bueno del dueño, PR #7 (temas) pasó el CI (python 3.11 y 3.14, node, e2e) y se fusionó como `ddfbc40`. No necesita corrida del refresco.
- **Terminado y con commit, sin publicar** (rama `pro/look-and-feel`, desde `ddfbc40`):
  - `0f4b932`, iteración 9.6 en `PLAN_ITERACIONES.md` con la evaluación de Impeccable frente a Taste y el resultado del detector.
  - Commit de documentación: este bloque.
- **Probado, sin instalar nada en el repositorio:** `npx impeccable detect` sobre la web local a 390 px y sobre `style.css`. Las cifras están en `PLAN_ITERACIONES.md`, sección "Aspecto visual". El escaneo a 1280 px se cortó por tiempo (`Runtime.evaluate timed out`).
- **Sin commit:** nada.
- **Impeccable instalado global, solo para Claude** (decisión del dueño), sin nada en el repositorio:
  - skill en `~/.claude/skills/impeccable` (motor v0.1.5, windows-x64) y 4 agentes `impeccable-*` en `~/.claude/agents`.
  - Hooks en `~/.claude/settings.json`: `PostToolUse` sobre Edit y Write (5 s) y `Stop` (30 s), junto al hook `run_project_tests.py` que ya existía.
  - El instalador con `--scope=global` igual escribió los hooks en un `.claude/settings.local.json` de la carpeta desde donde se corrió. Se movieron a mano y ese archivo se borró.
  - Probado con una entrada simulada sobre `web/style.css`: el `Stop` devolvió los 4 hallazgos del CSS. El hook no revisa archivos fuera del proyecto.
- **Pendiente de decisión del dueño:** aprobar 9.6 (b).
- **Continuación, 9.6 (a) hecha** con el visto bueno del dueño: `c51a329`, contraste WCAG AA en los tres temas (detalle en el plan).
  - Verificado: ruff; 123 pruebas Python; 62 Node (7 nuevas de contraste); ESLint; 22 de 22 de humo.
  - Capturas a 1360 y 390 px sin desbordamiento.
  - Los hooks de Impeccable corren en esta sesión: el `PostToolUse` respondió al editar `style.css`.
  - Sin publicar: `pro/look-and-feel` (plan, estado y `c51a329`). Push, PR y fusión los decide el dueño. No hace falta corrida del refresco.
  - **Próximas tres acciones (reemplazan las de arriba):**
    1. Con el visto bueno del dueño: push de `pro/look-and-feel`, PR y fusión si el CI pasa.
    2. **9.6 (b):** barra superior, tarjeta KPI y etiqueta de persona natural a 390 px.
    3. **9.5 (1):** pintar las fichas en páginas de unas 60; el escaneo de escritorio del detector se corta por tiempo mientras no se haga.
- **Errores abiertos conocidos:** los del bloque anterior. Además, 9.6 (a): texto atenuado a 3,8:1 y blanco sobre cian a 2,4:1 en el tema oscuro.
- **Próximas tres acciones:**
  1. Push y PR de `pro/look-and-feel` (solo documentación), si el dueño lo aprueba.
  2. **9.6 (a):** corregir el contraste en los tokens de cada tema y agregar una prueba de humo que lo mida; volver a correr `npx impeccable detect` para comparar.
  3. **9.6 (b):** barra superior, tarjeta KPI y etiqueta de persona natural a 390 px. Después, 9.5 (1).

## Estado de la sesión — 2026-10-01 (cierre final) · Claude Code · rama `pro/wrap-up`

Este bloque reemplaza las "próximas acciones" de los bloques anteriores de esta fecha.

- **Publicado en esta sesión** (con el visto bueno del dueño, CI en verde: python 3.11 y 3.14, node, e2e):
  - PR #7, temas (9.2), fusionado como `ddfbc40`;
  - PR #8, contraste (9.6 a) y la evaluación de 9.6, fusionado como `2cad7cf`.
  - Ninguno necesita corrida del refresco.
- **Sitio publicado:** verificado al inicio con los datos de `ebb63f3`. No se volvió a revisar después de PR #7 y PR #8: los temas y el contraste quedaron probados en local, con capturas y pruebas de humo.
- **Terminado y con commit, sin publicar** (rama `pro/wrap-up`, desde `2cad7cf`): este bloque y el resumen de lo que sigue en `PLAN_ITERACIONES.md`. Push y PR los decide el dueño.
- **Sin commit:** nada.
- **Herramientas fuera del repositorio:** Impeccable está instalado global para Claude, con hooks `PostToolUse` y `Stop` en `~/.claude/settings.json`. Al cerrar cada respuesta, el hook `Stop` reporta 4 hallazgos previos en `style.css`, sin ignorar ninguno:
  - 3 franjas laterales (`.action-banner`, `.next-step`, `.live-note`), que corresponden a 9.6 (c);
  - la transición de `width` en `.strength-bar span`, de bajo costo.
- **Errores abiertos conocidos:**
  - A 390 px: barra superior en tres filas, tarjeta KPI en dos líneas y la etiqueta de persona natural cortada (9.6 b).
  - El escaneo de escritorio de `impeccable detect` se corta por tiempo porque la página pinta todas las fichas (9.5, punto 1).
  - `hidden.js` +12,1 % frente a la meta de 10 % (9.5, punto 6).
  - Playwright emula `prefers-color-scheme: light`: las pruebas de humo sin tema corren en claro.
  - Vienen de antes:
    - la vista previa genérica al compartir;
    - los límites de datos.gov.co `[POR VERIFICAR]`;
    - "(0%)" en "Pipeline analizado";
    - Tuluá `[POR VERIFICAR]`;
    - "vigas";
    - Prettier;
    - el e2e del CI tardó 8 min en una corrida anterior; en esta sesión tardó 2 min 8 s en PR #7.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: push de `pro/wrap-up`, PR y fusión. Revisar los cuatro temas en el sitio publicado.
  2. **9.6 (b):** compactar la barra superior a 390 px (por ejemplo, CSV solo con ícono), la tarjeta KPI y la etiqueta de persona natural. Medir con `npx impeccable detect --viewport 390x844` y agregar una prueba de humo a 390 px.
  3. **9.5 (1):** pintar las fichas en páginas de unas 60, con "ver más", midiendo el tiempo de pintado antes y después. Luego, escanear el escritorio con el detector.

## Estado de la sesión — 2026-10-01 (tarde) · Claude Code · rama `pro/favicon-390`

Este bloque reemplaza las "próximas acciones" de los bloques anteriores.

- **Al empezar:** `pro/wrap-up` ya estaba fusionada en `main` (PR #9, `893b631`). La rama `pro/favicon-390` sale de ahí.
- **Terminado y con commit, sin publicar:**
  - `f54091d`, favicon y resaltado de los filtros en uso (pedido del dueño):
    - Favicon: `web/favicon.svg`, enlazado desde `web/index.html` y desde la redirección de la raíz. `stamp_assets` ahora también sella los `.svg`.
    - Filtros: cada filtro fuera de su valor por defecto queda con borde de 2 px y fondo teñido. El botón muestra "Limpiar filtros (n)". La lógica está en `DashboardEngine.activeFilters`.
    - Verificado: ruff (con `uvx ruff`, porque `ruff` no está en el PATH de esta máquina); 124 pruebas Python; ESLint; 63 Node; 23 de 23 de humo. Capturas en oscuro, claro y Matrix: el resaltado se ve en los tres y el favicon responde 200 `image/svg+xml`.
  - Commit de documentación: la sesión de co-creación, en la sección "Visión y prioridades" de `PLAN_ITERACIONES.md`, y este bloque.
- **Decisiones del dueño en la sesión:**
  - El tablero es un módulo del motor de conexiones (prototipo en otro código).
  - Segmentos: la firma de abogados, quienes estructuran proyectos con el Estado (en descubrimiento) y el dueño con sus aliados.
  - Primero gratis y cobrar después.
  - Fase A: pulido, datos y dos demos (la firma y "de ganadores a proveedores"). Después, backend; luego, IA.
  - El dueño entregará el `GOOGLE_CLIENT_ID` real.
  - Backend: Hostinger Empresarial o Supabase, sin decidir. Se decide con una exploración de un día.
- **Sin commit:** nada.
- **Hook de Impeccable:** reporta 3 `dark-glow` previos, del cian en `box-shadow` de `style.css`, como el foco de `.input-search`. No son de este cambio. Quedan para 9.6 (c), sin ignorarlos.
- **Errores abiertos conocidos:** los del bloque anterior, salvo los que pasan a la tarea A3 del plan.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: push de `pro/favicon-390`, PR y fusión si el CI pasa.
  2. **A1 = 9.6 (b):** móvil a 390 px, con prueba de humo.
  3. **A2 = 9.5 (1):** fichas en páginas. Después, A3 a A7 en el orden del plan (las demos son A6 y A7).

## Estado de la sesión — 2026-10-01 (noche) · Claude Code · rama `pro/mobile-390`

Este bloque reemplaza las "próximas acciones" del anterior.

- **Publicado:** con el visto bueno del dueño, PR #10 (favicon, filtros resaltados y plan) pasó el CI y se fusionó como `963fac5`.
- **Terminado y con commit, sin publicar** (rama `pro/mobile-390`, desde `963fac5`): A1, que es 9.6 (b), con el detalle en el plan.
  - Verificado: ruff, pruebas Python, ESLint, 63 Node y 25 de 25 de humo, con 2 nuevas a 390 y 360 px.
  - Capturas a 390 px y a 1360 px: el escritorio no cambia.
  - La prueba a 360 px encontró un error real: "12 sectores" desbordaba en una columna de un tercio. Por eso el sector va en su propia fila.
- **Sin commit:** nada.
- **Errores abiertos conocidos:**
  - Los del bloque anterior, menos 9.6 (b).
  - A 390 px, la píldora de sincronización corta el texto con "…". El estado completo se ve al tocarla, en el modal de sincronización; el `title` es fijo y no lo repite.
- **Próximas tres acciones:**
  1. Con el visto bueno del dueño: push de `pro/mobile-390`, PR y fusión si el CI pasa.
  2. **A2 = 9.5 (1):** fichas en páginas de unas 60, con "ver más", midiendo el tiempo de pintado antes y después.
  3. **A3:** cabos sueltos de datos. Empezar por "(0%)" en "Pipeline analizado", que solo toca la web.

## Estado de la sesión — 2026-10-01 (cierre) · Claude Code · rama `pro/winners-suppliers`

Este bloque reemplaza las "próximas acciones" de los anteriores. Desde esta sesión, Claude publica sin preguntar cuando el CI pasa (`CLAUDE.md`, "Autonomía para publicar").

- **Publicado en `main`** (CI en verde en cada uno):

  | PR | Contenido |
  |---|---|
  | #11 | Móvil, A1 |
  | #12 | Páginas, A2 |
  | #13 | <1 %, vigas y Tuluá, A3 |
  | #14 | `noticeUID`, A5 (6) |
  | #15 | Empresas cliente y lista corta, A6 |

  - Ninguno necesita corrida del refresco. El próximo refresco diario ya escribe `hidden.js` con `notice_uid`, y la web lo lee desde el PR #14.
- **Terminado y con commit:** A7, de ganadores a proveedores, en `pro/winners-suppliers`. Este bloque va en el mismo PR.
  - Verificado: ruff, Python, ESLint, 70 de Node y 29 de 29 de humo. Captura del detalle con datos reales.
  - Corrida `--out` hecha antes de publicar: ver "Corridas reales" abajo.
- **Corridas reales `--out` de esta sesión** (lectura contra datos.gov.co; salida en el scratchpad, sin tocar `data/` ni `web/`):
  - Para A5 (6): embudo de 7125 descargados y 500 en el tablero; `hidden.js` 1500 de 3976, −119.232 B (−8,2 %).
  - Para A7: el mismo embudo (7125 descargados, 500 en el tablero), así que `compra_a` no cambia la clasificación. El `taxonomy.js` exportado lleva `compra_a` y es idéntico al del commit.
- **Sin commit:** nada.
- **Decisiones del dueño pendientes** (Claude no las toma solo):
  1. **A7:** revisar el mapa sector → compras (`compra_a`) y el peso de +35. Con un perfil de acero, "Para Ti" pasa de 21 a 109.
  2. **A4:** publicar Pages desde un artefacto. Toca `.github/workflows/` y necesita un token con alcance `workflow`.
  3. **A5 (2):** publicar toda la lista fuera del tablero (3976 en vez de 1500).
  4. **A3, lo que queda:** PAA más preciso y cobertura de sanciones de SECOP II. Cambian qué se publica.
  5. **A8:** el `GOOGLE_CLIENT_ID` real.
  6. **A9:** dirección visual (9.6 c).
  7. **Fase B:** Hostinger o Supabase.
- **Errores abiertos conocidos:**
  - A 390 px la píldora de sincronización corta el texto.
  - Los hallazgos previos de Impeccable (Inter, el punto que pulsa, brillos y franjas) quedan para 9.6 (c).
  - La vista previa genérica al compartir.
  - Los límites de datos.gov.co `[POR VERIFICAR]`.
- **Próximas tres acciones:**
  1. Fusionar el PR de A7 si el CI pasa.
  2. Llevar al dueño las decisiones 1 a 4 con cifras. Con su respuesta, A4 o A5 (2).
  3. Fase B: exploración de un día en Hostinger (`verify.php` y un lead en MySQL), cuando el dueño confirme el plan de hosting.

## Estado de la sesión — 2026-10-01 (noche, cierre) · Claude Code · rama `pro/session-close`

Este bloque reemplaza las "próximas acciones" de los anteriores.

- **Publicado en `main`** (CI en verde en cada PR):

  | PR | Contenido |
  |---|---|
  | #16 | De ganadores a proveedores, A7 |
  | #17 | Pages desde un artefacto, A4 |
  | #18 | Ajuste de A7, toda la lista oculta (A5.2), búsqueda con pausa, lo leído en hPanel y Croma en la lista de deseos |

- **Cambio de despliegue (A4), ya en producción:**
  - La fuente de Pages pasó a "GitHub Actions" (`build_type=workflow`, por la API, con el token de Claude, que tiene el alcance `workflow`).
  - Verificado: el push de PR #17 publicó sin consultar SECOP, y la corrida manual `36940306045` (build y deploy) terminó con éxito.
  - En el sitio publicado: datos de las 23:27 UTC, 500 en el tablero, 5000 de 6033 fuera del tablero, sin errores.
  - El historial se encadenó: la entrada de las 23:27 quedó sobre la de las 18:13, descargada del sitio.
  - `main` ya no recibe commits del bot.
- **Decisiones del dueño en esta sesión:**
  - A7: decidir Claude. Ver `DISENO_PERFILES.md` §6.
  - A4: hacerlo.
  - A5.2: hacerlo si no rompe el navegador; medido en el plan.
  - Lo que queda de A3 (PAA y sanciones): explicárselo después.
  - Hostinger: Claude lo revisa en el panel.
- **hPanel** (solo lectura; no se cambió nada; detalle en el plan, fase B):
  - `analytikz.com.co` ya corre como app Node.js. El plan admite Node 18 a 24, MySQL con acceso remoto y 3 GB de RAM.
  - SSH existe pero está inactivo.
  - Cron no aparece en el menú de la app Node.
  - Recomendación: backend en Node (Hono o Express) en un subdominio, no en PHP.
- **Sin commit:** nada.
- **Errores abiertos y observaciones:**
  - Las corridas de la noche consultan 9624 procesos, frente a 7125 en las de la tarde. Pasó dos veces. Causa encontrada: ver "Recarga de la fuente" abajo.
  - Fuera del tablero hay 6033 y se publican 5000: el techo de seguridad de `HIDDEN_WEB_MAX` ya corta.
  - Siguen abiertos los del bloque anterior: la píldora a 390 px, los hallazgos de Impeccable (9.6 c), la vista previa genérica y los límites de datos.gov.co.
- **Pendiente del dueño:**
  - el `GOOGLE_CLIENT_ID`;
  - activar SSH en hPanel cuando empiece la fase B;
  - la explicación de A3 (PAA más preciso y sanciones);
  - la dirección visual (9.6 c).
- **Lista de deseos:** Croma (plan, "Lista de deseos"). No se investigó.
- **Próximas tres acciones:**
  1. Revisar mañana la corrida programada de las 11:00 UTC: la primera del cron con el despliegue nuevo.
  2. ~~Investigar por qué la corrida de la noche descarga 9624 procesos y la de la tarde 7125~~ (hecho: "Recarga de la fuente"). Queda la decisión de los topes.
  3. Fase B: exploración de un día con una app Node en un subdominio de Hostinger (ID token de Google y un lead en MySQL), cuando el dueño entregue el `GOOGLE_CLIENT_ID` y active SSH.

### Recarga de la fuente (investigado el 2026-10-02, 00:00–00:30 UTC; solo consultas de lectura)

**Qué pasó.** En la misma fecha UTC, las corridas de las 22:27 y las 22:45 descargaron 7125 procesos y la de las 23:07 descargó 9624.

| Consulta | Corrida de las 22:34 | Corrida de las 23:14 |
|---|---:|---:|
| `general:publicados` | 2166 | 4148 |
| `general:adjudicados` | 971 | 2178 |
| Seis consultas de sector | | entre +5 y +10 % |

**Causa: SECOP II reemplazó el dataset completo.**
- Las 9.249.545 filas de `p6dx-8zbt` tienen el mismo `:created_at`: 2026-10-01T17:30:18 UTC.
- `rowsUpdatedAt` del dataset es 2026-10-01T20:16:23 UTC.
- La API siguió devolviendo la versión anterior hasta entre las 22:52 y las 23:07 UTC. Con la ventana del 1 de octubre, la fuente devuelve hoy exactamente las cifras de la corrida de las 23:14.
- El código y las ventanas de consulta no cambiaron entre corridas.

**¿Es crecimiento real?** Sí, en su mayor parte. El universo de 14 días ($50 M o más, desde el 2026-09-17) pasó de 3736 a 6997 filas (de `hidden_summary.md` publicado a las 18:13 y a las 23:27). Esas 6997 filas son 6244 procesos distintos, y casi todos los tipos de contrato se duplican por igual. Por qué la versión anterior tenía menos procesos `[POR VERIFICAR]`: no se conservan sus ids.

**Filas idénticas repetidas.** Cerca del 11 % de las filas son copias exactas; un proceso (`CO1.REQ.11077517`) aparece 205 veces. El paso de duplicados del embudo ya las quita.

**Riesgos para el pipeline:**
- `general:publicados` usa 4148 de su tope de 5000 (83 %). Con unos 400 procesos por día hábil (antes se estimaban ~230), puede llegar al tope en pocos días. Al llegar, se pierden los más viejos de la ventana, porque la consulta ordena del más nuevo al más viejo. El estado lo marca como `truncada`.
- `general:adjudicados` usa el 73 % de su tope; los sectores, hasta el 66 %.
- `HIDDEN_WEB_MAX` (5000) ya corta: hay 6033 fuera del tablero.
- La API puede servir una versión vieja durante horas después de una recarga. Una corrida en ese intervalo publica datos de la versión anterior; no es un error del pipeline.

**Decidido por el dueño el 2026-10-02** ("aplica las recomendaciones"):
1. `GENERAL_MAX_ROWS` pasa de 5000 a 8000 y `AWARDED_MAX_ROWS` de 3000 a 5000. Se agregó una prueba que exige al menos 1,5 veces el volumen medido, y el comentario dice ahora ~400 procesos por día hábil.
2. `HIDDEN_WEB_MAX` se queda en 5000. Cubrir los 6033 haría el archivo cerca de 20 % más pesado, con unos +0,3 s al abrir la vista en un teléfono lento.

## Estado de la sesión — 2026-10-02 (madrugada, cierre) · Claude Code · rama `pro/session-close-2`

Este bloque reemplaza las "próximas acciones" de los anteriores.

- **Publicado en `main`** (CI en verde en cada PR; el sitio se publica solo con cada fusión):

  | PR | Contenido |
  |---|---|
  | #21 | Topes de descarga: publicados 8000, adjudicados 5000 |
  | #22 | "¿Quién gana en esta modalidad?": la entidad (en vivo), el país (top 3 y concentración) y persona natural como contexto. Además, la prueba de humo de "hace 5 días" pasa a hora local |
  | #23 | El detalle ordena sus bloques según el estado (`DashboardEngine.detailOrder`) |
  | #24 | Plan A10, UNSPSC: hallazgos y propuesta |
  | #25 | Monitor de cobertura UNSPSC por semana (`meta.cobertura_unspsc`, reporte y panel de sincronización) |
  | #26 | `src/tools/unspsc_catalog.py`: base local con banderas y `config/unspsc_publico.json`, con 3128 nombres de datos abiertos (CC BY-SA 4.0) |
  | #27 | Condiciones de UNDP para la traducción propia |

- **Corridas en producción** (workflow manual): la última, `36953350399`, a las 02:08 UTC del 2026-10-02, con éxito. El sitio tiene "quién gana" con `top`, la cobertura UNSPSC y los topes nuevos.
- **Sin commit:** nada en el repositorio.
  - Fuera de él, a propósito: `local/unspsc.sqlite` y `local/unspsc_abiertos.json` (en .gitignore; contienen la traducción de CCE).
  - Los archivos del clasificador siguen en la carpeta de descargas del dueño.
  - Para regenerar la base: `python -m src.tools.unspsc_catalog descargar --cce <xlsx> --out local/unspsc_abiertos.json` (unos 12 minutos) y luego `construir` (comandos en el docstring).
- **Decisiones del dueño en esta sesión:**
  - "Quién gana" con las dos vistas.
  - Orden del detalle por estado.
  - Monitor UNSPSC.
  - Base con banderas.
  - Para los nombres de producto, prefiere la traducción propia desde el inglés (opción 3 del plan A10). Las condiciones de UNDP no la permiten sin el addendum comercial y un permiso escrito.
- **Pendiente del dueño:**
  - Enviar el correo a `info.unspsc@undp.org` (el borrador quedó en la conversación; el contenido está en el plan, A10, "Condiciones de UNDP").
  - El `GOOGLE_CLIENT_ID`.
  - Activar SSH en hPanel cuando empiece la fase B.
  - La dirección visual (9.6 c).
  - La explicación de lo que queda de A3 (PAA más preciso y sanciones), que pidió dejar para después.
- **Errores abiertos y observaciones:**
  - SECOP II publica casi sin código UNSPSC desde la semana del 14 de septiembre (37 %, 3 % y 1 %). El monitor dirá si vuelve.
  - Que los nombres de SECOP I salgan de la v14 de CCE es una inferencia: los 3126 coinciden exacto, pero falta confirmarlo.
  - Siguen abiertos: la píldora de sincronización a 390 px, los hallazgos de Impeccable (9.6 c), la vista previa genérica al compartir y los límites de datos.gov.co `[POR VERIFICAR]`.
- **Próximas tres acciones:**
  1. Revisar la corrida programada de las 11:00 UTC del 2026-10-02 (cron con el despliegue nuevo y los topes) y la tabla de cobertura UNSPSC.
  2. Si el dueño lo aprueba: mostrar en el detalle el código UNSPSC con el nombre público de su clase (A10, opción 1, riesgo nulo; `config/unspsc_publico.json`).
  3. Con la respuesta de UNDP: traducción propia de los nombres de producto (opción 3), comparando contra la de CCE para no copiarla.

## Estado de la sesión — 2026-10-02 (mañana) · Claude Code · rama `pro/session-close-3`

- **Publicado en `main`:** PR #29 (`b10acc4`, fusión `aab96c0`), pantalla completa del detalle en escritorio. Es un botón ⤢ junto al cierre, con una columna de lectura de 72rem. Se recuerda en `secop_detail_expanded` (documentado en `AGENTS.md`), no aparece por debajo de 900 px y tiene su prueba de humo. CI en verde.
- **Sin commit:** nada.
- **En discusión con el dueño:** códigos UNSPSC en "🧩 Qué puede necesitar el ganador". Hallazgo: los `unspsc_prefixes` de `acero_metalmecanica` incluyen `7210`, `7212` y `7214`, que son servicios de construcción. Por eso no sirven para decirle a un proveedor de acero con qué códigos se le vende al ganador: hace falta un mapa propio de insumos → clases UNSPSC en la taxonomía. No se construyó nada hasta que el dueño elija.
- **Errores abiertos:** los del bloque anterior, sin cambios.
- **Próximas tres acciones:**
  1. Con la elección del dueño, construir la versión de UNSPSC en "Qué puede necesitar el ganador" (propuesta en la conversación: códigos propios del contrato y códigos de los insumos con el nombre público de su clase).
  2. Revisar la corrida de las 11:00 UTC del 2026-10-02 y la cobertura UNSPSC.
  3. Lo pendiente del dueño en el bloque anterior (correo a UNDP, `GOOGLE_CLIENT_ID`, 9.6 c).

## Estado de la sesión — 2026-10-02 (tarde) · Claude Code · rama `pro/winner-unspsc`

Este bloque reemplaza las "próximas acciones" del anterior.

- **Hecho en esta rama** (A10, opciones 1 y 2, aprobadas por el dueño):
  - El código UNSPSC en "Objeto". Si el proceso no lo trae, se consulta en vivo el del contrato firmado.
  - Los códigos con los que vende cada sector proveedor, en "Qué puede necesitar el ganador".
  - `web/unspsc.js`, generado desde `config/unspsc_publico.json`: 140.875 B, 38.313 B con gzip.
  - Pruebas en Python, Node y de humo.
- **Para revisar por el dueño:** las clases de `vende_unspsc` en `config/taxonomy.json`. Las eligió Claude entre los nombres públicos.
- **Sin commit:** nada.
- **Errores abiertos:** los del bloque de la madrugada, sin cambios.
- **Próximas tres acciones:**
  1. Ajustar `vende_unspsc` con lo que diga el dueño.
  2. A10 paso 3: "códigos UNSPSC de tu RUP" en el perfil, y el paso 4 (afinidad y badge) si el dueño lo aprueba.
  3. Revisar la corrida diaria y la cobertura UNSPSC.
- **Commits de ese bloque:** `9c5f4b0` (función) y `d831faa` (pruebas de humo con datos.gov.co simulado por defecto), fusionados en `bd1726b` (PR #31).

## Estado de la sesión — 2026-10-02 (noche) · Claude Code · rama `pro/readability`

- **Hecho** (pedido del dueño, dos hallazgos de Impeccable):
  - Ningún texto visible baja de 12 px. Los tamaños de 0,65 a 0,74rem pasan a 0,75rem, y `small` queda con `max(0.75rem, 0.85em)`.
  - El punto de estado y el de sincronización ya no se animan.
  - Prueba de humo "legibilidad" en el tablero y en el detalle.
- **Siguen abiertos** (dirección visual, 9.6 c, decisión del dueño): la fuente Inter, el borde lateral de color de las tarjetas y los resplandores del modo oscuro.
- **Sin commit:** nada.
- **Próximas tres acciones:** las del bloque anterior (revisión de `vende_unspsc` por el dueño, A10 paso 3 y la corrida diaria).

## Estado de la sesión — 2026-10-02 (tarde, en paralelo) · Claude Code · rama `pro/competitor-research`

Este bloque **no reemplaza** las próximas acciones del anterior (`pro/winner-unspsc`, PR #31): las dos sesiones corrieron a la vez. Esta trabajó en un worktree aparte y no tocó esa rama.

- **Hecho:** investigación de competencia, fase 1 (páginas públicas, sin cuentas): Nuntaria, licitaciones.info, licitacionescolombia.co, colombialicita.com, iaLicitaciones (España), 8 jugadores colombianos más y referentes de afuera.
  - El informe es un artifact privado del dueño: https://claude.ai/artifact/PmPxvL3gRFnyNxvBdLxk2W. Es documentación comercial y no se versiona.
  - Las ideas candidatas quedaron en `PLAN_ITERACIONES.md`, en "Lista de deseos".
- **Sin código.** Solo cambian este archivo y el plan.
- **Pendiente del dueño:**
  - Elegir qué candidatas entran a la fase A.
  - Crear el correo dedicado para la fase 2 (pruebas gratis).
- **Huecos de la investigación:**
  - Licitum devolvió 403, también en el navegador.
  - Sin precios publicados: licitacionescolombia.co, Highteck y LicitaPro.
  - Sin investigar: México y los agregadores del TED.
- **Próximas tres acciones (de esta línea de trabajo):**
  1. Con la elección del dueño, diseñar la primera candidata. La sugerida es "seguir un proceso y ver qué cambió", que no necesita backend.
  2. Confirmar con `probe_sources` la columna de fecha de fin en `jbjy-vk9h`, para "contratos por vencer" (solo lectura).
  3. Fase 2 cuando exista el correo: las mismas 5 consultas de prueba en cada competidor, para comparar el onboarding, las alertas y el análisis del pliego.
