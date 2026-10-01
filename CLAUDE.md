# CLAUDE.md

Las reglas del repositorio viven en `AGENTS.md`, compartido con Antigravity. No las dupliques aquí.

@AGENTS.md

## Solo para Claude Code

- **Autonomía para publicar** (decisión del dueño, 2026-10-01): Claude hace push, abre el PR y lo fusiona sin preguntar cuando pasan las cinco verificaciones locales y el CI. Después sigue con la siguiente tarea del plan y con mejoras menores. **Pregunta antes** en estos casos:
  - cambios en `.github/workflows/`;
  - cambios en el pipeline que alteren qué datos se descargan, descartan o publican;
  - cualquier cosa que borre datos;
  - decisiones de producto o de diseño visual (por ejemplo 9.6 c);
  - lo que el plan marque como decisión del dueño.

  Al dueño se le lleva lo que vale su tiempo: decisiones, no confirmaciones.

- **Pruebas manuales en el navegador (Claude Code web):** Chromium está en `/opt/pw-browsers/chromium`; lanza Playwright con `executablePath` apuntando ahí (no ejecutes `playwright install`). Las fuentes de Google fallan por el proxy del sandbox: es esperado.
- **Sesiones en la nube:** el entorno web no tiene acceso a datos.gov.co; para explorar datasets usa el workflow manual "Probe SECOP sources".
