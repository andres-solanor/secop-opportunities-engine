"""
Reporte de descubrimiento: qué hay en lo que el tablero no muestra.

Agrupa los procesos sin clasificar por familia UNSPSC (los 4 primeros dígitos del código) con
conteo, valor, términos más frecuentes y ejemplos. Es la evidencia para decidir qué sectores
nuevos agregar a config/taxonomy.json. Todas las cifras salen de los datos de la corrida.

No se traducen los códigos UNSPSC a nombres: el catálogo oficial no está en el repositorio,
así que cada familia se describe con sus propios términos y ejemplos.
"""

import re
from collections import Counter
from typing import Any, Dict, List, Optional

TOP_FAMILIES = 40
TERMS_PER_FAMILY = 8
EXAMPLES_PER_FAMILY = 2
EXAMPLE_MAX = 130

# Palabras que aparecen en casi cualquier objeto contractual y no distinguen un sector.
STOPWORDS = frozenset("""
    para como entre sobre desde hasta este esta estos estas según segun cada todo toda todos todas
    contratar contratacion contratación contrato prestar prestacion prestación servicio servicios
    suministro suministrar adquisicion adquisición adquirir compra compraventa realizar ejecutar
    ejecucion ejecución municipio municipal departamento departamental distrito alcaldia alcaldía
    gobernacion gobernación entidad institucion institución nacional publica pública publico público
    proceso objeto acuerdo conforme mediante través traves cuenta fines necesidades requeridos
    requeridas requerida requerido diferentes general generales demas demás incluye incluido
    vigencia año anos años parte dentro marco cumplimiento desarrollo actividades programa proyecto
    sede sedes zona area área urbana rural tecnicas técnicas especificaciones condiciones
""".split())


def family_of(unspsc: Optional[str]) -> str:
    return unspsc[:4] if unspsc else "sin código"


def top_terms(descriptions: List[str], limit: int = TERMS_PER_FAMILY) -> List[str]:
    """Palabras más repetidas: cuenta en cuántos procesos aparece cada una, no cuántas veces."""
    counts: Counter = Counter()
    for text in descriptions:
        words = set(re.findall(r"[a-záéíóúüñ]{4,}", (text or "").lower()))
        counts.update(words - STOPWORDS)
    return [word for word, n in counts.most_common(limit) if n > 1]


