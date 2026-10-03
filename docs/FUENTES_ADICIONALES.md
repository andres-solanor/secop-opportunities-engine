# Fuentes adicionales y Croma

Evaluación del 2026-10-03, pedida por el dueño: qué otra información pública sirve al motor, por qué vía conviene traerla (datos abiertos, *scraping* o Croma) y qué se puede integrar de Croma.

**Cómo se hizo y sus límites.**
- El sandbox de la sesión bloquea `docs.usecroma.com`, `usecroma.com` y `www.datos.gov.co`.
- Todo lo de Croma sale de resultados de búsqueda web sobre sus páginas públicas: documentación, términos, fuentes y *changelog*.
- Los IDs de datasets salen de las URL de datos.gov.co que devolvió el buscador.
- **Ningún dataset nuevo se consultó**. Las columnas, la cobertura y las llaves de cruce están `[POR VERIFICAR]` con el workflow "Probe SECOP sources".
- **Actualización del 2026-10-03 (tarde):** se leyó el repositorio de la hackatón, `andres-solanor/croma-hackaton`, que el dueño probó contra la API real con su llave.
  - Lo que dice §1.1 sale de su `README.md`, `HANDOFF_MVP.md`, `INCIDENTS.md` y `DEPLOYMENT.md`, y corrige lo que aquí se había inferido por búsquedas.
  - La carpeta local `C:\Users\abner\Claude\Projects\Hackaton croma` no se leyó: el repositorio parece ser su versión publicada `[POR VERIFICAR]`.

---

## 1. Qué es Croma

Una API comercial de datos de gobierno para Latinoamérica: Colombia, Perú y México, y algunas fuentes de EE. UU. y Brasil. Convierte registros oficiales en JSON tipado, con una sola autenticación. Se usa por API REST, por un **servidor MCP** (Claude, ChatGPT, Cursor; inicio de sesión con OAuth) o por su consola. Además publica herramientas web gratuitas y sin registro (por ejemplo, "consultar proceso SECOP").

**Endpoints de Colombia vistos** (todos `POST`):

| Endpoint | Fuente | ¿Sirve al motor? |
|---|---|---|
| `/co/secop/process/v1` (y búsqueda y perfil por NIT) | SECOP I y II: diez datasets desde 2004, en un vocabulario (changelog del 2026-08-30) | **No**: ya lo tenemos gratis y directo desde Socrata |
| `/co/rues/entity-by-nit/v1` (también por nombre) | RUES: razón social, matrícula y estado, cámara, CIIU, representantes legales, vinculados y estados financieros | **Sí**: riesgo y contacto del ganador o del aliado |
| `/co/procuraduria/disciplinary-records/v1` | Procuraduría (SIRI): antecedentes disciplinarios, penales, fiscales y contractuales | **Sí**: inhabilidades para contratar |
| `/co/contraloria/fiscal-records/v1` | Contraloría (SIBOR): boletín de responsables fiscales | **Sí**: inhabilidad para contratar |
| `/co/contaduria/state-delinquent-debtors/v1` | Contaduría: Boletín de Deudores Morosos del Estado (BDME) | **Sí**: restricción para contratar |
| `/co/supersociedades/financial-statements/v1` | Supersociedades: estados financieros | **Sí**: capacidad financiera del aliado o del ganador |
| `/co/rama-judicial/cases-by-entity/v1` y `cases-by-radicado/v1` | Rama Judicial: procesos por nombre, documento o entidad | **Tal vez**: litigios contractuales de una entidad o un aliado |
| `/co/sicaac/insolvency-cases/v1` | MinJusticia: insolvencia de persona natural | No: es de personas naturales, no de empresas |
| `/co/policia/criminal-records/v1`, `/co/registraduria/vital-status/v1`, `/co/runt/vehicle-by-plate/v1`, `/co/simit/account-status/v1`, ADRES, DIAN (CUFE), Superfinanciera y SIMEV | Identidad, vehículos, salud, factura electrónica y mercado de valores | **No**: datos personales sensibles o fuera del caso de uso |

