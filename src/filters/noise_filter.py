"""
Noise Elimination Filter for SECOP II
Filters out individual personnel contracts (OPS), micro-direct contracts,
and non-commercial administrative overhead to isolate true high-value business opportunities.
"""

from typing import Any, Dict, Optional, Tuple


class NoiseFilter:
    """Evaluates SECOP II records to separate noise from commercial signal."""

    DEFAULT_MIN_BUDGET = 50_000_000  # 50 million COP minimum threshold

    ALLOWED_MODALITIES = {
        "licitación pública",
        "licitacion publica",
        "selección abreviada menor cuantía",
        "seleccion abreviada menor cuantia",
        "selección abreviada de menor cuantía",
        "subasta",
        "subasta inversa",
        "concurso de méritos",
        "concurso de meritos",
        "régimen especial",
        "regimen especial",
        "contratación mínima cuantía",
        "contratacion minima cuantia",
    }

    BLOCKED_CONTRACT_TYPES = {
        "prestación de servicios",
        "prestacion de servicios",
    }

    BLOCKED_UNSPSC_PREFIXES = (
        "8010",  # Management advisory services
        "8011",  # Human resources services
        "8012",  # Legal services
        "8014",  # Marketing and distribution
        "8016",  # Business administration services
    )

    BLOCKED_STATES = {
        "cancelado",
        "desierto",
        "anulado",
        "terminado sin liquidar",
        "cerrado",
    }

    def __init__(self, min_budget: float = DEFAULT_MIN_BUDGET, allow_high_value_direct: bool = True):
        self.min_budget = min_budget
        self.allow_high_value_direct = allow_high_value_direct

    def evaluate(self, record: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """
        Determines whether a process record passes the noise filter.
        Returns:
            (passes: bool, rejection_reason: Optional[str])
        """
        # 0. Check Procedure State (Reject Cancelled/Deserted)
        state = str(record.get("estado_del_procedimiento", "")).lower().strip()
        if any(blocked in state for blocked in self.BLOCKED_STATES):
            return False, f"Procedure state is non-viable: {state}"

        # 1. Budget Floor
        raw_price = record.get("precio_base") or record.get("valor_total_adjudicacion") or 0
        try:
            price = float(raw_price)
        except (ValueError, TypeError):
            price = 0.0

        if price < self.min_budget:
            return False, f"Price below threshold: ${price:,.0f} COP < ${self.min_budget:,.0f} COP"

        # 2. Check Contract Type for OPS (Hard block Prestación de Servicios unconditionally)
        contract_type = str(record.get("tipo_de_contrato", "")).lower().strip()
        modality = str(record.get("modalidad_de_contratacion", "")).lower().strip()
        description = str(record.get("descripci_n_del_procedimiento", "")).lower()
        title = str(record.get("nombre_del_procedimiento", "")).lower()

        # Hard reject all Prestación de Servicios
        if any(blocked in contract_type for blocked in self.BLOCKED_CONTRACT_TYPES):
            return False, f"Hard blocked OPS: Prestación de servicios ({contract_type})"

        # Hard reject common individual personnel phrasing
        blocked_phrases = [
            "prestar servicios profesionales",
            "prestar los servicios profesionales",
            "apoyo a la gestión",
            "apoyo a la gestion",
            "asesoría jurídica",
            "asesoria juridica",
            "médico especialista",
            "neurólogo",
            "persona natural",
        ]
        if any(phrase in description for phrase in blocked_phrases) or any(phrase in title for phrase in blocked_phrases):
            return False, "Identified as individual professional service (OPS)"

        # 3. UNSPSC Category Guard
        cat_code = str(record.get("codigo_principal_de_categoria", "")).strip()
        if any(cat_code.startswith(prefix) for prefix in self.BLOCKED_UNSPSC_PREFIXES):
            # If contract type is also services or direct, reject
            if "directa" in modality or "servicios" in contract_type:
                return False, f"Identified as administrative personnel overhead (UNSPSC {cat_code})"

        # 4. Modality Check
        is_allowed_modality = self.is_commercial_modality(modality)
        if not is_allowed_modality:
            if "directa" in modality:
                # Allow only if it is a major high-value procurement (> 3x min_budget) and NOT personal services
                if self.allow_high_value_direct and price >= (self.min_budget * 3):
                    pass
                else:
                    return False, f"Rejected non-competitive modality: {modality}"
            else:
                return False, f"Rejected modality: {modality}"

        return True, None

    def is_commercial_modality(self, modality_str: str) -> bool:
        """Checks if the modality matches commercial procurement standards."""
        mod = modality_str.lower().strip()
        for allowed in self.ALLOWED_MODALITIES:
            if allowed in mod:
                return True
        return False
