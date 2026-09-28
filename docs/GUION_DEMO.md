# Guion de demo (10–12 minutos)

**URL:** https://andres-solanor.github.io/secop-opportunities-engine/
**Antes de empezar:**
- Abrir en una ventana de incógnito (sin perfil guardado) o borrar las claves `secop_*` en DevTools → Application → Local Storage.
- Si se ve una versión vieja, recargar sin caché con Ctrl+Shift+R.
- El login de Google está en **modo demo**, así que no pide contraseña.

**Mensaje central:** *"Cada día leemos SECOP II por ti, lo cruzamos con contratos, ofertas, consorcios y planes de compra, y te decimos qué oportunidades son para tu empresa, cuándo actuar y con quién hablar."*

---

## 1. Datos vivos (1 min)
1. Señalar el indicador de la barra superior: **"SECOP hace N h · +N nuevas"** (verde = al día).
2. Clic → panel de sincronización:
   - hora de la última corrida (hora Colombia) y procesos consultados;
   - oportunidades nuevas, salidas y nuevas adjudicadas;
   - **estado de cada fuente** (procesos, contratos, ofertas, consorcios, sanciones, PAA) e historial.
3. *"Esto corre solo, todos los días a las 6:00 a. m."*

## 2. El "momento wow" antes de registrarse (3 min)
1. Banner → **"✨ Crear mi perfil gratis"**. Rol **Proveedor**, empresa "Aceros del Caribe".
2. En "¿Qué ofreces?" escribir: *"Fabricamos estructuras metálicas, cerchas y cubiertas; suministro de acero de refuerzo"*. Mostrar la **detección de sector en vivo** y la barra "N procesos por $X ya coinciden".
3. Necesidades: consorcio y clientes. Conexiones: contratistas ganadores y aliados. Zona: Antioquia. Ticket: $200M–$5.000M.
4. **Perfil de Oportunidades:** propuesta de valor clarificada, mercado en pesos, cliente ideal, conexiones con cifras reales y nombres **difuminados**.
5. **"Continuar con Google"** → se desbloquean los nombres → **"Ver mis N oportunidades"**.

## 3. Fichas que dicen qué hacer (3 min)
1. Pestaña **✨ Para Ti**: afinidad y razones ("Sector · En tu zona · Dentro de tu ticket").
2. **Radar B2B** (adjudicados). Recorrer una ficha:
   - fecha de adjudicación y **"contrato probablemente avanzado"** si es viejo;
   - **badges** por color (botón "ℹ️ Guía de badges");
   - contratista con representante legal, trayectoria e **integrantes del consorcio**;
   - **próximo paso** con fecha.
3. **🔎 Detalle:** cronograma, contrato, **competencia (ofertas recibidas, con el ganador marcado)**, integrantes con su trayectoria, contactos por rol con nota legal, y la entidad en 12 meses.
4. **💬 Pitch:** se dirige al representante legal por su nombre y va firmado con la empresa del perfil.

## 4. Llegar antes que nadie (1 min)
1. **Observatorio** → ordenar por **"Cierre más próximo"**: "⏳ Cierra hoy" en rojo. Los que ya no reciben ofertas aparecen como **"Ofertas cerradas"**.
2. Pestaña **🗓️ Planeadas (PAA)**: compras que las entidades **planean** hacer en los próximos meses, antes de que exista el proceso.

## 5. Lo que viene (1–2 min)
Con el documento [`PLAN_ITERACIONES.md`](./PLAN_ITERACIONES.md):
- **Cuenta real y monedero de créditos**, con créditos de bienvenida al registrarse.
- **IA sobre los anexos del contrato:** cantidades, requisitos habilitantes, garantías y "qué te falta" frente a tu perfil, con la página de origen de cada dato. Los anexos ya están disponibles como datos abiertos (`dmgg-8hin`).
- **Perfil profesional con evidencia**, **alertas diarias** y **dossiers de aliados**.

---

## Preguntas probables

| Pregunta | Respuesta |
|---|---|
| ¿De dónde salen los datos? | Datos abiertos oficiales de SECOP II y SECOP I en datos.gov.co, actualizados a diario. |
| ¿Mis datos quedan guardados? | En la demo, solo en tu navegador. La siguiente iteración los guarda en tu cuenta. |
| ¿Por qué no veo teléfonos o correos? | A propósito: por protección de datos personales se muestran roles y empresas. Los contactos llegarán solo con cuenta y tras revisión legal. |
| ¿Cuánto cuesta el análisis con IA? | Se pagará con créditos; los de bienvenida alcanzan para probarlo (ver `CREDITOS_IA.md`). |
| ¿Qué tan completos son los datos? | El panel de sincronización muestra la cobertura de cada fuente; algunas entidades no registran pagos o fechas en SECOP. |

## Límites a no prometer en la demo
- El login de Google no es real todavía (modo demo) y los perfiles no se sincronizan entre dispositivos.
- Las sanciones vienen de SECOP I y pueden no reflejar sanciones recientes.
- Algunos valores del PAA vienen mal digitados por las entidades; se descartan los mayores a $1 billón, pero puede quedar ruido.
- La selección diaria es de unas 150 oportunidades, no todo SECOP.