**Condiciones conocidas:**
- El cobro es por uso, por solicitud, con un saldo de créditos por organización. Hay un plan gratuito para empezar. Los precios por consulta no son públicos `[POR VERIFICAR]`.
- Lotes de hasta 50 consultas por solicitud. Cada una cuenta contra la cuota, y se responde 429 si se pasa del saldo. Los valores del límite de tasa están `[POR VERIFICAR]` (encabezados `X-RateLimit-*`).
- Los **términos prohíben revender o redistribuir los servicios sin autorización escrita** y su uso para discriminación ilegal o fines prohibidos por la regulación de datos personales.

### 1.1 Verificado contra la API real (hackatón)

Corrige y completa las "condiciones conocidas". Cifras tomadas de los documentos de la hackatón, medidas en su registro de cuota.

- **URL base `https://api.croma.run`.** Todos los endpoints son `POST` con cuerpo JSON y llave *bearer*. Los nombres de la documentación (`rues-entity-by-nit`) son páginas, no rutas: la ruta real es `/co/rues/entity-by-nit/v1`.
- **La cuota es por organización y por día: 100 peticiones** (500 durante la hackatón).
  - Emitir más llaves no la multiplica.
  - Un lote cuenta cada ítem.
  - Los aciertos de la caché de Croma también cuentan.
  - Una petición mal formada (400) también cuenta. Por eso hay que validar documentos antes de llamar y tener caché propia.
- **El límite de tasa falla abierto:** los encabezados `X-RateLimit-*` a veces no vienen. Sobre la cuota responde 429 con `Retry-After`.
- **Latencia** (medias medidas):

  | Fuente | Media |
  |---|---:|
  | Contaduría | 41.671 ms |
  | Contraloría | 20.959 ms |
  | Procuraduría | 5.273 ms |
  | RUES | 899 ms |
  | Sanciones SECOP | 648 ms |

  Contaduría y Contraloría raspan portales oficiales: se piden en paralelo y una consulta completa tarda entre 25 y 70 s.
- **Contaduría responde a veces 202, un trabajo asíncrono** con `data: null`: hay que sondear su `status_url`. Si se guarda en caché así, queda indistinguible de "sin reporte" (INC-02).
- **Contaduría no trae los campos que documenta:** viene `deudor_moroso.reported`, no `delinquent_to_state` (INC-03).
- **Procuraduría tuvo 502 sostenidos** (16 de 23 respuestas en una ventana): hace falta un cortacircuitos.
- **El RUES ya trae `financials[]`:** el endpoint de Supersociedades es redundante para activos, pasivos, patrimonio y resultado.
- **El RUES trae documentos truncados** en las partes relacionadas y a veces a la propia sociedad. Hay que validarlos antes de consultar antecedentes.
- **`rues-entities-by-name` busca por razón social, no por persona.**
- **Las entidades de régimen especial no registran adjudicación estructurada** en SECOP II.
- **Policía (antecedentes penales) no se consume:** es dato personal sensible (Ley 1581 de 2012).

**Consecuencia:** con 100 peticiones diarias para toda la organización, un dossier de una empresa con dos representantes legales (8 peticiones) da para unas 12 empresas nuevas al día. Lo repetido sale de la caché sin costo.

Un servicio abierto al público necesita una de tres cosas:
- precómputo por lotes;
- una cuota por usuario sobre una caché compartida;
- que cada usuario traiga su llave.

`DEPLOYMENT.md` de la hackatón compara las tres.

**Implementado aquí:** `python -m src.tools.croma_dossier <NIT>`, con su cliente (`src/services/croma_client.py`), sus adaptadores (`src/services/croma_endpoints.py`) y sus señales (`src/dossier.py`).
- Es manual y deja el resultado en `local/`.
- No toca el pipeline ni el sitio publicado.

### Cómo encaja con este motor

