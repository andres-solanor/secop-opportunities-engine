"""
Fuentes abiertas adicionales (gratuitas, en lote) verificadas con el diagnóstico de fuentes:

  - Ofertas por proceso (wi7w-2nvm): quién ofertó y por cuánto → competencia real.
  - Grupos de proveedores (ceth-n4bn): integrantes de consorcios y uniones temporales,
    con porcentaje de participación y líder.
  - Multas y sanciones SECOP I (4n4q-k399): sanciones registradas a contratistas.
  - Plan Anual de Adquisiciones SECOP II (9sue-ezhx): compras planeadas por las entidades
    en los sectores del motor → alertas tempranas, antes de que exista el proceso.
  - Perfil del proponente (jbjy-vk9h, agregado): por modalidad, cuántos contratos ganó una
    persona natural y cuántos una empresa. Solo conteos; ningún dato de personas.

Privacidad: de estas fuentes NO se copian teléfonos, correos ni documentos de personas
(representantes legales de grupos, responsables del PAA). Solo empresas, NIT, valores y roles.

Robustez: cada fuente es independiente; si una falla se reutiliza el dato de la corrida
anterior y el refresco diario continúa.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from src.enrichers.contract_enricher import (
    EMPTY_VALUES,
    chunks,
    clean_name,
    normalize_nit,
    soql_in,
    to_float,
    to_iso,
)

OFFERS_DATASET = "wi7w-2nvm"
GROUPS_DATASET = "ceth-n4bn"
SANCTIONS_DATASET = "4n4q-k399"
PAA_DATASET = "9sue-ezhx"

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
    "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
PAA_MIN_VALUE = 200_000_000
PAA_MAX_VALUE = 1_000_000_000_000  # por encima de $1 billón son errores de digitación típicos del PAA
PAA_MAX_ITEMS = 80
PAA_MIN_PREFIX = 4  # dígitos mínimos de un prefijo UNSPSC para consultar el PAA (ver fetch_paa)

# Perfil del proponente: qué parte de los contratos de cada modalidad la gana una persona natural.
# Solo contratos parecidos a los del tablero: "Prestación de servicios" (144.212 en 12 meses, casi
# todos de personas), "Otro" y "Decreto 092" (convenios) distorsionarían la cifra (2026-10-01).
CONTRACTS_DATASET = "jbjy-vk9h"
PROFILE_WINDOW_DAYS = 365
PROFILE_MIN_VALUE = 50_000_000  # el mismo piso que la descarga (src/harvest.py: MIN_PRICE)
PROFILE_CONTRACT_TYPES = ("Obra", "Suministros", "Compraventa", "Interventoría", "Consultoría")
# Valores reales de `tipodocproveedor`: la empresa usa NIT; "No Definido" y "Otro" son desconocidos.
NATURAL_PERSON_DOCS = (
    "cédula", "cedula", "pasaporte", "permiso", "registro civil", "tarjeta de identidad",
)
# Contratistas por modalidad que se publican en "quién gana". La web suma las modalidades que
# agrupa (con y sin ofertas) y muestra los 3 primeros: 10 por modalidad bastan para ese cruce.
PROFILE_TOP_WINNERS = 10


def doc_kind(value: Any) -> str:
    """Tipo de documento del contratista → 'juridica' (NIT), 'persona_natural' o 'sin_dato'."""
    doc = str(value or "").strip().lower()
    if doc == "nit":
        return "juridica"
    return "persona_natural" if any(k in doc for k in NATURAL_PERSON_DOCS) else "sin_dato"


def is_consortium(name: Optional[str]) -> bool:
    up = (name or "").upper()
    return any(k in up for k in ("CONSORCIO", "UNION TEMPORAL", "UNIÓN TEMPORAL", "U.T."))


def month_number(raw: Any) -> Optional[int]:
    if raw in EMPTY_VALUES:
        return None
    text = str(raw).strip().lower()
    if text.isdigit():
        n = int(text)
        return n if 1 <= n <= 12 else None
    return MONTHS.get(text)


class OpenSourcesEnricher:
    def __init__(self, client, taxonomy: Dict[str, Dict[str, Any]], log: Callable[[str], None] = print,
                 today: Optional[datetime] = None, previous: Optional[List[Dict[str, Any]]] = None,
                 previous_paa: Optional[List[Dict[str, Any]]] = None,
                 history_fn: Optional[Callable[[List[str]], Dict[str, Dict[str, Any]]]] = None,
                 paa_client=None, previous_profile: Optional[Dict[str, Any]] = None):
        self.client = client
        self.taxonomy = taxonomy
        self.log = log
        self.today = today or datetime.now(timezone.utc).replace(tzinfo=None)
        self.history_fn = history_fn
        self.paa_client = paa_client  # cliente con timeout mayor: el PAA es un dataset pesado
        self.previous = {p.get("id"): p for p in previous or [] if p.get("id")}
        self.previous_paa = previous_paa or []
        self.previous_profile = previous_profile or None
        self.summary: Dict[str, Dict[str, Any]] = {}

    # ---------- utilidades ----------
    def _query(self, dataset: str, **kwargs) -> List[Dict[str, Any]]:
        try:
            return self.client.query(dataset_id=dataset, **kwargs)
        except Exception:  # noqa: BLE001 - un reintento y luego se propaga
            return self.client.query(dataset_id=dataset, **kwargs)

    def _run(self, name: str, fn: Callable[[], int]) -> None:
        try:
            count = fn()
            self.summary[name] = {"estado": "ok", "registros": count}
        except Exception as exc:  # noqa: BLE001
            self.log(f"[!] Fuente '{name}' falló: {exc}")
            self.summary[name] = {"estado": "error", "registros": 0, "error": str(exc)[:200]}

    def _reuse(self, prospects: List[Dict[str, Any]], key: str) -> int:
        reused = 0
        for p in prospects:
            if p.get(key) is None and self.previous.get(p.get("id"), {}).get(key) is not None:
                p[key] = self.previous[p["id"]][key]
                reused += 1
        return reused

    # ---------- ofertas por proceso ----------
    def enrich_offers(self, prospects: List[Dict[str, Any]]) -> int:
        by_portfolio = {p["id_portafolio"]: p for p in prospects if p.get("id_portafolio")}
        found: Dict[str, List[Dict[str, Any]]] = {}
        for batch in chunks(sorted(by_portfolio)):
            rows = self._query(OFFERS_DATASET, where=f"id_del_proceso_de_compra in ({soql_in(batch)})", limit=5000)
            for row in rows:
                found.setdefault(row.get("id_del_proceso_de_compra"), []).append(row)

        for portfolio, p in by_portfolio.items():
            rows = found.get(portfolio)
            if not rows:
                p["ofertas"] = None
                continue
            winner = normalize_nit((p.get("contratista") or {}).get("nit"))
            seen, bidders = set(), []
            for row in sorted(rows, key=lambda r: to_float(r.get("valor_de_la_oferta")) or 0):
                key = row.get("identificador_de_la_oferta") or (row.get("nit_del_proveedor"), row.get("valor_de_la_oferta"))
                if key in seen:
                    continue
                seen.add(key)
                nit = normalize_nit(row.get("nit_del_proveedor"))
                bidders.append({
                    "proveedor": clean_name(row.get("nombre_proveedor")),
                    "nit": nit if nit and nit != "0000" else None,
                    "valor": to_float(row.get("valor_de_la_oferta")),
                    "fecha": to_iso(row.get("fecha_de_registro")),
                    "ganador": bool(winner and nit == winner),
                })
            p["ofertas"] = {"cantidad": len(bidders), "proveedores": bidders[:15]}
        return sum(1 for p in prospects if p.get("ofertas"))

    # ---------- integrantes de consorcios ----------
    def enrich_groups(self, prospects: List[Dict[str, Any]]) -> int:
        targets = [p for p in prospects if (p.get("contratista") or {}).get("es_consorcio")
                   or is_consortium((p.get("contratista") or {}).get("nombre"))]
        codes = sorted({(p.get("contrato") or {}).get("codigo_proveedor") for p in targets} - {None})
        names = sorted({(p["contratista"]["nombre"] or "").upper() for p in targets if p.get("contratista", {}).get("nombre")})

        rows: List[Dict[str, Any]] = []
        for batch in chunks(codes):
            rows += self._query(GROUPS_DATASET, where=f"codigo_grupo in ({soql_in(batch)})", limit=2000)
        for batch in chunks(names, 20):
            rows += self._query(GROUPS_DATASET, where=f"upper(nombre_grupo) in ({soql_in(batch)})", limit=2000)

        by_code: Dict[str, List[Dict[str, Any]]] = {}
        by_name: Dict[str, List[Dict[str, Any]]] = {}
        for row in rows:
            by_code.setdefault(row.get("codigo_grupo"), []).append(row)
            by_name.setdefault((row.get("nombre_grupo") or "").upper(), []).append(row)

        member_nits = set()
        for p in targets:
            code = (p.get("contrato") or {}).get("codigo_proveedor")
            group_rows = by_code.get(code) or by_name.get((p["contratista"].get("nombre") or "").upper()) or []
            members, seen = [], set()
            for row in group_rows:
                nit = normalize_nit(row.get("nit_participante"))
                name = clean_name(row.get("nombre_participante"))
                if not name or (nit or name) in seen:
                    continue
                seen.add(nit or name)
                members.append({
                    "nombre": name,
                    "nit": nit,
                    "participacion": to_float(row.get("participacion")),
                    "lider": str(row.get("es_lider_del_grupo", "")).lower() in ("verdadero", "true", "si", "sí"),
                })
                if nit:
                    member_nits.add(nit)
            p["integrantes"] = sorted(members, key=lambda m: -(m["participacion"] or 0)) or None

        if self.history_fn and member_nits:
            history = self.history_fn(sorted(member_nits))
            for p in targets:
                for m in p.get("integrantes") or []:
                    h = history.get(m["nit"] or "")
                    if h:
                        m["contratos"] = h.get("contratos")
                        m["valor_total"] = h.get("valor_total")
        return sum(1 for p in prospects if p.get("integrantes"))

    # ---------- sanciones ----------
    def enrich_sanctions(self, prospects: List[Dict[str, Any]]) -> int:
        def nits_of(p):
            out = {normalize_nit((p.get("contratista") or {}).get("nit"))}
            out |= {m.get("nit") for m in p.get("integrantes") or []}
            return {n for n in out if n}

        all_nits = sorted(set().union(*[nits_of(p) for p in prospects])) if prospects else []
        found: Dict[str, List[Dict[str, Any]]] = {}
        for batch in chunks(all_nits):
            rows = self._query(SANCTIONS_DATASET, where=f"documento_contratista in ({soql_in(batch)})", limit=2000)
            for row in rows:
                nit = normalize_nit(row.get("documento_contratista"))
                found.setdefault(nit, []).append({
                    "sancionado": clean_name(row.get("nombre_contratista")),
                    "entidad": clean_name(row.get("nombre_entidad")),
                    "resolucion": clean_name(row.get("numero_de_resolucion")),
                    "valor": to_float(row.get("valor_sancion")),
                    "fecha": to_iso(row.get("fecha_de_firmeza")) or to_iso(row.get("fecha_de_publicacion")),
                    "url": (row.get("ruta_de_proceso") or {}).get("url") if isinstance(row.get("ruta_de_proceso"), dict) else row.get("ruta_de_proceso"),
                })
        for p in prospects:
            hits = [s for nit in nits_of(p) for s in found.get(nit, [])]
            p["sanciones"] = hits[:10] or None
        return sum(1 for p in prospects if p.get("sanciones"))

    # ---------- plan anual de adquisiciones ----------
    def sector_prefixes(self) -> Dict[str, List[str]]:
        return {sid: s.get("unspsc_prefixes", []) for sid, s in self.taxonomy.items()}

    def fetch_paa(self) -> List[Dict[str, Any]]:
        prefixes = self.sector_prefixes()
        # La consulta busca el prefijo como texto dentro de la lista de códigos: un segmento de dos
        # dígitos ("42", salud) coincide con casi cualquier código y la consulta se vence (2026-09-30).
        # Solo se consulta con prefijos de familia o más; la asignación de sector sí usa todos.
        all_prefixes = sorted({pre for pres in prefixes.values() for pre in pres if len(pre) >= PAA_MIN_PREFIX})
        year = str(self.today.year)
        # Solo los meses que faltan del año: reduce mucho el volumen que filtra el servidor.
        remaining = [name.upper() for name, n in MONTHS.items() if n >= self.today.month]
        months = soql_in(remaining + [str(n) for n in range(self.today.month, 13)])
        client = self.paa_client or self.client
        # Una consulta por prefijo UNSPSC: una sola consulta con 12 condiciones excedía el tiempo de espera.
        rows: List[Dict[str, Any]] = []
        seen_ids = set()
        for pre in all_prefixes:
            batch = client.query(
                dataset_id=PAA_DATASET,
                where=f"annio = '{year}' AND categorias_unspsc like '%{pre}%' "
                      f"AND upper(fecha_esperada_de_recepcion) in ({months})",
                limit=2000,
            )
            for row in batch:
                rid = row.get("id") or row.get("identificador_unico") or id(row)
                if rid not in seen_ids:
                    seen_ids.add(rid)
                    rows.append(row)
        rows.sort(key=lambda r: str(r.get("fecha_version") or ""), reverse=True)

        latest: Dict[tuple, Dict[str, Any]] = {}
        for row in rows:
            value = to_float(row.get("valor_total_esperado")) or 0
            month = month_number(row.get("fecha_esperada_de_recepcion")) or month_number(row.get("fecha_esperada_de_inicio"))
            desc = clean_name(row.get("descripcion"))
            if value < PAA_MIN_VALUE or value > PAA_MAX_VALUE or not desc or not month or month < self.today.month:
                continue
            key = (row.get("nit_entidad"), desc.upper()[:120], round(value, -6))
            if key in latest:  # filas repetidas por versiones del PAA: se queda la más reciente
                continue
            codes = [c.strip() for c in str(row.get("categorias_unspsc") or "").split(";") if c.strip()]
            sectors = [sid for sid, pres in prefixes.items() if any(c.startswith(pre) for c in codes for pre in pres)]
            if not sectors:
                continue
            related = row.get("url_proceso")
            latest[key] = {
                "id": row.get("id") or row.get("identificador_unico"),
                "entidad": clean_name(row.get("nombre_entidad")),
                "nit_entidad": normalize_nit(row.get("nit_entidad")),
                "descripcion": desc,
                "valor": value,
                "mes_esperado": month,
                "anio": int(year),
                "modalidad": clean_name(row.get("modalidad")),
                "duracion": " ".join(filter(None, [clean_name(row.get("duracion_esperada")), clean_name(row.get("unidad_de_duracion_esperada"))])) or None,
                "origen_recursos": clean_name(row.get("origen_recursos")),
                "unspsc": codes[:6],
                "sectores": [{"id": sid, "name": self.taxonomy[sid]["name"]} for sid in sectors],
                "proceso_relacionado": clean_name(row.get("procesos_relacionados")),
                "url_proceso": related.get("url") if isinstance(related, dict) else related,
                "version_paa": clean_name(row.get("version_del_paa")),
            }
        items = sorted(latest.values(), key=lambda x: (x["mes_esperado"], -x["valor"]))
        # Prioriza los de mayor valor sin perder el orden por mes.
        top = sorted(items, key=lambda x: -x["valor"])[:PAA_MAX_ITEMS]
        return sorted(top, key=lambda x: (x["mes_esperado"], -x["valor"]))

    # ---------- orquestación ----------
    def enrich(self, prospects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        self._run("ofertas", lambda: self.enrich_offers(prospects))
        self._run("consorcios", lambda: self.enrich_groups(prospects))
        self._run("sanciones", lambda: self.enrich_sanctions(prospects))
        for key, name in (("ofertas", "ofertas"), ("integrantes", "consorcios"), ("sanciones", "sanciones")):
            for p in prospects:
                p.setdefault(key, None)
            if self.summary.get(name, {}).get("estado") == "error":
                self.summary[name]["reutilizados"] = self._reuse(prospects, key)
        self.log("[*] Fuentes abiertas: " + ", ".join(f"{k}={v['estado']}({v['registros']})" for k, v in self.summary.items()))
        return prospects

    def paa(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []

        def run() -> int:
            nonlocal items
            items = self.fetch_paa()
            return len(items)

        self._run("paa", run)
        if self.summary["paa"]["estado"] == "error":
            items = self.previous_paa
            self.summary["paa"]["reutilizados"] = len(items)
        self.log(f"[*] Plan Anual de Adquisiciones: {len(items)} compras planeadas en los sectores del motor.")
        return items

    # ---------- perfil del proponente (persona natural o jurídica) ----------
    def fetch_bidder_profile(self) -> Dict[str, Any]:
        """Contratos de los últimos 12 meses por modalidad y tipo de documento del contratista.

        Una sola consulta agregada en el servidor. La web agrupa las modalidades y decide qué
        mostrar: aquí solo se cuentan personas naturales, empresas (NIT) y desconocidos.
        """
        since = (self.today - timedelta(days=PROFILE_WINDOW_DAYS)).strftime("%Y-%m-%dT00:00:00")
        types = ", ".join("'" + t.replace("'", "''") + "'" for t in PROFILE_CONTRACT_TYPES)
        base = (f"fecha_de_firma >= '{since}' AND valor_del_contrato >= {PROFILE_MIN_VALUE} "
                f"AND tipo_de_contrato in ({types})")
        rows = self._query(
            CONTRACTS_DATASET,
            select="modalidad_de_contratacion, tipodocproveedor, count(*) as n, sum(valor_del_contrato) as v",
            where=base,
            group="modalidad_de_contratacion, tipodocproveedor",
            limit=1000,
        )
        by_modality: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            modality = clean_name(row.get("modalidad_de_contratacion"))
            if not modality:
                continue
            counts = by_modality.setdefault(modality, {"persona_natural": 0, "juridica": 0, "sin_dato": 0, "valor": 0.0})
            n = int(to_float(row.get("n")) or 0)
            counts[doc_kind(row.get("tipodocproveedor"))] += n
            counts["valor"] += to_float(row.get("v")) or 0.0
        if not by_modality:
            raise RuntimeError("la consulta no devolvió contratos")
        # Quién gana en cada modalidad: los 10 contratistas con más contratos parecidos. Una consulta
        # agregada por modalidad (unas 11, de 1 a 2 s cada una). Solo nombre y tipo de documento:
        # nunca el número de documento.
        for modality, counts in by_modality.items():
            safe = modality.replace("'", "''")
            top_rows = self._query(
                CONTRACTS_DATASET,
                select="proveedor_adjudicado, tipodocproveedor, count(*) as n, sum(valor_del_contrato) as v",
                where=f"{base} AND modalidad_de_contratacion = '{safe}'",
                group="proveedor_adjudicado, tipodocproveedor",
                order="n DESC, v DESC",
                limit=PROFILE_TOP_WINNERS,
            )
            counts["top"] = [
                {"nombre": name, "contratos": int(to_float(r.get("n")) or 0), "valor": to_float(r.get("v")) or 0.0,
                 "persona_natural": doc_kind(r.get("tipodocproveedor")) == "persona_natural"}
                for r in top_rows
                if (name := clean_name(r.get("proveedor_adjudicado")))
            ]
        return {
            "dataset": CONTRACTS_DATASET,
            "desde": since[:10],
            "valor_min": PROFILE_MIN_VALUE,
            "tipos_contrato": list(PROFILE_CONTRACT_TYPES),
            "modalidades": sorted(
                ({"modalidad": m, **c} for m, c in by_modality.items()),
                key=lambda x: -(x["persona_natural"] + x["juridica"] + x["sin_dato"]),
            ),
        }

    def bidder_profile(self) -> Optional[Dict[str, Any]]:
        """Perfil del proponente; si la consulta falla, se reutiliza el de la corrida anterior."""
        profile: Optional[Dict[str, Any]] = None

        def run() -> int:
            nonlocal profile
            profile = self.fetch_bidder_profile()
            return sum(m["persona_natural"] + m["juridica"] + m["sin_dato"] for m in profile["modalidades"])

        self._run("perfil_proponente", run)
        if self.summary["perfil_proponente"]["estado"] == "error":
            profile = self.previous_profile
            self.summary["perfil_proponente"]["reutilizados"] = 1 if profile else 0
        if profile:
            self.log(f"[*] Perfil del proponente: {len(profile['modalidades'])} modalidades desde {profile['desde']}.")
        return profile
