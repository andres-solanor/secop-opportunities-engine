"""
Un adaptador por endpoint de Croma. La forma cruda de la API vive aquí y en ningún otro lado.

Rutas y campos verificados contra la API real en la hackatón (`andres-solanor/croma-hackaton`,
`src/endpoints.js` e `INCIDENTS.md`). Ojo: la documentación de Croma a veces anuncia campos que la
respuesta no trae (INC-03, Contaduría); se leen los reales y los documentados quedan de respaldo.

`found: false` es un dato, no un error. Un adaptador devuelve None cuando la consulta no se hizo
(documento inválido, endpoint caído, trabajo sin resolver): eso es "sin revisar", nunca "limpio".

Antecedentes penales (Policía) no se consultan: son dato personal sensible (Ley 1581 de 2012).
"""

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

PATHS = {
    "rues_entity_by_nit": "/co/rues/entity-by-nit/v1",
    "secop_sanctions_by_provider": "/co/secop/sanctions-by-provider/v1",
    "procuraduria": "/co/procuraduria/disciplinary-records/v1",
    "contraloria": "/co/contraloria/fiscal-records/v1",
    "contaduria": "/co/contaduria/state-delinquent-debtors/v1",
}

SOURCES = {
    "SECOP": "SECOP — Colombia Compra Eficiente",
    "RUES": "RUES — Registro Único Empresarial y Social",
    "PROCURADURIA": "Procuraduría General de la Nación (SIRI)",
    "CONTRALORIA": "Contraloría General de la República (SIBOR)",
    "CONTADURIA": "Contaduría General de la Nación (BDME)",
}

# RUES trae documentos truncados ("4831") o vacíos en las partes relacionadas. Mandarlos cuesta
# una petición para recibir un 400 (INC-05 e INC-07): se validan antes.
_PERSON_DOC = re.compile(r"^\d{5,12}$")
_NIT = re.compile(r"^\d{5,15}$")


def is_valid_person_document(doc: Any) -> bool:
    return bool(_PERSON_DOC.match(str(doc or "").strip()))


def normalize_nit(raw: Any) -> Optional[str]:
    """'900.123.456-7' → '900123456' (sin dígito de verificación). None si no parece un NIT."""
    text = str(raw or "").strip()
    if "-" in text:
        text = text.split("-", 1)[0]
    digits = re.sub(r"[.\s]", "", text)
    return digits if _NIT.match(digits) else None


def mask_documents(text: Any) -> Optional[str]:
    """Quita números de documento de los mensajes oficiales: la cita sirve sin la cédula."""
    if text is None:
        return None
    return re.sub(r"\d{5,}", "[documento]", str(text))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def rues_entity_by_nit(client, nit: str) -> Optional[Dict[str, Any]]:
    """Registro mercantil: matrícula, CIIU, contacto comercial, estados financieros y partes relacionadas."""
    data = client.call(PATHS["rues_entity_by_nit"], {"document_number": str(nit)})
    if data is None:
        return None
    e = data.get("entity") or {}
    return {
        "found": bool(data.get("found")),
        "nit": e.get("nit") or str(nit),
        "name": e.get("name"),
        "chamber_name": e.get("chamber_name"),
        "registration_status": e.get("registration_status"),
        "registration_date": e.get("registration_date"),
        "primary_activity": e.get("primary_activity"),
        "commercial_address": e.get("commercial_address"),
        "commercial_email": e.get("commercial_email"),
        "commercial_phones": e.get("commercial_phones") or [],
        "financials": [
            {
                "year": f.get("year"),
                "total_assets": f.get("total_assets"),
                "total_liabilities": f.get("total_liabilities"),
                "equity": f.get("equity"),
                "period_result": f.get("period_result"),
            }
            for f in data.get("financials") or []
        ],
        "renewals": [{"year": r.get("year"), "renewal_date": r.get("renewal_date")} for r in data.get("renewals") or []],
        "related_parties": [
            {"document_number": p.get("document_number"), "name": p.get("name"), "role": p.get("role")}
            for p in data.get("related_parties") or []
        ],
        "source": SOURCES["RUES"],
        "checked_at": _now_iso(),
    }


def secop_sanctions_by_provider(client, document: str) -> Optional[Dict[str, Any]]:
    """Multas y sanciones registradas en SECOP contra un contratista."""
    data = client.call(PATHS["secop_sanctions_by_provider"], {"document_number": str(document)})
    if data is None:
        return None
    return {
        "count": data.get("count") or 0,
        "sanctions": [
            {
                "entity": s.get("entity"),
                "resolution_number": s.get("resolution_number"),
                "contract_number": s.get("contract_number"),
                "sanction_value": s.get("sanction_value"),
                "published_date": s.get("published_date"),
                "url": s.get("url"),
            }
            for s in data.get("sanctions") or []
        ],
        "source": SOURCES["SECOP"],
        "checked_at": _now_iso(),
    }


def procuraduria(client, document: str, document_type: str = "CC") -> Optional[Dict[str, Any]]:
    if not is_valid_person_document(document):
        return None
    data = client.call(PATHS["procuraduria"], {"document_number": str(document), "document_type": document_type})
    if data is None:
        return None
    return {
        "found": bool(data.get("found")),
        "has_records": bool(data.get("has_records")),
        "status": mask_documents(data.get("status")),
        "records": data.get("records") or [],
        "source": SOURCES["PROCURADURIA"],
        "checked_at": _now_iso(),
    }


def contraloria(client, document: str, document_type: str = "CC") -> Optional[Dict[str, Any]]:
    if not is_valid_person_document(document):
        return None
    data = client.call(PATHS["contraloria"], {"document_number": str(document), "document_type": document_type})
    if data is None:
        return None
    return {
        "found": bool(data.get("found")),
        "is_fiscal_responsible": bool(data.get("is_fiscal_responsible")),
        "verification_code": data.get("verification_code"),
        "certified_at": data.get("certified_at"),
        "source": SOURCES["CONTRALORIA"],
        "checked_at": _now_iso(),
    }


def contaduria(client, document: str, document_type: str = "CC") -> Optional[Dict[str, Any]]:
    """Boletín de Deudores Morosos del Estado. La respuesta real no usa los nombres documentados (INC-03)."""
    if not is_valid_person_document(document):
        return None
    data = client.call(PATHS["contaduria"], {"document_number": str(document), "document_type": document_type})
    if data is None:
        return None
    moroso = data.get("deudor_moroso") or {}
    acuerdos = data.get("incumplimiento_acuerdos") or {}
    delinquent = moroso.get("reported")
    if delinquent is None:
        delinquent = data.get("delinquent_to_state", False)
    default = acuerdos.get("reported")
    if default is None:
        default = data.get("payment_agreement_default", False)
    return {
        "delinquent_to_state": bool(delinquent),
        "payment_agreement_default": bool(default),
        "delinquent_message": mask_documents(moroso.get("message")),
        "source": SOURCES["CONTADURIA"],
        "checked_at": _now_iso(),
    }