1. **El sitio es estático y público.** Una llave de Croma no puede ir en el navegador. Publicar en `data.js` lo que devuelve Croma, para todos, se parece a redistribuir. Por eso, **no va en el pipeline diario**.
2. **Encaja como fuente paga bajo demanda** en la fase B (backend). Un usuario con cuenta pide "verificar a este contratista o aliado", se cobra en créditos y se muestra solo a él. Es exactamente la fila "Fuentes pagas (proveedor de datos RUES u otro)" de `CREDITOS_IA.md` §1. Croma sería ese proveedor.
3. **Para SECOP no aporta**: tenemos las mismas fuentes sin costo ni intermediario. Su lista de los "diez datasets" sí sirve para comparar con lo que ya usamos.
4. **Uso inmediato, sin código**: el dueño puede conectar el MCP de Croma a Claude y hacer a mano la debida diligencia de un ganador o un aliado. Así se valida qué verificaciones pide de verdad un cliente antes de pagar una integración.

**Preguntas para Croma (las lleva el dueño):**
- Precio por endpoint y por volumen.
- Si mostrar el resultado a un usuario final de un SaaS pago cuenta como "redistribución". Si hace falta autorización escrita, pedirla.
- Cuánto tiempo se puede guardar en caché un resultado.
- Nivel de servicio y tiempos de respuesta, porque las fuentes de origen (Procuraduría, Contraloría) se caen.
- Si hay créditos de la hackatón.

---

## 2. Datos abiertos que el motor aún no usa

El cliente Socrata actual los consulta sin costo, en lote y sin cambiar de arquitectura. Ya se usan:
- `p6dx-8zbt`, `jbjy-vk9h`, `wi7w-2nvm` (y `b28v-edj8`), `ceth-n4bn`, `4n4q-k399`, `9sue-ezhx` y `dmgg-8hin`;
- además, `f789-7hwg`, `qddk-cgux`, `qmzu-gj57` y `4ex9-j3n8`, solo para el catálogo UNSPSC.

En orden de valor sobre esfuerzo:

| # | Dataset | ID | Qué aporta | Llave probable | Esfuerzo |
|---|---|---|---|---|---|
| 1 | **SECOP II · Multas y Sanciones** | `it5q-hg94` | Sanciones registradas en SECOP II, con actualización diaria según su ficha. Resuelve "Cobertura de sanciones" de la iteración 8: hoy solo usamos `4n4q-k399`, que es SECOP I | NIT del contratista | S |
| 2 | **RUES · Personas naturales, jurídicas y ESAL** (Confecámaras) | `c82u-588k` | Extracto del registro mercantil de todas las cámaras: estado de la matrícula, fechas y CIIU `[POR VERIFICAR]`. Sirve para:<ul><li>"empresa activa" o "matrícula cancelada" del ganador o del aliado;</li><li>antigüedad;</li><li>autollenar sectores del perfil por CIIU al escribir el NIT.</li></ul>Cubre gran parte de lo que se pensaba pagar a un proveedor de RUES | NIT | M (es grande: se consulta por NIT, no se descarga) |
| 3 | **SECOP II · Proveedores registrados** | `qmzu-gj57` | Ya lo usa `unspsc_catalog.py`. El plan lo daba por no encontrado (iteración 8, "Proveedores registrados"). Trae la categoría principal y, según `PROPUESTA_FICHAS.md` §4, el contacto empresarial `[POR VERIFICAR]` | NIT | S |
| 4 | **SECOP II · Modificaciones a contratos** | `6bna-xzpv` | Prórrogas y cesiones. Para "contratos por vencer": un contrato prorrogado sigue vivo; uno que vence sin prórroga es una compra próxima | ID del contrato | M |
| 5 | **SECOP II · Adiciones** | `cb9c-h8sn` | Adiciones en valor: lo que la entidad termina pagando de más. Es una cifra para "cifras de la entidad para decidir" | ID del contrato | S |
| 6 | **SECOP II · Ejecución contratos** | `mfmm-jqmq` | Avance estimado y real. Contratos atrasados son una señal para proveedores del ganador y para el seguimiento | ID del contrato | S |
| 7 | **SECOP II · Garantías** | `gjp9-cutm` | Pólizas exigidas y quién las expidió. Son leads para el sector seguros, que hoy está en "Otros" | ID del contrato o proceso | S |
| 8 | **Tienda Virtual del Estado (TVEC) · Consolidado** | `[POR VERIFICAR]` (el buscador mostró la visualización `79fi-twz7`, no el dataset) | Órdenes de compra por acuerdo marco: compras que nunca aparecen como proceso. Sirve para saber qué entidad compra por catálogo y a quién | NIT de la entidad y del proveedor | M |
| 9 | **SECOP Integrado** | `rpmr-utcd` | SECOP I y II juntos. Podría simplificar el historial del contratista. Es lo mismo que Croma vende como "SECOP I y II en un solo lugar" | NIT | M |
| 10 | **Supersociedades · Estados financieros NIIF** (datos abiertos) | `[POR VERIFICAR]` | Activo, pasivo, ingresos y utilidad. Con eso se calculan los indicadores financieros que exige el RUP (liquidez y endeudamiento) del ganador o del aliado. Solo cubre las sociedades que reportan a Supersociedades | NIT | M |

