"""
Scope and Material Enrichment Extractor for SECOP II
Analyzes procurement text, metadata, and categories to identify target industry relevance
(Steel/Metalmecánica, HORECA/Industrial Kitchens, Civil Works) and qualify commercial leads.
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Optional


class ScopeExtractor:
    """Classifies opportunities into industry verticals, extracts equipment/materials, and scores lead quality."""

    TAXONOMIES = {
        "acero_metalmecanica": {
            "name": "Acero & Metalmecánica",
            "keywords": [
                "acero estructural", "acero de refuerzo", "perfiles de acero", "vigas de acero",
                "tubería de acero", "tuberia de acero", "tubería estructural", "tuberia estructural",
                "varilla", "varillas", "varilla de acero", "cubierta metálica", "cubiertas metálicas",
                "estructura metálica", "estructuras metálicas", "estructura metalica",
                "estructuras metalicas", "vigas", "perfilería", "perfiles", "lámina galvanizada",
                "lamina galvanizada", "cercha", "cerchas", "puente metálico", "puente vehicular",
                "reforzamiento estructural", "soldadura", "hierro figurado", "carpintería metálica",
                "cerramientos metálicos", "malla eslabonada", "acero figurado", "acero inoxidable",
                "suministro de acero"
            ],
            "unspsc_prefixes": ["3010", "3026", "7214", "7212", "7210"],
            "weight": 1.2
        },
        "horeca_industrial": {
            "name": "HORECA & Maquinaria Gastronómica",
            "keywords": [
                "cocina industrial", "cocinas industriales", "horno combinado", "hornos industriales",
                "cuarto frío", "cuartos fríos", "cuartos frios", "refrigeración comercial",
                "refrigeracion comercial", "estufa industrial", "estufas industriales",
                "campana extractora", "campanas extractoras", "marmita", "marmitas",
                "lavavajillas industrial", "menaje institucional", "dotación de restaurante",
                "dotacion de restaurante", "alimentación escolar", "pae", "planta de procesamiento",
                "congelador industrial", "equipamiento gastronómico", "equipamiento gastronomico",
                "acero inoxidable 304", "autoservicio de alimentos"
            ],
            "unspsc_prefixes": ["4810", "5214", "9010", "4110"],
            "weight": 1.3
        },
        "energia_solar_alumbrado": {
            "name": "Energía Solar & Alumbrado Público",
            "keywords": [
                "energía solar", "energia solar", "panel solar", "paneles solares",
                "sistema fotovoltaico", "sistemas fotovoltaicos", "fotovoltaica", "fotovoltaico",
                "energía renovable", "energia renovable", "luminarias led", "luminaria led",
                "alumbrado público", "alumbrado publico", "subestación eléctrica", "subestacion electrica",
                "redes eléctricas", "redes electricas", "transformador", "transformadores",
                "inversor solar", "baterías solares", "baterias solares", "eficiencia energética"
            ],
            "unspsc_prefixes": ["3911", "2611", "2610", "3912"],
            "weight": 1.25
        },
        "obra_civil_general": {
            "name": "Construcción & Obra Civil General",
            "keywords": [
                "obra civil", "obras civiles", "adecuación de infraestructura",
                "adecuacion de infraestructura", "construcción de sede", "construccion de sede",
                "edificación", "edificacion", "pavimentación", "mantenimiento de vías",
                "hospital", "colegio", "escuela", "escenarios deportivos", "parque"
            ],
            "unspsc_prefixes": ["7212", "7214", "7215"],
            "weight": 1.0
        }
    }

    def __init__(self):
        # Compile case-insensitive regex patterns for fast matching
        self.patterns = {}
        for sector_key, sector_data in self.TAXONOMIES.items():
            regexes = [re.compile(rf"\b{re.escape(kw)}\b", re.IGNORECASE) for kw in sector_data["keywords"]]
            self.patterns[sector_key] = regexes

    def enrich(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enriches a raw SECOP II record with extracted sectors, materials, opportunity stage, and quality score.
        """
        text_corpus = " ".join([
            str(record.get("nombre_del_procedimiento") or ""),
            str(record.get("descripci_n_del_procedimiento") or ""),
            str(record.get("categorias_adicionales") or ""),
        ]).lower()

        cat_code = str(record.get("codigo_principal_de_categoria") or "").strip()

        # 1. Match Sectors & Extract Detected Materials
        matched_sectors = []
        all_detected_materials = []
        sector_scores = {}

        for sector_key, sector_data in self.TAXONOMIES.items():
            matched_keywords = []
            for pattern, kw_str in zip(self.patterns[sector_key], sector_data["keywords"]):
                if pattern.search(text_corpus):
                    matched_keywords.append(kw_str)

            # Check category code bonus
            has_cat_match = any(cat_code.startswith(prefix) for prefix in sector_data["unspsc_prefixes"])

            if matched_keywords or has_cat_match:
                score = len(matched_keywords) * 15 * sector_data["weight"]
                if has_cat_match:
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
        price = self._parse_price(record)
        contractor_info = self._extract_contractor_info(record)

        # 4. Compute Overall Lead Quality Score (0 - 100)
        lead_score = self._compute_lead_score(matched_sectors, price, stage_info, contractor_info)

        # 5. Extract Direct Document Links
        url_proceso = self._extract_url(record.get("urlproceso"))

        return {
            "id": record.get("id_del_proceso") or record.get("referencia_del_proceso"),
            "referencia": record.get("referencia_del_proceso"),
            "entidad": record.get("entidad"),
            "nit_entidad": record.get("nit_entidad"),
            "departamento": record.get("departamento_entidad"),
            "ciudad": record.get("ciudad_entidad"),
            "precio": price,
            "precio_formateado": f"${price:,.0f} COP",
            "modalidad": record.get("modalidad_de_contratacion"),
            "tipo_contrato": record.get("tipo_de_contrato"),
            "descripcion": record.get("descripci_n_del_procedimiento") or record.get("nombre_del_procedimiento"),
            "fecha_publicacion": record.get("fecha_de_publicacion_del"),
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

    def _parse_price(self, record: Dict[str, Any]) -> float:
        """Parses price, reconciles clerical 3-zero typos between base price and awarded price."""
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
            # Detect 3-zero typo where base price was entered in thousands or cents
            if p_base > (p_adj * 100):
                return p_adj
            return p_adj

        # If base price has extreme clerical typo (e.g. municipal clerk enters $100B for small local contract)
        if p_base > 50_000_000_000:
            modalidad = str(record.get("modalidad_de_contratacion", "")).lower()
            tipo = str(record.get("tipo_de_contrato", "")).lower()
            # If not a mega-infrastructure tender, check for 1000x multiplier typo
            if "licitación pública" not in modalidad and "obra" not in tipo:
                return p_base / 1000.0

        return p_base

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

    def _extract_url(self, raw_url: Any) -> str:
        """Extracts URL string from SODA response dict or string format."""
        if isinstance(raw_url, dict):
            return raw_url.get("url", "")
        if isinstance(raw_url, str):
            return raw_url
        return ""
