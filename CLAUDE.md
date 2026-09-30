# CLAUDE.md

Las reglas del repositorio viven en `AGENTS.md`, compartido con Antigravity. No las dupliques aquí.

@AGENTS.md

## Solo para Claude Code

- **Pruebas manuales en el navegador (Claude Code web):** Chromium está en `/opt/pw-browsers/chromium`; lanza Playwright con `executablePath` apuntando ahí (no ejecutes `playwright install`). Las fuentes de Google fallan por el proxy del sandbox: es esperado.
- **Sesiones en la nube:** el entorno web no tiene acceso a datos.gov.co; para explorar datasets usa el workflow manual "Probe SECOP sources".