def group_by_family(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Familias UNSPSC de mayor a menor número de procesos."""
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        groups.setdefault(family_of(item.get("unspsc")), []).append(item)

    out = []
    for family, members in groups.items():
        members = sorted(members, key=lambda x: x.get("precio") or 0, reverse=True)
        descriptions = [m.get("descripcion") or "" for m in members]
        out.append({
            "familia": family,
            "procesos": len(members),
            "valor": sum(m.get("precio") or 0 for m in members),
            "adjudicados": sum(1 for m in members if "adjudicado" in (m.get("etapa_comercial") or "").lower()),
            "terminos": top_terms(descriptions),
            "ejemplos": [d[:EXAMPLE_MAX].strip() for d in descriptions[:EXAMPLES_PER_FAMILY] if d],
        })
    return sorted(out, key=lambda g: (-g["procesos"], -g["valor"]))


def group_by_contract_type(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Segunda vista para lo que no trae código UNSPSC: por tipo de contrato.

    La mayoría de los procesos recién publicados llegan con el código 'UNSPECIFIED', así que
    la familia UNSPSC no alcanza para describirlos.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        groups.setdefault(item.get("tipo_contrato") or "(sin tipo)", []).append(item)
    out = [{
        "tipo": kind,
        "procesos": len(members),
        "valor": sum(m.get("precio") or 0 for m in members),
        "terminos": top_terms([m.get("descripcion") or "" for m in members]),
    } for kind, members in groups.items()]
    return sorted(out, key=lambda g: (-g["procesos"], -g["valor"]))


def frequent_phrases(items: List[Dict[str, Any]], limit: int = 40, min_count: int = 5) -> List[Dict[str, Any]]:
    """Frases de dos palabras más repetidas (en cuántos procesos aparecen y cuánto suman).

    Una frase como "aire acondicionado" o "equipos cómputo" nombra un sector mejor que una
    palabra suelta. Las dos palabras deben ir seguidas en el texto y ninguna ser genérica.
    """
    counts: Counter = Counter()
    values: Dict[str, float] = {}
    for item in items:
        words = re.findall(r"[a-záéíóúüñ]+", (item.get("descripcion") or "").lower())
        phrases = {
            f"{a} {b}" for a, b in zip(words, words[1:], strict=False)
            if len(a) >= 4 and len(b) >= 4 and a not in STOPWORDS and b not in STOPWORDS
        }
        counts.update(phrases)
        for phrase in phrases:
            values[phrase] = values.get(phrase, 0) + (item.get("precio") or 0)
    return [
        {"frase": phrase, "procesos": n, "valor": values[phrase]}
        for phrase, n in counts.most_common(limit) if n >= min_count
    ]


def millions(value: float) -> str:
    """$1.234 millones, con punto de miles como se escribe en Colombia."""
    return f"${value / 1_000_000:,.0f}".replace(",", ".") + " M"


def cell(text: str) -> str:
    return (text or "").replace("|", "/").replace("\n", " ")


def render_report(
    counts: Dict[str, Any],
    families: List[Dict[str, Any]],
    generated_at: str,
    window_days: int,
    universe: Optional[Dict[str, Any]] = None,
    queries: Optional[List[Dict[str, Any]]] = None,
    contract_types: Optional[List[Dict[str, Any]]] = None,
    phrases: Optional[List[Dict[str, Any]]] = None,
    unspsc_coverage: Optional[Dict[str, Any]] = None,
) -> str:
    """Markdown del reporte. `counts` viene de `curation.funnel_counts`."""
    lines = [
        "# Lo que el tablero no muestra",
        "",
        f"Generado: {generated_at}. Archivo generado por el pipeline: no editar a mano.",
        "",
        "## Embudo de la corrida",
        "",
        "| Grupo | Procesos |",
        "|---|---:|",
        f"| Descargados de SECOP II | {counts['descargados']} |",
        f"| Filas repetidas del mismo portafolio (otras fases) | {counts['duplicados']} |",
        f"| Rechazados por el filtro de ruido | {counts['rechazados']} |",
        f"| **Sin clasificar** (pasan el filtro, ningún sector coincide) | **{counts['sin_clasificar']}** |",
        f"| Clasificados en un sector | {counts['clasificados']} |",
        f"| &nbsp;&nbsp;En el tablero | {counts['en_tablero']} |",
        f"| &nbsp;&nbsp;Fuera del corte (clasificados que no entraron al tablero) | {counts['fuera_de_corte']} |",
    ]
    if "convenios_abiertos" in counts:
        lines += [
            f"| Convenios abiertos con entidades sin ánimo de lucro, fuera del tablero "
            f"(de los clasificados: {counts['convenios_abiertos_clasificados']}) | {counts['convenios_abiertos']} |",
        ]
    lines.append("")

    if queries:
        lines += ["## Consultas a SECOP II", "", "| Consulta | Estado | Filas | Llegó al tope |", "|---|---|---:|---|"]
        for q in queries:
            lines.append(f"| `{q['nombre']}` | {q['estado']} | {q['registros']} | {'sí' if q.get('truncada') else 'no'} |")
        lines += ["", "Una consulta que llega al tope dejó procesos sin descargar.", ""]

    lines += ["## Por qué se rechazó lo rechazado", "", "| Motivo | Procesos |", "|---|---:|"]
    for reason, n in counts["rechazados_por_motivo"].items():
        lines.append(f"| {reason} | {n} |")
    lines.append("")

    if universe:
        lines += [
            f"## Universo publicado en los últimos {universe['dias']} días",
            "",
            f"Procesos de {millions(universe['precio_min'])} o más publicados desde {universe['desde']}: **{universe['total']}** "
            "(conteo hecho en el servidor de datos.gov.co, incluye lo que no se descarga).",
            "",
            "| Tipo de contrato | Procesos |",
            "|---|---:|",
        ]
        lines += [f"| {cell(r['valor'])} | {r['procesos']} |" for r in universe["por_tipo_contrato"]]
        lines += ["", "| Modalidad | Procesos |", "|---|---:|"]
        lines += [f"| {cell(r['valor'])} | {r['procesos']} |" for r in universe["por_modalidad"]]
        lines.append("")

    if unspsc_coverage and unspsc_coverage.get("semanas"):
        lines += [
            "## Procesos con código UNSPSC, por semana de publicación",
            "",
            f"Procesos de {millions(unspsc_coverage['precio_min'])} o más, contados en el servidor. Desde el "
            "2026-09-15 SECOP II publica casi todos sin código (docs/PLAN_ITERACIONES.md, A10): esta tabla "
            "dice si vuelve.",
            "",
            "| Semana (lunes) | Procesos | Con código | % |",
            "|---|---:|---:|---:|",
        ]
        for w in unspsc_coverage["semanas"]:
            pct = round(100 * w["con_codigo"] / w["procesos"]) if w["procesos"] else 0
            lines.append(f"| {w['semana']} | {w['procesos']} | {w['con_codigo']} | {pct} % |")
        lines.append("")

    shown = families[:TOP_FAMILIES]
    lines += [
        "## Sin clasificar, por familia UNSPSC",
        "",
        f"Procesos publicados o adjudicados en los últimos {window_days} días. "
        f"Se muestran {len(shown)} de {len(families)} familias, de mayor a menor número de procesos. "
        "Cada familia es candidata a sector nuevo en `config/taxonomy.json`.",
        "",
        "| Familia UNSPSC | Procesos | Adjudicados | Valor | Términos frecuentes | Ejemplos |",
        "|---|---:|---:|---:|---|---|",
    ]
    for g in shown:
        examples = " · ".join(cell(e) for e in g["ejemplos"])
        lines.append(
            f"| {g['familia']} | {g['procesos']} | {g['adjudicados']} | {millions(g['valor'])} | "
            f"{', '.join(g['terminos'])} | {examples} |"
        )
    lines.append("")

    if contract_types:
        without_code = sum(g["procesos"] for g in contract_types)
        lines += [
            "## Sin clasificar y sin código UNSPSC, por tipo de contrato",
            "",
            f"{without_code} de los {counts['sin_clasificar']} procesos sin clasificar no traen código UNSPSC "
            "(SECOP II los publica como `UNSPECIFIED`), así que la tabla anterior no los describe.",
            "",
            "| Tipo de contrato | Procesos | Valor | Términos frecuentes |",
            "|---|---:|---:|---|",
        ]
        lines += [
            f"| {cell(g['tipo'])} | {g['procesos']} | {millions(g['valor'])} | {', '.join(g['terminos'])} |"
            for g in contract_types
        ]
        lines.append("")

    if phrases:
        lines += [
            "## Frases más frecuentes en lo sin clasificar",
            "",
            "Frases de dos palabras y en cuántos procesos aparecen. Sirven como palabras clave de un sector nuevo.",
            "",
            "| Frase | Procesos | Valor |",
            "|---|---:|---:|",
        ]
        lines += [f"| {cell(p['frase'])} | {p['procesos']} | {millions(p['valor'])} |" for p in phrases]
        lines.append("")
    return "\n".join(lines)