**Cuidado con los datos personales**, la misma regla de `CREDITOS_IA.md` §6:
- `c82u-588k` incluye personas naturales comerciantes. Del RUES se publican solo campos de la empresa (razón social, estado, CIIU, municipio), nunca el documento de una persona natural.
- Lo que traiga teléfonos o correos va solo a usuarios con cuenta, desde el backend.

**Siguiente paso, de solo lectura:** agregar estos IDs a `probe_sources.py` y correr el workflow "Probe SECOP sources" con `--valores`, para confirmar columnas, llaves y volumen. Incorporar cualquiera al pipeline cambia lo que se descarga y se publica, así que lo decide el dueño.

---

## 3. Lo que no está en datos abiertos: Croma, *scraping* o nada

| Necesidad | Sin API abierta | Recomendación |
|---|---|---|
| Antecedentes disciplinarios y fiscales, y deudores morosos del Estado (Procuraduría, Contraloría, Contaduría) | Consulta uno a uno con captcha o registro | **Croma bajo demanda** (fase B, créditos). No hacer *scraping*: los portales tienen captcha y términos propios, y Croma ya resolvió el acceso. Antes de mostrar una inhabilidad, validar con asesoría jurídica cómo presentarla |
| Representantes legales, vinculados y estados financieros por NIT | RUES en línea | Primero `c82u-588k` (gratis). Croma solo para el detalle que no esté ahí |
| Adendas y documentos nuevos de un proceso seguido | El portal de SECOP II tiene captcha `[POR VERIFICAR]` | Sin *scraping*: usar `dmgg-8hin` (archivos por proceso, con `fecha_carga`). Un archivo nuevo después de la última revisión es un cambio. Completa "seguir lo guardado", que hoy no ve anexos ni adendas |
| Compras de entidades de régimen especial que no publican todo en SECOP (empresas de servicios públicos, universidades, ESE) | Portales propios, cada uno distinto | Un hueco real, pero caro de mantener: un *scraper* por portal. Dejarlo para cuando un cliente lo pida y medir antes cuánto falta `[POR VERIFICAR]` |
| Perú y México (expansión) | — | Croma cubre fuentes de Perú y México. Sus fuentes de compras públicas allá están `[POR VERIFICAR]` |

**Regla general:**
- *Scraping*, solo si la fuente no tiene datos abiertos, Croma no la cubre, sus términos lo permiten y no tiene captcha.
- Siempre de solo lectura y a ritmo bajo, como dice `AGENTS.md`.
- Hoy ninguna necesidad cumple las cuatro condiciones.

---

## 4. Propuesta de orden

1. **Probe de solo lectura** de los diez datasets de §2. Sin cambiar el pipeline.
2. **Sanciones SECOP II (`it5q-hg94`)** en el badge de riesgo, junto a `4n4q-k399`. Es el cambio más chico y cierra un pendiente de la iteración 8. *Decisión del dueño*: cambia lo que se descarga.
3. **RUES abierto (`c82u-588k`)**:
   - el estado de la matrícula del ganador en el Radar B2B;
   - el CIIU como pista de sectores en el onboarding.

   *Decisión del dueño.*
4. **Adendas por `dmgg-8hin`** en "seguir lo guardado".
5. **Croma**: el dueño corre `python -m src.tools.croma_dossier` sobre 5 NIT reales (o prueba el MCP) y resuelve con Croma las preguntas de §1. La integración en la web va con el backend de la fase B, como fuente paga bajo demanda.
