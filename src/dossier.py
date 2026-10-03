"""
Dossier por NIT: señales de una empresa para decidir si aliarse con ella o venderle a crédito.

Funciones puras, sin red: reciben lo que devolvieron los adaptadores de Croma
(`src/services/croma_endpoints.py`) y arman las señales. La consulta la hace
`src/tools/croma_dossier.py`.

Criterios heredados de la hackatón de Croma:
- Es una prioridad de revisión, no una acusación. Cada señal dice qué registro oficial dice qué,
  con su fuente y fecha, y lleva su contra-explicación: la razón legítima por la que puede aparecer.
- Lo que no se pudo consultar queda "sin revisar". Nunca se presenta como "sin hallazgos".

Tonos: los mismos de los badges de la web (`risk`, `warn`, `good`, `info`).
"""

from datetime import date
from typing import Any, Dict, List, Optional

from src.services.croma_endpoints import SOURCES, is_valid_person_document

HALLAZGO, SIN_HALLAZGO, SIN_REVISAR = "hallazgo", "sin_hallazgo", "sin_revisar"

AVISO = (
    "Prioridad de revisión, no acusación: cada señal repite lo que dice un registro oficial en la fecha "
    "de consulta. Lo marcado como sin revisar no está limpio: no se pudo consultar."
)

CONTRA = {
    "no_rues": "Puede ser una entidad pública, una persona natural sin matrícula mercantil o un NIT mal escrito.",
    "matricula": "El estado puede cambiar tras una reactivación. Confírmelo en el certificado de existencia y representación.",
    "renovacion": "La renovación vence el 31 de marzo de cada año y el registro puede tardar en actualizarse.",
    "nueva": (
        "Constituirse recientemente es legal y común: solo indica que no hay historial que revisar. "
        "Muchas empresas legítimas contratan con el Estado en su primer año."
    ),
    "sin_financieros": "Solo algunas sociedades están obligadas a reportar estados financieros al registro.",
    "financieros": "Un año con pérdida puede ser una inversión o un año atípico: mire la tendencia de varios años.",
    "sancion": (
        "Una multa puede estar en discusión o haber sido revocada. La fecha importa: "
        "una sanción de hace diez años no dice lo mismo que una reciente."
    ),
    "procuraduria": (
        "El SIRI incluye anotaciones de naturalezas muy distintas, algunas menores o ya cumplidas. "
        "Una anotación no inhabilita por sí sola para contratar."
    ),
    "contraloria": (
        "El boletín admite recursos y exclusiones posteriores: verifique la vigencia con el código de verificación. "
        "Si está vigente puede impedir contratar con el Estado; confírmelo con asesoría jurídica."
    ),
    "contaduria": (
        "La deuda puede no tener relación con la contratación y puede haber un acuerdo de pago vigente. "
        "El reporte puede restringir la contratación con el Estado; confírmelo con asesoría jurídica."
    ),
}


def mask_document(doc: Any) -> str:
    """'1234567890' → '******7890'. El dossier no necesita el documento completo."""
    text = str(doc or "")
    return "*" * max(0, len(text) - 4) + text[-4:]


def money(value: Any) -> str:
    try:
        return "$" + f"{float(value):,.0f}".replace(",", ".")
    except (TypeError, ValueError):
        return "[sin dato]"


