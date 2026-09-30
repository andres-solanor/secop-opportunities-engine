"""
Curaduría: de los procesos descargados a lo que se publica, sin perder nada de vista.

Cada proceso descargado termina en exactamente uno de estos grupos:

  - duplicados:      otra fila del mismo portafolio (SECOP publica una fila por fase).
  - rechazados:      descartados por el filtro de ruido, con su motivo.
  - sin clasificar:  pasan el filtro pero no coinciden con ningún sector.
  - clasificados:    coinciden con al menos un sector. De estos, `select_curated` elige los
                     que van al tablero; el resto queda "fuera del corte".

`funnel_counts` devuelve esas cifras y `check_funnel` verifica que sumen lo descargado.
"""

import re
from collections import Counter
from typing import Any, Dict, List, Tuple

from src.enrichers.scope_extractor import ScopeExtractor
from src.filters.noise_filter import NoiseFilter, reason_group
from src.taxonomy import SIN_CLASIFICAR, SIN_CLASIFICAR_NAME

DESCRIPTION_MAX = 240


def is_awarded(item: Dict[str, Any]) -> bool:
    return "adjudicado" in (item.get("etapa_comercial") or "").lower()


def _portfolio_rank(record: Dict[str, Any]) -> Tuple[int, int]:
    """La fila adjudicada gana; si no, la más reciente (el consecutivo del id crece con cada fase)."""
    awarded = str(record.get("adjudicado") or "").strip().lower() == "si"
    digits = re.sub(r"\D", "", str(record.get("id_del_proceso") or ""))
    return (int(awarded), int(digits) if digits else 0)


def dedupe_by_portfolio(records: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Deja una fila por portafolio (`id_del_portafolio`), la de la fase más avanzada.

    Dos procesos distintos con el mismo valor y entidad NO se unen: solo cuenta el portafolio.
    Los registros sin portafolio se conservan todos.
    """
    best: Dict[str, Dict[str, Any]] = {}
    kept: List[Dict[str, Any]] = []
    for record in records:
        portfolio = record.get("id_del_portafolio")
        if not portfolio:
            kept.append(record)
        elif portfolio not in best or _portfolio_rank(record) > _portfolio_rank(best[portfolio]):
            best[portfolio] = record
    chosen = {id(r) for r in best.values()}
    ordered = [r for r in records if id(r) in chosen or not r.get("id_del_portafolio")]
    return ordered, len(records) - len(ordered)


def classify(
    records: List[Dict[str, Any]],
    noise_filter: NoiseFilter,
    extractor: ScopeExtractor,
) -> Dict[str, Any]:
    """Reparte los procesos descargados en los grupos del embudo."""
    unique, duplicates = dedupe_by_portfolio(records)
    classified: List[Dict[str, Any]] = []
    unclassified: List[Dict[str, Any]] = []
    rejected: Counter = Counter()

    for record in unique:
        passes, reason = noise_filter.evaluate(record)
        if not passes:
            rejected[reason_group(reason)] += 1
            continue
        enriched = extractor.enrich(record)
        (classified if enriched["sectores"] else unclassified).append(enriched)

    for group in (classified, unclassified):
        group.sort(key=lambda x: (x["score_calidad"], x["precio"]), reverse=True)
    return {
        "descargados": len(records),
        "duplicados": duplicates,
        "rechazados": dict(rejected.most_common()),
        "classified": classified,
        "unclassified": unclassified,
    }


def select_curated(
    classified: List[Dict[str, Any]],
    target_count: int = 150,
    awarded_quota: int = 65,
    open_quota: int = 85,
) -> List[Dict[str, Any]]:
    """Elige lo que va al tablero, equilibrando adjudicados (Radar B2B) y abiertos (Observatorio).

    `classified` debe venir ordenado de mayor a menor puntaje.
    """
    selected: List[Dict[str, Any]] = []
    selected_ids = set()

    def add_from(source: List[Dict[str, Any]], quota: int) -> None:
        count = 0
        for item in source:
            if count >= quota or len(selected) >= target_count:
                break
            if item["id"] not in selected_ids:
                selected.append(item)
                selected_ids.add(item["id"])
                count += 1

    add_from([i for i in classified if is_awarded(i)], awarded_quota)
    add_from([i for i in classified if not is_awarded(i)], open_quota)
    add_from(classified, target_count)  # completa si algún grupo no llenó su cupo

    selected.sort(key=lambda x: (x["score_calidad"], x["precio"]), reverse=True)
    return selected


def light_record(item: Dict[str, Any], motivo: str) -> Dict[str, Any]:
    """Versión liviana de una oportunidad para la vista "fuera del tablero".

    No lleva cruces con contratos ni otras fuentes: es para revisar y decidir sectores nuevos.
    `motivo` es 'sin_sector' o 'fuera_de_corte'.
    """
    description = item.get("descripcion") or ""
    if len(description) > DESCRIPTION_MAX:
        description = description[:DESCRIPTION_MAX].rstrip() + "…"
    sectors = item.get("sectores") or [{"id": SIN_CLASIFICAR, "name": SIN_CLASIFICAR_NAME}]
    return {
        "id": item.get("id"),
        "referencia": item.get("referencia"),
        "motivo": motivo,
        "entidad": item.get("entidad"),
        "departamento": item.get("departamento"),
        "ciudad": item.get("ciudad"),
        "precio": item.get("precio"),
        "precio_formateado": item.get("precio_formateado"),
        "modalidad": item.get("modalidad"),
        "tipo_contrato": item.get("tipo_contrato"),
        "descripcion": description,
        "unspsc": item.get("unspsc"),
        "etapa_comercial": item.get("etapa_comercial"),
        "estado_secop": item.get("estado_secop"),
        "fecha_publicacion": item.get("fecha_publicacion"),
        "cierre_ofertas": (item.get("fechas") or {}).get("cierre_ofertas"),
        "sectores": [{"id": s["id"], "name": s["name"]} for s in sectors],
        "url_secop": item.get("url_secop"),
    }


def build_hidden(funnel: Dict[str, Any], curated: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Todo lo que pasó el filtro de ruido pero no está en el tablero."""
    curated_ids = {p["id"] for p in curated}
    overflow = [p for p in funnel["classified"] if p["id"] not in curated_ids]
    return (
        [light_record(p, "sin_sector") for p in funnel["unclassified"]]
        + [light_record(p, "fuera_de_corte") for p in overflow]
    )


def funnel_counts(funnel: Dict[str, Any], curated: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Cifras del embudo para el panel de sincronización y el reporte."""
    classified = len(funnel["classified"])
    return {
        "descargados": funnel["descargados"],
        "duplicados": funnel["duplicados"],
        "rechazados": sum(funnel["rechazados"].values()),
        "rechazados_por_motivo": funnel["rechazados"],
        "sin_clasificar": len(funnel["unclassified"]),
        "clasificados": classified,
        "en_tablero": len(curated),
        "fuera_de_corte": classified - len(curated),
    }


def check_funnel(counts: Dict[str, Any]) -> None:
    """Nada puede desaparecer sin quedar contado."""
    total = counts["duplicados"] + counts["rechazados"] + counts["sin_clasificar"] + counts["clasificados"]
    if total != counts["descargados"]:
        raise AssertionError(f"El embudo no suma: {total} contados de {counts['descargados']} descargados")
    if counts["en_tablero"] + counts["fuera_de_corte"] != counts["clasificados"]:
        raise AssertionError("El tablero y lo que quedó fuera del corte no suman los clasificados")
