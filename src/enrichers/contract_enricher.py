"""
Cruce de oportunidades con SECOP II - Contratos Electrónicos (jbjy-vk9h).

Agrega a cada oportunidad curada tres bloques:

  - contrato: el contrato firmado del proceso (fechas de firma y ejecución, valor,
    avance de pagos, anticipo, prórrogas, origen de recursos y contactos por rol).
  - historial_contratista: trayectoria del contratista ganador (número de contratos,
    valor total, primer y último contrato, entidades con las que más contrata).
  - entidad_stats: comportamiento de la entidad en los últimos 12 meses (contratos,
    valor, proporción pagada de lo facturado y proveedores principales).

Privacidad: solo se guardan nombres asociados a un rol público o empresarial
(representante legal, ordenador del gasto, supervisor). No se guardan números de
documento, datos bancarios, género ni domicilio de personas.

Robustez: los nombres de columna se resuelven con varias variantes y un prefijo, y
cualquier error de red o de esquema se registra sin detener el pipeline diario.
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional

from src.services.socrata_client import SocrataClient

# Columnas del dataset de contratos (candidatos, prefijo de respaldo).
CONTRACT_FIELDS = {
    "id": (["id_contrato"], "id_contrato"),
    "referencia": (["referencia_del_contrato"], "referencia_del_contrato"),
    "estado": (["estado_contrato"], "estado_contrato"),
    "proceso_de_compra": (["proceso_de_compra"], "proceso_de_compra"),
    "objeto": (["objeto_del_contrato", "descripcion_del_proceso"], "objeto_del_contrato"),
    "fecha_firma": (["fecha_de_firma"], "fecha_de_firma"),
    "inicio_contrato": (["fecha_de_inicio_del_contrato"], "fecha_de_inicio_del_contrato"),
    "fin_contrato": (["fecha_de_fin_del_contrato"], "fecha_de_fin_del_contrato"),
    "inicio_ejecucion": (["fecha_de_inicio_de_ejecucion"], "fecha_de_inicio_de_ejecuci"),
    "fin_ejecucion": (["fecha_de_fin_de_ejecucion"], "fecha_de_fin_de_ejecuci"),
    "ultima_actualizacion": (["ultima_actualizacion"], "ultima_actualizaci"),
    "valor": (["valor_del_contrato"], "valor_del_contrato"),
    "valor_facturado": (["valor_facturado"], "valor_facturado"),
    "valor_pagado": (["valor_pagado"], "valor_pagado"),
    "valor_pendiente_ejecucion": (["valor_pendiente_de_ejecucion"], "valor_pendiente_de_ejecuci"),
    "anticipo_habilitado": (["habilita_pago_adelantado"], "habilita_pago_adelantado"),
    "valor_anticipo": (["valor_de_pago_adelantado"], "valor_de_pago_adelantado"),
    "dias_adicionados": (["dias_adicionados"], "dias_adicionados"),
    "prorrogable": (["el_contrato_puede_ser_prorrogado"], "el_contrato_puede_ser_prorrogado"),
    "es_pyme": (["es_pyme"], "es_pyme"),
    "es_grupo": (["es_grupo"], "es_grupo"),
    "destino_gasto": (["destino_gasto"], "destino_gasto"),
    "proveedor": (["proveedor_adjudicado"], "proveedor_adjudicado"),
    "documento_proveedor": (["documento_proveedor"], "documento_proveedor"),
    "codigo_proveedor": (["codigo_proveedor"], "codigo_proveedor"),
    "representante_legal": (["nombre_representante_legal"], "nombre_representante_legal"),
    "ordenador_gasto": (["nombre_ordenador_del_gasto"], "nombre_ordenador_del_gasto"),
    "ordenador_pago": (["nombre_ordenador_de_pago"], "nombre_ordenador_de_pago"),
    "direccion_ejecucion": (["direcci_n_de_ejecuci_n_del_contrato"], "direcci_n_de_ejecuci"),
    "condiciones_entrega": (["condiciones_de_entrega"], "condiciones_de_entrega"),
    "origen_texto": (["origen_de_los_recursos"], "origen_de_los_recursos"),
    "valor_pendiente_pago": (["valor_pendiente_de_pago"], "valor_pendiente_de_pago"),
    "supervisor": (["nombre_supervisor"], "nombre_supervisor"),
    "url": (["urlproceso"], "urlproceso"),
}

# Columnas de origen de recursos (se reporta cuáles tienen valor > 0).
FUNDING_SOURCES = {
    "presupuesto_general_de_la_nacion": "Presupuesto General de la Nación",
    "sistema_general_de_participaciones": "Sistema General de Participaciones",
    "sistema_general_de_regal": "Regalías (SGR)",
    "recursos_propios_alcald": "Recursos propios territoriales",
    "recursos_de_credito": "Crédito",
    "recursos_propios": "Recursos propios",
}

EMPTY_VALUES = (None, "", "No Definido", "No definido", "NO DEFINIDO", "N/A", "Sin Descripcion")
BATCH_SIZE = 40
AGGREGATE_BATCH_SIZE = 15  # las consultas agrupadas son pesadas: lotes pequeños evitan timeouts
RETRIES = 1

# Tipos de contrato relevantes para "proveedores principales" de una entidad: excluye créditos
# bancarios y prestación de servicios de personas naturales (ruido y datos personales).
SUPPLIER_CONTRACT_TYPES = ("Obra", "Suministros", "Compraventa", "Interventoría", "Consultoría")

# Estados de contrato que invalidan la oportunidad de venta al contratista.
INVALID_CONTRACT_STATES = ("borrador", "cancelado", "anulado", "rechazado")


def first_value(record: Dict[str, Any], names: List[str], prefix: str) -> Any:
    for name in names:
        if record.get(name) not in EMPTY_VALUES:
            return record[name]
    for key in sorted(record):
        if key.startswith(prefix) and record[key] not in EMPTY_VALUES:
            return record[key]
    return None


def to_float(raw: Any) -> Optional[float]:
    if raw in EMPTY_VALUES:
        return None
    try:
        return float(str(raw).replace(",", ""))
    except (TypeError, ValueError):
        return None


def to_iso(raw: Any) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    value = raw.strip().replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(value, fmt)
        except ValueError:
            continue
        return None if parsed.year < 2000 else parsed.strftime("%Y-%m-%dT%H:%M:%S")
    return None


def to_bool(raw: Any) -> Optional[bool]:
    if raw in EMPTY_VALUES:
        return None
    return str(raw).strip().lower() in ("si", "sí", "true", "1", "yes")


def clean_name(raw: Any) -> Optional[str]:
    if raw in EMPTY_VALUES or not isinstance(raw, str):
        return None
    name = re.sub(r"\s+", " ", raw).strip()
    return name if len(name) > 2 else None


def readable_text(raw: Any) -> Optional[str]:
    """Descarta códigos internos de la plataforma (p. ej. 'NXTWY.DLVY.6')."""
    text = clean_name(raw)
    if not text or re.fullmatch(r"[A-Z0-9]+(\.[A-Z0-9]+)+", text):
        return None
    return text


def funding_labels(parsed: List[Dict[str, Any]]) -> List[str]:
    """Origen de recursos legible y sin duplicados ('Distribuido' no aporta información)."""
    labels: Dict[str, str] = {}
    for row in parsed:
        for label in list(row["_sources"]) + [clean_name(row["origen_texto"])]:
            if label and label.lower() != "distribuido":
                labels.setdefault(label.lower(), label)
    return sorted(labels.values())


def normalize_nit(raw: Any) -> Optional[str]:
    """Deja solo dígitos y quita el dígito de verificación si viene separado por guion."""
    if raw in EMPTY_VALUES:
        return None
    text = str(raw).split("-")[0]
    digits = re.sub(r"\D", "", text)
    return digits or None


def notice_uid(url: Any) -> Optional[str]:
    """Extrae el noticeUID (CO1.NTC.xxx) de un enlace de SECOP II."""
    if isinstance(url, dict):
        url = url.get("url")
    if not isinstance(url, str):
        return None
    match = re.search(r"noticeUID=(CO1\.NTC\.\d+)", url)
    return match.group(1) if match else None


def soql_in(values: Iterable[str]) -> str:
    return ", ".join("'" + str(v).replace("'", "''") + "'" for v in values)


def chunks(items: List[str], size: int = BATCH_SIZE) -> Iterable[List[str]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def summarize_contracts(raw_contracts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Resume uno o varios contratos (lotes) de un mismo proceso en un solo bloque."""
    if not raw_contracts:
        return None

    parsed = []
    for raw in raw_contracts:
        row = {key: first_value(raw, names, prefix) for key, (names, prefix) in CONTRACT_FIELDS.items()}
        row["_sources"] = sorted({
            label for prefix, label in FUNDING_SOURCES.items()
            if any(k.startswith(prefix) and (to_float(v) or 0) > 0 for k, v in raw.items())
        })
        parsed.append(row)

    def total(key: str) -> Optional[float]:
        values = [to_float(r[key]) for r in parsed]
        values = [v for v in values if v is not None]
        return sum(values) if values else None

    def earliest(key: str) -> Optional[str]:
        dates = sorted(d for d in (to_iso(r[key]) for r in parsed) if d)
        return dates[0] if dates else None

    def latest(key: str) -> Optional[str]:
        dates = sorted(d for d in (to_iso(r[key]) for r in parsed) if d)
        return dates[-1] if dates else None

    main = parsed[0]
    valor = total("valor")
    facturado = total("valor_facturado")
    pagado = total("valor_pagado")
    anticipo = total("valor_anticipo")
    dias = total("dias_adicionados")

    return {
        "cantidad": len(parsed),
        "id": main["id"],
        "referencia": main["referencia"],
        "estado": main["estado"],
        "objeto": main["objeto"],
        "fecha_firma": earliest("fecha_firma"),
        "inicio_ejecucion": earliest("inicio_ejecucion") or earliest("inicio_contrato"),
        "fin_ejecucion": latest("fin_ejecucion") or latest("fin_contrato"),
        "ultima_actualizacion": latest("ultima_actualizacion"),
        "valor": valor,
        "valor_facturado": facturado,
        "valor_pagado": pagado,
        "avance_pagos_pct": round(100 * pagado / valor, 1) if valor and pagado is not None else None,
        "anticipo": bool(anticipo) or any(to_bool(r["anticipo_habilitado"]) for r in parsed),
        "valor_anticipo": anticipo or None,
        "dias_adicionados": int(dias) if dias else 0,
        "prorrogable": any(to_bool(r["prorrogable"]) for r in parsed),
        "es_pyme": to_bool(main["es_pyme"]),
        "es_grupo": to_bool(main["es_grupo"]),
        "destino_gasto": main["destino_gasto"],
        "origen_recursos": funding_labels(parsed),
        "direccion_ejecucion": clean_name(main["direccion_ejecucion"]),
        "condiciones_entrega": readable_text(main["condiciones_entrega"]),
        "proveedor": clean_name(main["proveedor"]),
        "nit_proveedor": normalize_nit(main["documento_proveedor"]),
        "codigo_proveedor": clean_name(main["codigo_proveedor"]),
        "url": main["url"]["url"] if isinstance(main["url"], dict) else main["url"],
        "contactos": {
            "representante_legal": clean_name(main["representante_legal"]),
            "ordenador_gasto": clean_name(main["ordenador_gasto"]),
            "supervisor": clean_name(main["supervisor"]),
            "ordenador_pago": clean_name(main["ordenador_pago"]),
        },
    }


