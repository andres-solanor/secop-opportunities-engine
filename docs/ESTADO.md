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
- **Pendiente de decisión del dueño:** instalar la skill Impeccable, en el proyecto (agrega hooks que también vería Antigravity) o global solo para Claude; y aprobar 9.6 (a) y (b).
- **Errores abiertos conocidos:** los del bloque anterior. Además, 9.6 (a): texto atenuado a 3,8:1 y blanco sobre cian a 2,4:1 en el tema oscuro.
- **Próximas tres acciones:**
  1. Push y PR de `pro/look-and-feel` (solo documentación), si el dueño lo aprueba.
  2. **9.6 (a):** corregir el contraste en los tokens de cada tema y agregar una prueba de humo que lo mida; volver a correr `npx impeccable detect` para comparar.
  3. **9.6 (b):** barra superior, tarjeta KPI y etiqueta de persona natural a 390 px. Después, 9.5 (1).
