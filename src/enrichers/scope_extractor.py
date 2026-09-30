"""
Scope and Material Enrichment Extractor for SECOP II
Analyzes procurement text, metadata, and categories to identify target industry relevance
(Steel/Metalmecánica, HORECA/Industrial Kitchens, Civil Works) and qualify commercial leads.
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from src.taxonomy import fold, load_taxonomy, normalize_unspsc


class ScopeExtractor:
    """Classifies opportunities into industry verticals, extracts equipment/materials, and scores lead quality."""

    # Candidatos de nombre de columna en el dataset p6dx-8zbt. Socrata recorta los nombres
    # largos, así que se aceptan varias variantes y, como último recurso, un prefijo.
    DATE_FIELDS = {
        "publicacion": (["fecha_de_publicacion_del", "fecha_de_publicacion_del_proceso"], "fecha_de_publicacion_del"),
        "ultima_actualizacion": (["fecha_de_ultima_publicaci", "fecha_de_ultima_publicacion"], "fecha_de_ultima_publica"),
        "cierre_ofertas": (["fecha_de_recepcion_de", "fecha_de_recepcion_de_respuestas"], "fecha_de_recepcion"),
        "apertura_ofertas": (["fecha_de_apertura_de_respuesta", "fecha_de_apertura_efectiva"], "fecha_de_apertura"),
        "adjudicacion": (["fecha_adjudicacion", "fecha_de_adjudicacion"], "fecha_adjudicaci"),
    }
    COUNT_FIELDS = {
        "interesados": (["proveedores_que_manifestaron", "proveedores_que_manifestaron_interes"], "proveedores_que_manifestaron"),
        "ofertas": (["respuestas_al_procedimiento", "conteo_de_respuestas_a_ofertas"], "respuestas_al_procedimiento"),
        "visualizaciones": (["visualizaciones_del", "visualizaciones_del_procedimiento"], "visualizaciones_del"),
    }

    # Sectores, palabras clave, exclusiones y prefijos UNSPSC: se editan en config/taxonomy.json.
    TAXONOMIES = load_taxonomy()

    def __init__(self, taxonomy: Optional[Dict[str, Dict[str, Any]]] = None):
        if taxonomy is not None:
            self.TAXONOMIES = taxonomy
        # Compile case-insensitive regex patterns for fast matching
        self.patterns = {}
        self.contract_types = {}
        for sector_key, sector_data in self.TAXONOMIES.items():
            regexes = [re.compile(rf"\b{re.escape(kw)}\b", re.IGNORECASE) for kw in sector_data["keywords"]]
            self.patterns[sector_key] = regexes
            self.contract_types[sector_key] = {fold(t) for t in sector_data.get("tipos_contrato") or []}

    def enrich(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enriches a raw SECOP II record with extracted sectors, materials, opportunity stage, and quality score.
        """
        text_corpus = " ".join([
            str(record.get("nombre_del_procedimiento") or ""),
            str(record.get("descripci_n_del_procedimiento") or ""),
            str(record.get("categorias_adicionales") or ""),
        ]).lower()

        cat_code = normalize_unspsc(record.get("codigo_principal_de_categoria"))
        contract_type = fold(record.get("tipo_de_contrato"))

        # 1. Match Sectors & Extract Detected Materials
        matched_sectors = []
        all_detected_materials = []
        sector_scores = {}

        for sector_key, sector_data in self.TAXONOMIES.items():
            exclusions = sector_data.get("excluir_si") or {}
            matched_keywords = []
            for pattern, kw_str in zip(self.patterns[sector_key], sector_data["keywords"], strict=True):
                if not pattern.search(text_corpus):
                    continue
                # "varilla" en "varilla de cobre para puesta a tierra" no es acero.
                if any(term in text_corpus for term in exclusions.get(kw_str, [])):
                    continue
                matched_keywords.append(kw_str)

            # Check category code bonus
            has_cat_match = any(cat_code.startswith(prefix) for prefix in sector_data["unspsc_prefixes"])

            # El tipo de contrato de SECOP (Obra, Interventoría...) nombra el sector mejor que
            # cualquier palabra suelta: clasifica por sí solo y suma como el código.
            has_type_match = bool(contract_type) and contract_type in self.contract_types[sector_key]

            # El código UNSPSC siempre suma puntaje, pero solo clasifica por sí solo (sin ninguna
            # palabra clave) en los sectores que lo declaran con `unspsc_clasifica`.
            if matched_keywords or has_type_match or (has_cat_match and sector_data.get("unspsc_clasifica")):
                score = len(matched_keywords) * 15 * sector_data["weight"]
                if has_cat_match:
                    score += 25
                if has_type_match:
                    score += 25

                sector_scores[sector_key] = score
                matched_sectors.append({
                    "id": sector_key,
                    "name": sector_data["name"],
                    "matched_keywords": matched_keywords,
                    "relevance_score": round(score, 1)
                })
                all_detected_materials.extend(matched_keywords)

        # 2. Determine Opportunity Stage & Commercial Timing
        stage_info = self._determine_stage(record)

        # 3. Extract Contract & Winning Entity Information
        price, price_adjustment = self._parse_price(record)
        contractor_info = self._extract_contractor_info(record)

        # 4. Compute Overall Lead Quality Score (0 - 100)
        lead_score = self._compute_lead_score(matched_sectors, price, stage_info, contractor_info)

        # 5. Extract Direct Document Links
        url_proceso = self._extract_url(record.get("urlproceso"))
        dates = self._extract_dates(record)

        return {
            "id": record.get("id_del_proceso") or record.get("referencia_del_proceso"),
            "id_portafolio": record.get("id_del_portafolio"),
            "referencia": record.get("referencia_del_proceso"),
            "entidad": record.get("entidad"),
            "nit_entidad": record.get("nit_entidad"),
            "departamento": record.get("departamento_entidad"),
            "ciudad": record.get("ciudad_entidad"),
            "precio": price,
            "precio_formateado": f"${price:,.0f} COP",
            "precio_ajustado": price_adjustment,
            "unspsc": cat_code or None,
            "modalidad": record.get("modalidad_de_contratacion"),
            "tipo_contrato": record.get("tipo_de_contrato"),
            "descripcion": record.get("descripci_n_del_procedimiento") or record.get("nombre_del_procedimiento"),
            "fecha_publicacion": dates["publicacion"],
            "fechas": dates,
            "plazo": self._extract_duration(record),
            "competencia": self._extract_counts(record),
            "estado_secop": record.get("estado_del_procedimiento"),
            "fase": record.get("fase"),
            "etapa_comercial": stage_info["stage_name"],
            "tipo_oportunidad": stage_info["opportunity_type"],
            "accion_sugerida": stage_info["recommended_action"],
            "sectores": matched_sectors,
            "materiales_detectados": list(set(all_detected_materials)),
            "contratista": contractor_info,
            "score_calidad": lead_score,
            "url_secop": url_proceso,
        }

    def _determine_stage(self, record: Dict[str, Any]) -> Dict[str, str]:
        """Classifies the timing of the lead into Draft/Bidding (pre-bid) vs. Awarded (direct hunting)."""
        estado = str(record.get("estado_del_procedimiento") or "").lower().strip()
        adjudicado = str(record.get("adjudicado") or "").lower().strip()
        fase = str(record.get("fase") or "").lower().strip()

        if adjudicado == "si" or "adjudicado" in estado or "celebrado" in estado or "terminado" in estado:
            return {
                "stage_name": "Adjudicado (Contratista Seleccionado)",
                "opportunity_type": "Lead B2B de Venta Directa",
                "recommended_action": "Contactar al contratista ganador/consorcio para ofrecer suministro y cotización inmediata."
            }
        elif "borrador" in estado or "borrador" in fase:
            return {
                "stage_name": "Borrador de Pliegos",
                "opportunity_type": "Oportunidad Pre-Licitación",
                "recommended_action": "Notificar a clientes contratistas para que soliciten observaciones o preparen propuesta de consorcio."
            }
        elif "convocado" in estado or "presentación de ofertas" in estado or "publicado" in estado:
            return {
                "stage_name": "Licitación Abierta (En Ofertas)",
                "opportunity_type": "Oportunidad de Alianza / Cotización",
                "recommended_action": "Compartir la oportunidad con clientes aliados para que presenten oferta incluyendo nuestros suministros."
            }
        else:
            return {
                "stage_name": f"Proceso Activo ({record.get('estado_del_procedimiento') or 'En Curso'})",
                "opportunity_type": "Monitoreo Comercial",
                "recommended_action": "Hacer seguimiento al cierre de ofertas o adjudicación."
            }

    def _extract_contractor_info(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Extracts winner and adjudication information."""
        nombre_proveedor = record.get("nombre_del_proveedor")
        nit_proveedor = record.get("nit_del_proveedor_adjudicado")
        valor_adjudicado = record.get("valor_total_adjudicacion")

        is_consortium = False
        if nombre_proveedor:
            up_name = nombre_proveedor.upper()
            if "CONSORCIO" in up_name or "UNION TEMPORAL" in up_name or "UNIÓN TEMPORAL" in up_name or "U.T." in up_name:
                is_consortium = True

        return {
            "nombre": nombre_proveedor or "Pendiente por Adjudicar",
            "nit": nit_proveedor or "N/A",
            "es_consorcio": is_consortium,
            "valor_adjudicado": float(valor_adjudicado) if valor_adjudicado else None,
            "departamento_proveedor": record.get("departamento_proveedor"),
            "ciudad_proveedor": record.get("ciudad_proveedor"),
        }

    def _parse_price(self, record: Dict[str, Any]) -> Tuple[float, Optional[Dict[str, Any]]]:
        """Devuelve `(precio, ajuste)`.

        El precio es el valor adjudicado si existe; si no, el precio base. `ajuste` es None
        salvo cuando el precio base se corrigió por un posible error de digitación: en ese caso
        guarda el valor original y el motivo, para que la cifra corregida nunca pase por dato
        de SECOP sin avisar.
        """
        try:
            p_base = float(record.get("precio_base") or 0)
        except (ValueError, TypeError):
            p_base = 0.0

        try:
            p_adj = float(record.get("valor_total_adjudicacion") or 0)
        except (ValueError, TypeError):
            p_adj = 0.0

        # If contract has awarded amount, prioritize the real contract amount
        if p_adj > 0:
            return p_adj, None

        # If base price has extreme clerical typo (e.g. municipal clerk enters $100B for small local contract)
        if p_base > 50_000_000_000:
            modalidad = str(record.get("modalidad_de_contratacion", "")).lower()
            tipo = str(record.get("tipo_de_contrato", "")).lower()
            # If not a mega-infrastructure tender, check for 1000x multiplier typo
            if "licitación pública" not in modalidad and "obra" not in tipo:
                return p_base / 1000.0, {
                    "original": p_base,
                    "motivo": "Precio base mayor a $50.000 millones en un proceso que no es licitación "
                              "pública ni obra: se asume un error de digitación y se divide entre 1.000.",
                }

        return p_base, None

    def _compute_lead_score(
        self,
        sectors: List[Dict[str, Any]],
        price: float,
        stage_info: Dict[str, str],
        contractor: Dict[str, Any]
    ) -> int:
        """Calculates a lead readiness score from 1 to 100."""
        score = 20  # Base score for passing noise filter

        # Bonus for sector match clarity
        if sectors:
            max_sector_score = max(s["relevance_score"] for s in sectors)
            score += min(35, int(max_sector_score))

        # Bonus for budget magnitude
        if price >= 1_000_000_000:  # > 1 Billion COP
            score += 25
        elif price >= 300_000_000:   # > 300 Million COP
            score += 18
        elif price >= 100_000_000:   # > 100 Million COP
            score += 10

        # Bonus for actionable stage
        if "Adjudicado" in stage_info["stage_name"] and contractor["nombre"] != "Pendiente por Adjudicar":
            score += 15
        elif "Licitación Abierta" in stage_info["stage_name"]:
            score += 10

        return min(100, max(1, score))

    @staticmethod
    def _first_value(record: Dict[str, Any], names: List[str], prefix: str) -> Any:
        """Devuelve el primer valor no vacío entre los nombres candidatos o, si no hay, el de la
        primera columna que empiece por `prefix`."""
        for name in names:
            if record.get(name) not in (None, ""):
                return record[name]
        for key in sorted(record):
            if key.startswith(prefix) and record[key] not in (None, ""):
                return record[key]
        return None

    @staticmethod
    def _normalize_date(raw: Any) -> Optional[str]:
        """Normaliza fechas SODA ('2026-09-25T00:00:00.000') a ISO sin milisegundos."""
        if not raw or not isinstance(raw, str):
            return None
        value = raw.strip().replace("Z", "")
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                parsed = datetime.strptime(value, fmt)
            except ValueError:
                continue
            if parsed.year < 2000:  # SECOP usa fechas centinela (p. ej. 1900-01-01) para "sin fecha"
                return None
            return parsed.strftime("%Y-%m-%dT%H:%M:%S")
        return None

    def _extract_dates(self, record: Dict[str, Any]) -> Dict[str, Optional[str]]:
        """Fechas clave del proceso: publicación, cierre de ofertas, adjudicación, etc."""
        return {
            key: self._normalize_date(self._first_value(record, names, prefix))
            for key, (names, prefix) in self.DATE_FIELDS.items()
        }

    def _extract_duration(self, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Plazo de ejecución del contrato (duración + unidad)."""
        raw = self._first_value(record, ["duracion"], "duracion")
        unit = self._first_value(record, ["unidad_de_duracion"], "unidad_de_duracion")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return None
        if value <= 0:
            return None
        value = int(value) if value.is_integer() else value
        unit_text = str(unit or "").strip().lower()
        return {"valor": value, "unidad": unit_text, "texto": self._term_text(value, unit_text)}

    @staticmethod
    def _term_text(value: Any, unit: str) -> str:
        """SECOP reporta unidades como 'día(s)' o 'mes(es)'; se convierten a singular/plural."""
        forms = {"dia": ("día", "días"), "día": ("día", "días"), "mes": ("mes", "meses"),
                 "año": ("año", "años"), "ano": ("año", "años"), "semana": ("semana", "semanas")}
        base = re.sub(r"\(.*\)", "", unit).strip()
        for prefix, (singular, plural) in forms.items():
            if base.startswith(prefix):
                return f"{value} {singular if value == 1 else plural}"
        return f"{value} {unit}".strip()

    def _extract_counts(self, record: Dict[str, Any]) -> Dict[str, Optional[int]]:
        """Señales de competencia: interesados, ofertas recibidas y visualizaciones."""
        counts = {}
        for key, (names, prefix) in self.COUNT_FIELDS.items():
            raw = self._first_value(record, names, prefix)
            try:
                counts[key] = int(float(raw))
            except (TypeError, ValueError):
                counts[key] = None
        return counts

    def _extract_url(self, raw_url: Any) -> str:
        """Extracts URL string from SODA response dict or string format."""
        if isinstance(raw_url, dict):
            return raw_url.get("url", "")
        if isinstance(raw_url, str):
            return raw_url
        return ""