def _parse_date(raw: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def _year(raw: Any) -> Optional[int]:
    try:
        return int(str(raw)[:4])
    except ValueError:
        return None


def _signal(id_, frente, tono, estado, titulo, evidencia, fuente, consultado=None, contra=None):
    return {
        "id": id_, "frente": frente, "tono": tono, "estado": estado, "titulo": titulo,
        "evidencia": evidencia, "fuente": fuente, "consultado": consultado, "contra": contra,
    }


def legal_representatives(rues: Optional[Dict[str, Any]], company_nit: str, max_people: int) -> List[Dict[str, Any]]:
    """Representantes legales con documento válido, principales primero.

    Descarta documentos truncados y a la propia sociedad listada como parte relacionada (INC-05).
    """
    if not rues:
        return []
    seen, out = set(), []
    parties = [p for p in rues.get("related_parties") or [] if "representante" in str(p.get("role") or "").lower()]
    parties.sort(key=lambda p: 0 if "principal" in str(p.get("role") or "").lower() else 1)
    for p in parties:
        doc = str(p.get("document_number") or "").strip()
        if not is_valid_person_document(doc) or doc == str(company_nit) or doc in seen:
            continue
        seen.add(doc)
        out.append({"document": doc, "name": p.get("name"), "role": p.get("role")})
        if len(out) >= max_people:
            break
    return out


def company_signals(rues: Optional[Dict[str, Any]], today: date) -> List[Dict[str, Any]]:
    src = SOURCES["RUES"]
    if rues is None:
        return [_signal("rues", "registro", "info", SIN_REVISAR, "Registro mercantil sin revisar",
                        "La consulta al RUES no se hizo o no respondió.", src)]
    when = rues.get("checked_at")
    if not rues.get("found"):
        return [_signal("rues", "registro", "warn", HALLAZGO, "No aparece en el registro mercantil",
                        "El RUES no devolvió una matrícula para este NIT.", src, when, CONTRA["no_rues"])]

    out = []
    status = str(rues.get("registration_status") or "").strip()
    chamber = rues.get("chamber_name")
    where = f" (cámara de {chamber})" if chamber else ""
    if status.upper().startswith("ACTIVA"):
        out.append(_signal("matricula", "registro", "good", SIN_HALLAZGO, "Matrícula activa",
                           f"Estado en el RUES: {status}{where}.", src, when))
    elif status:
        out.append(_signal("matricula", "registro", "risk", HALLAZGO, f"Matrícula {status.lower()}",
                           f"Estado en el RUES: {status}{where}.", src, when, CONTRA["matricula"]))

    years = [y for y in (_year(r.get("year")) for r in rues.get("renewals") or []) if y]
    if years:
        expected = today.year if (today.month, today.day) > (3, 31) else today.year - 1
        last = max(years)
        if last < expected:
            out.append(_signal("renovacion", "registro", "warn", HALLAZGO, f"Última renovación de la matrícula: {last}",
                               f"Se esperaba la renovación de {expected}.", src, when, CONTRA["renovacion"]))
        else:
            out.append(_signal("renovacion", "registro", "good", SIN_HALLAZGO, f"Matrícula renovada en {last}",
                               f"Última renovación registrada: {last}.", src, when))

    registered = _parse_date(rues.get("registration_date"))
    if registered:
        months = (today.year - registered.year) * 12 + today.month - registered.month
        if months < 12:
            out.append(_signal("antiguedad", "registro", "warn", HALLAZGO, f"Matriculada hace {max(months, 0)} meses",
                               f"Fecha de matrícula: {registered.isoformat()}.", src, when, CONTRA["nueva"]))
        else:
            out.append(_signal("antiguedad", "registro", "good", SIN_HALLAZGO, f"Matriculada hace {months // 12} años",
                               f"Fecha de matrícula: {registered.isoformat()}.", src, when))

    out.append(financial_signal(rues.get("financials") or [], today, when))

    contact = [x for x in (rues.get("commercial_email"), ", ".join(rues.get("commercial_phones") or []),
                           rues.get("commercial_address")) if x]
    if contact:
        out.append(_signal("contacto", "contacto", "info", SIN_HALLAZGO, "Contacto comercial registrado",
                           " · ".join(contact), src, when))
    return out


def financial_signal(financials: List[Dict[str, Any]], today: date, when: Optional[str]) -> Dict[str, Any]:
    src = SOURCES["RUES"]
    rows = [f for f in financials if _year(f.get("year"))]
    if not rows:
        return _signal("financieros", "finanzas", "info", SIN_REVISAR, "Sin estados financieros en el registro",
                       "El RUES no trae estados financieros de esta empresa.", src, when, CONTRA["sin_financieros"])
    last = max(rows, key=lambda f: _year(f.get("year")))
    year = _year(last.get("year"))
    assets, liabilities = last.get("total_assets"), last.get("total_liabilities")
    equity, result = last.get("equity"), last.get("period_result")
    parts = [f"activos {money(assets)}", f"pasivos {money(liabilities)}", f"patrimonio {money(equity)}",
             f"resultado {money(result)}"]
    try:
        if float(assets) > 0:
            parts.append(f"endeudamiento {float(liabilities) / float(assets):.0%}")
    except (TypeError, ValueError):
        pass
    evidence = f"{year}: " + ", ".join(parts) + "."
    if year < today.year - 2:
        evidence += f" El último reporte es de {year}."
    if _is_number(equity) and float(equity) <= 0:
        return _signal("financieros", "finanzas", "warn", HALLAZGO, f"Patrimonio negativo o nulo en {year}",
                       evidence, src, when, CONTRA["financieros"])
    if _is_number(result) and float(result) < 0:
        return _signal("financieros", "finanzas", "warn", HALLAZGO, f"Pérdida en {year}",
                       evidence, src, when, CONTRA["financieros"])
    return _signal("financieros", "finanzas", "info", SIN_HALLAZGO, f"Estados financieros de {year}",
                   evidence, src, when)


def _is_number(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def sanction_signal(sanctions: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    src = SOURCES["SECOP"]
    if sanctions is None:
        return _signal("sanciones", "sanciones", "info", SIN_REVISAR, "Sanciones en SECOP sin revisar",
                       "La consulta no se hizo o no respondió.", src)
    when = sanctions.get("checked_at")
    items = sanctions.get("sanctions") or []
    count = max(sanctions.get("count") or 0, len(items))
    if not count:
        return _signal("sanciones", "sanciones", "good", SIN_HALLAZGO, "Sin sanciones registradas en SECOP",
                       "SECOP no devuelve multas ni sanciones contra este NIT.", src, when)
    detail = "; ".join(
        f"{s.get('entity') or 'Entidad sin nombre'}, {str(s.get('published_date') or 'sin fecha')[:10]}, "
        f"{money(s.get('sanction_value'))}"
        for s in items[:5]
    )
    title = "1 sanción registrada en SECOP" if count == 1 else f"{count} sanciones registradas en SECOP"
    return _signal("sanciones", "sanciones", "warn", HALLAZGO, title, detail + ".", src, when, CONTRA["sancion"])


def person_signals(person: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Antecedentes de un representante legal en las tres fuentes oficiales."""
    who = f"{person.get('name') or 'Representante legal'} ({person.get('role') or 'representante legal'})"
    doc = mask_document(person.get("document"))
    out = []

    proc = person.get("procuraduria")
    src = SOURCES["PROCURADURIA"]
    if proc is None:
        out.append(_signal("procuraduria", "antecedentes", "info", SIN_REVISAR, f"{who}: Procuraduría sin revisar",
                           f"Documento {doc}: la consulta no se hizo o no respondió.", src))
    elif proc.get("has_records"):
        out.append(_signal("procuraduria", "antecedentes", "warn", HALLAZGO, f"{who}: antecedente en Procuraduría",
                           f"Documento {doc}: {proc.get('status') or 'tiene anotaciones'}.", src,
                           proc.get("checked_at"), CONTRA["procuraduria"]))
    else:
        out.append(_signal("procuraduria", "antecedentes", "good", SIN_HALLAZGO, f"{who}: sin antecedentes en Procuraduría",
                           f"Documento {doc}: {proc.get('status') or 'sin anotaciones'}.", src, proc.get("checked_at")))

    fiscal = person.get("contraloria")
    src = SOURCES["CONTRALORIA"]
    if fiscal is None:
        out.append(_signal("contraloria", "antecedentes", "info", SIN_REVISAR, f"{who}: Contraloría sin revisar",
                           f"Documento {doc}: la consulta no se hizo o no respondió.", src))
    elif fiscal.get("is_fiscal_responsible"):
        code = fiscal.get("verification_code")
        out.append(_signal("contraloria", "antecedentes", "risk", HALLAZGO, f"{who}: reportado como responsable fiscal",
                           f"Documento {doc}" + (f", código de verificación {code}." if code else "."), src,
                           fiscal.get("checked_at"), CONTRA["contraloria"]))
    else:
        out.append(_signal("contraloria", "antecedentes", "good", SIN_HALLAZGO, f"{who}: no es responsable fiscal",
                           f"Documento {doc}: no aparece en el boletín.", src, fiscal.get("checked_at")))

    debt = person.get("contaduria")
    src = SOURCES["CONTADURIA"]
    if debt is None:
        out.append(_signal("contaduria", "antecedentes", "info", SIN_REVISAR, f"{who}: deudores morosos sin revisar",
                           f"Documento {doc}: la consulta no se hizo o no respondió.", src))
    elif debt.get("delinquent_to_state") or debt.get("payment_agreement_default"):
        what = "deudor moroso del Estado" if debt.get("delinquent_to_state") else "incumplimiento de acuerdo de pago"
        out.append(_signal("contaduria", "antecedentes", "risk", HALLAZGO, f"{who}: reportado en el BDME",
                           f"Documento {doc}: {what}.", src, debt.get("checked_at"), CONTRA["contaduria"]))
    else:
        out.append(_signal("contaduria", "antecedentes", "good", SIN_HALLAZGO, f"{who}: no está en el BDME",
                           f"Documento {doc}: {debt.get('delinquent_message') or 'sin reporte'}.", src,
                           debt.get("checked_at")))
    return out


def build_dossier(
    nit: str,
    rues: Optional[Dict[str, Any]],
    sanctions: Optional[Dict[str, Any]],
    people: Optional[List[Dict[str, Any]]],
    today: date,
    failures: Optional[List[Dict[str, Any]]] = None,
    skipped: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Arma el dossier. `people` es None si no se consultaron antecedentes (modo solo empresa)."""
    signals = company_signals(rues, today) + [sanction_signal(sanctions)]
    if people is None:
        signals.append(_signal("representantes", "antecedentes", "info", SIN_REVISAR,
                               "Antecedentes de representantes legales sin revisar",
                               "Se pidió solo la empresa.", "—"))
    elif not people:
        why = ("El registro mercantil no trajo representantes legales con un documento válido."
               if rues else "No se pudo consultar el RUES, de donde salen los representantes legales.")
        signals.append(_signal("representantes", "antecedentes", "info", SIN_REVISAR,
                               "Antecedentes de representantes legales sin revisar", why, SOURCES["RUES"]))
    else:
        for person in people:
            signals.extend(person_signals(person))

    summary = {tone: sum(1 for s in signals if s["tono"] == tone) for tone in ("risk", "warn", "good", "info")}
    summary["sin_revisar"] = sum(1 for s in signals if s["estado"] == SIN_REVISAR)
    return {
        "nit": nit,
        "empresa": (rues or {}).get("name"),
        "actividad": (rues or {}).get("primary_activity"),
        "fecha": today.isoformat(),
        "aviso": AVISO,
        "resumen": summary,
        "senales": signals,
        "cobertura": {"fallos": failures or [], "omitidas": skipped or []},
    }


TONE_LABEL = {"risk": "RIESGO", "warn": "REVISAR", "good": "OK", "info": "INFO"}


def render_text(dossier: Dict[str, Any]) -> str:
    s = dossier["resumen"]
    act = dossier.get("actividad") or {}
    head = [
        f"Dossier de {dossier.get('empresa') or 'empresa sin nombre en el RUES'} — NIT {dossier['nit']}",
        f"Consulta: {dossier['fecha']}" + (f" · CIIU {act.get('code')} {act.get('description')}" if act.get("code") else ""),
        f"{s['risk']} riesgo · {s['warn']} por revisar · {s['good']} sin hallazgos · {s['sin_revisar']} sin revisar",
        "",
    ]
    lines = []
    for sig in dossier["senales"]:
        lines.append(f"[{TONE_LABEL[sig['tono']]}] {sig['titulo']}")
        lines.append(f"    {sig['evidencia']}")
        lines.append(f"    Fuente: {sig['fuente']}" + (f" · consultado {sig['consultado']}" if sig.get("consultado") else ""))
        if sig.get("contra"):
            lines.append(f"    Contexto: {sig['contra']}")
    cov = dossier["cobertura"]
    tail = [""]
    for f in cov["fallos"]:
        tail.append(f"Sin respuesta: {f['fuente']} — {f['error']}")
    for o in cov["omitidas"]:
        tail.append(f"Omitida: {o['endpoint']} ({o['motivo']})")
    tail.append(dossier["aviso"])
    return "\n".join(head + lines + tail)