class ContractEnricher:
    """Cruza las oportunidades curadas con el dataset de contratos de SECOP II."""

    def __init__(self, client: SocrataClient, log: Callable[[str], None] = print, today: Optional[datetime] = None,
                 previous: Optional[List[Dict[str, Any]]] = None):
        self.client = client
        self.log = log
        self.today = today or datetime.now(timezone.utc).replace(tzinfo=None)
        self.stats: Dict[str, int] = {}
        self.errors: List[str] = []
        self.summary: Dict[str, Any] = {}
        # Datos de la corrida anterior: respaldo si hoy falla una consulta agregada.
        self.previous_history: Dict[str, Dict[str, Any]] = {}
        self.previous_entities: Dict[str, Dict[str, Any]] = {}
        for p in previous or []:
            nit = (p.get("contrato") or {}).get("nit_proveedor") or normalize_nit((p.get("contratista") or {}).get("nit"))
            if nit and p.get("historial_contratista"):
                self.previous_history[nit] = p["historial_contratista"]
            entity = normalize_nit(p.get("nit_entidad"))
            if entity and p.get("entidad_stats"):
                self.previous_entities[entity] = p["entidad_stats"]

    # ---------- Consultas ----------
    def _query(self, **kwargs) -> List[Dict[str, Any]]:
        last_error: Optional[Exception] = None
        for _ in range(RETRIES + 1):
            try:
                return self.client.query(dataset_id=SocrataClient.CONTRACTS_DATASET, **kwargs)
            except Exception as exc:  # noqa: BLE001 - se reintenta y luego se propaga
                last_error = exc
        raise last_error  # type: ignore[misc]

    def _batched(self, label: str, items: List[str], size: int, fn: Callable[[List[str]], None]) -> None:
        """Ejecuta `fn` por lotes; un lote fallido se registra sin descartar los demás."""
        for batch in chunks(items, size):
            try:
                fn(batch)
            except Exception as exc:  # noqa: BLE001
                self.log(f"[!] Cruce con contratos ({label}): lote de {len(batch)} falló: {exc}")
                self.errors.append(f"{label}: {exc}")

    def fetch_contracts(self, prospects: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """Contratos por id de oportunidad. Cruza por id del portafolio (proceso de compra)."""
        by_portfolio: Dict[str, str] = {}
        for p in prospects:
            if p.get("id_portafolio"):
                by_portfolio[p["id_portafolio"]] = p["id"]

        found: Dict[str, List[Dict[str, Any]]] = {}
        ids = sorted(by_portfolio)
        for batch in chunks(ids):
            rows = self._query(where=f"proceso_de_compra in ({soql_in(batch)})", limit=1000)
            if rows and "columns_logged" not in self.stats:
                self.stats["columns_logged"] = 1
                self.log("[*] Columnas SECOP Contratos: " + ", ".join(sorted(rows[0])))
            for row in rows:
                opp_id = by_portfolio.get(row.get("proceso_de_compra"))
                if opp_id:
                    found.setdefault(opp_id, []).append(row)
        return found

    def fetch_contractor_history(self, nits: List[str]) -> Dict[str, Dict[str, Any]]:
        """Trayectoria de cada contratista (todas las entidades, todo el histórico de SECOP II)."""
        history: Dict[str, Dict[str, Any]] = {}

        def run(batch: List[str]) -> None:
            where = f"documento_proveedor in ({soql_in(batch)})"
            totals = self._query(
                select="documento_proveedor, count(*) as contratos, sum(valor_del_contrato) as valor_total, "
                       "min(fecha_de_firma) as primero, max(fecha_de_firma) as ultimo",
                where=where, group="documento_proveedor", limit=1000,
            )
            for row in totals:
                nit = normalize_nit(row.get("documento_proveedor"))
                if nit:
                    history[nit] = {
                        "contratos": int(to_float(row.get("contratos")) or 0),
                        "valor_total": to_float(row.get("valor_total")),
                        "primero": to_iso(row.get("primero")),
                        "ultimo": to_iso(row.get("ultimo")),
                        "entidades_top": [],
                    }
            top = self._query(
                select="documento_proveedor, nombre_entidad, count(*) as contratos, sum(valor_del_contrato) as valor",
                where=where, group="documento_proveedor, nombre_entidad", order="valor DESC", limit=2000,
            )
            for row in top:
                nit = normalize_nit(row.get("documento_proveedor"))
                if nit in history and len(history[nit]["entidades_top"]) < 3 and clean_name(row.get("nombre_entidad")):
                    history[nit]["entidades_top"].append({
                        "nombre": clean_name(row.get("nombre_entidad")),
                        "contratos": int(to_float(row.get("contratos")) or 0),
                        "valor": to_float(row.get("valor")),
                    })

        self._batched("historial", nits, AGGREGATE_BATCH_SIZE, run)
        return history

    def fetch_entity_stats(self, nits: List[str]) -> Dict[str, Dict[str, Any]]:
        """Comportamiento de cada entidad en los últimos 12 meses: volumen, pagos y proveedores."""
        since = (self.today - timedelta(days=365)).strftime("%Y-%m-%dT00:00:00")
        stats: Dict[str, Dict[str, Any]] = {}

        def run(batch: List[str]) -> None:
            where = f"nit_entidad in ({soql_in(batch)}) AND fecha_de_firma >= '{since}'"
            totals = self._query(
                select="nit_entidad, count(*) as contratos, sum(valor_del_contrato) as valor, "
                       "sum(valor_facturado) as facturado, sum(valor_pagado) as pagado",
                where=where, group="nit_entidad", limit=1000,
            )
            for row in totals:
                nit = normalize_nit(row.get("nit_entidad"))
                facturado = to_float(row.get("facturado"))
                pagado = to_float(row.get("pagado"))
                if nit:
                    stats[nit] = {
                        "contratos_12m": int(to_float(row.get("contratos")) or 0),
                        "valor_12m": to_float(row.get("valor")),
                        "pagado_sobre_facturado_pct": round(100 * pagado / facturado, 1) if facturado and pagado is not None else None,
                        "proveedores_top": [],
                    }
            top = self._query(
                select="nit_entidad, proveedor_adjudicado, count(*) as contratos, sum(valor_del_contrato) as valor",
                where=f"{where} AND tipo_de_contrato in ({soql_in(SUPPLIER_CONTRACT_TYPES)})",
                group="nit_entidad, proveedor_adjudicado", order="valor DESC", limit=3000,
            )
            for row in top:
                nit = normalize_nit(row.get("nit_entidad"))
                name = clean_name(row.get("proveedor_adjudicado"))
                if nit in stats and name and len(stats[nit]["proveedores_top"]) < 3:
                    stats[nit]["proveedores_top"].append({
                        "nombre": name,
                        "contratos": int(to_float(row.get("contratos")) or 0),
                        "valor": to_float(row.get("valor")),
                    })

        self._batched("entidades", nits, AGGREGATE_BATCH_SIZE, run)
        return stats

    # ---------- Orquestación ----------
    def _safe(self, label: str, fn: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - el refresco diario no debe caerse por el cruce
            self.log(f"[!] Cruce con contratos ({label}) falló: {exc}")
            self.errors.append(f"{label}: {exc}")
            return {}

    @staticmethod
    def promote_signed_contract(p: Dict[str, Any]) -> bool:
        """Un proceso con contrato firmado ya tiene ganador aunque SECOP lo muestre en
        'Seleccionado' o 'Evaluación': pasa a ser un lead B2B de venta directa."""
        c = p.get("contrato")
        if not c or not c.get("proveedor") or (c.get("estado") or "").lower() in INVALID_CONTRACT_STATES:
            return False
        contratista = p.setdefault("contratista", {})
        if contratista.get("nombre") in EMPTY_VALUES or contratista.get("nombre") == "Pendiente por Adjudicar":
            contratista["nombre"] = c["proveedor"]
        if contratista.get("nit") in EMPTY_VALUES and c.get("nit_proveedor"):
            contratista["nit"] = c["nit_proveedor"]
        if c.get("es_grupo"):
            contratista["es_consorcio"] = True
        fechas = p.setdefault("fechas", {})
        if not fechas.get("adjudicacion"):
            fechas["adjudicacion"] = c.get("fecha_firma")
        if "adjudicado" in (p.get("etapa_comercial") or "").lower():
            return False
        p["etapa_comercial"] = "Adjudicado (Contrato firmado)"
        p["tipo_oportunidad"] = "Lead B2B de Venta Directa"
        p["accion_sugerida"] = "Contactar al contratista ganador/consorcio para ofrecer suministro y cotización inmediata."
        return True

    def enrich(self, prospects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        contracts = self._safe("contratos", lambda: self.fetch_contracts(prospects))

        promoted = 0
        for p in prospects:
            p["contrato"] = summarize_contracts(contracts.get(p["id"], []))
            promoted += self.promote_signed_contract(p)
        if promoted:
            self.log(f"[*] {promoted} procesos con contrato firmado pasan a adjudicados (leads B2B).")

        contractor_nits = sorted({
            nit for p in prospects
            for nit in [normalize_nit((p.get("contratista") or {}).get("nit")),
                        (p.get("contrato") or {}).get("nit_proveedor")]
            if nit
        })
        history = self._safe("historial", lambda: self.fetch_contractor_history(contractor_nits))

        entity_nits = sorted({normalize_nit(p.get("nit_entidad")) for p in prospects if normalize_nit(p.get("nit_entidad"))})
        entities = self._safe("entidades", lambda: self.fetch_entity_stats(entity_nits))

        reused = 0
        for p in prospects:
            nit = (p.get("contrato") or {}).get("nit_proveedor") or normalize_nit((p.get("contratista") or {}).get("nit"))
            p["historial_contratista"] = history.get(nit) if nit else None
            if nit and not p["historial_contratista"] and nit in self.previous_history:
                p["historial_contratista"] = self.previous_history[nit]
                reused += 1
            entity = normalize_nit(p.get("nit_entidad")) or ""
            p["entidad_stats"] = entities.get(entity)
            if not p["entidad_stats"] and entity in self.previous_entities:
                p["entidad_stats"] = self.previous_entities[entity]
                reused += 1
        if reused:
            self.log(f"[*] {reused} bloques de historial/entidad reutilizados de la corrida anterior.")

        self.summary = {
            "contratos": sum(1 for p in prospects if p["contrato"]),
            "historial": sum(1 for p in prospects if p["historial_contratista"]),
            "entidades": sum(1 for p in prospects if p["entidad_stats"]),
            "promovidos": promoted,
            "reutilizados": reused,
            "errores": self.errors,
        }
        awarded = [p for p in prospects if "adjudicado" in (p.get("etapa_comercial") or "").lower()]
        self.log(
            f"[*] Cruce con contratos: {sum(1 for p in prospects if p['contrato'])} oportunidades con contrato "
            f"({sum(1 for p in awarded if p['contrato'])}/{len(awarded)} adjudicadas), "
            f"{sum(1 for p in prospects if p['historial_contratista'])} con historial del contratista, "
            f"{sum(1 for p in prospects if p['entidad_stats'])} con estadísticas de la entidad."
        )
        return prospects
