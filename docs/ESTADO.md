# Estado de trabajo (relevo entre agentes)

Documento compartido por **Claude Code** y **Antigravity**. Cada sesión termina agregando un bloque al final. El bloque más reciente es el que manda; los anteriores quedan como historial.

Plan vigente: profesionalización del prototipo (base de ingeniería, calidad de datos, más sectores y grupo "sin clasificar"). Fases:

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Worktree `oportunities-engine-pro`, rama `pro/foundation` desde `origin/main` | Hecha |
| 1 | `AGENTS.md` compartido, `CLAUDE.md` que lo importa, este documento | Hecha |
| 2 | Herramientas y CI: `pyproject.toml` (ruff), `package.json` (ESLint, Prettier, Playwright), `ci.yml`, pruebas antes del commit diario | Pendiente |
| 3 | Contrato de datos (`src/schema.py`), fallas de descarga visibles, paginación y reintentos, precios ajustados marcados, `--out`, renombrar `prospects_prototype_50.*` | Pendiente |
| 4 | Calidad de datos: valores reales de modalidad y estado, términos de exclusión, duplicados, adjudicados recientes | Pendiente |
| 4b | Taxonomía en `config/taxonomy.json`, consultas generadas, descarga sin sector, grupo "sin clasificar" oculto por defecto, reporte de descubrimiento para elegir sectores nuevos | Pendiente |
| 5 | Frontend: `web/dashboard-engine.js` con pruebas, sin estilos en línea, accesibilidad de modales, pruebas de humo con Playwright | Pendiente |
| 6 | README y documentación | Pendiente |

## Formato del bloque

```markdown
## Estado de la sesión — AAAA-MM-DD · <agente> · rama `<rama>`

- **Terminado y con commit:** qué, con SHA.
- **En curso:** qué y exactamente dónde quedó.
- **Sin commit:** qué y por qué.
- **Errores abiertos conocidos:**
- **Próximas tres acciones:**
```
