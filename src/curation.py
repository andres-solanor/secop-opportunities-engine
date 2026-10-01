"""
Curaduría: de los procesos descargados a lo que se publica, sin perder nada de vista.

Cada proceso descargado termina en exactamente uno de estos grupos:

  - duplicados:      otra fila del mismo portafolio (SECOP publica una fila por fase).
  - rechazados:      descartados por el filtro de ruido, con su motivo.
  - sin clasificar:  pasan el filtro pero no coinciden con ningún sector.
  - clasificados:    coinciden con al menos un sector. De estos, `select_curated` elige los
                     que van al tablero; el resto queda "fuera del corte".

Los convenios con entidades sin ánimo de lucro (`convenio`, ver noise_filter.is_agreement)
que todavía no se adjudican no van al tablero: una empresa no puede ofertar en ellos. Quedan
fuera del tablero con su propio motivo. Adjudicados, sí entran: el operador es un comprador.

`funnel_counts` devuelve esas cifras y `check_funnel` verifica que sumen lo descargado.
"""

import re
from collections import Counter, defaultdict
from typing import Any, Dict, List, Tuple

from src.enrichers.scope_extractor import ScopeExtractor
from src.filters.noise_filter import NoiseFilter, reason_group
from src.taxonomy import SIN_CLASIFICAR, SIN_CLASIFICAR_NAME

DESCRIPTION_MAX = 240

TARGET_COUNT = 500
AWARDED_SHARE = 0.43      # adjudicados (Radar B2B) frente a abiertos (Observatorio): era 65 de 150
PER_SECTOR_MIN = 20       # cada sector conserva al menos esto, aunque otro tenga mejores puntajes
# Nombres de contratista que SECOP o el extractor ponen cuando aún no hay ganador conocido.
EMPTY_CONTRACTOR = {"Pendiente por Adjudicar", "No Definido", "No definido"}


def is_awarded(item: Dict[str, Any]) -> bool:
    return "adjudicado" in (item.get("etapa_comercial") or "").lower()


def is_open_agreement(item: Dict[str, Any]) -> bool:
    """Convenio que aún no se adjudica: nadie en el tablero puede ofertar en él."""
    return bool(item.get("convenio")) and not is_awarded(item)


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
    target_count: int = TARGET_COUNT,
    awarded_share: float = AWARDED_SHARE,
    per_sector_min: int = PER_SECTOR_MIN,
) -> List[Dict[str, Any]]:
    """Elige lo que va al tablero.

    1. Cada sector conserva sus `per_sector_min` mejores: sin esto, un sector grande (obra)
       con mejores puntajes deja sin fichas a los pequeños (acero, HORECA).
    2. Se completan los cupos de adjudicados (Radar B2B) y abiertos (Observatorio).
    3. Si algún grupo no llenó su cupo, se completa por puntaje.

    `classified` debe venir ordenado de mayor a menor puntaje. Los convenios abiertos no entran.
    """
    candidates = [i for i in classified if not is_open_agreement(i)]
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

    by_sector: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in candidates:
        for sector in item["sectores"]:
            by_sector[sector["id"]].append(item)
    for sector_id in sorted(by_sector):
        add_from(by_sector[sector_id], per_sector_min)

    awarded_quota = round(target_count * awarded_share)
    awarded_now = sum(1 for i in selected if is_awarded(i))
    add_from([i for i in candidates if is_awarded(i)], max(0, awarded_quota - awarded_now))
    open_now = len(selected) - sum(1 for i in selected if is_awarded(i))
    add_from([i for i in candidates if not is_awarded(i)], max(0, target_count - awarded_quota - open_now))
    add_from(candidates, target_count)  # completa si algún grupo no llenó su cupo

    selected.sort(key=lambda x: (x["score_calidad"], x["precio"]), reverse=True)
    return selected


def light_record(item: Dict[str, Any], motivo: str) -> Dict[str, Any]:
    """Versión liviana de una oportunidad para la vista "fuera del tablero".

    No lleva cruces con contratos ni otras fuentes: es para revisar y decidir sectores nuevos.
    `motivo` es 'sin_sector', 'fuera_de_corte' o 'convenio'.
    """
    description = item.get("descripcion") or ""
    if len(description) > DESCRIPTION_MAX:
        description = description[:DESCRIPTION_MAX].rstrip() + "…"
    sectors = item.get("sectores") or [{"id": SIN_CLASIFICAR, "name": SIN_CLASIFICAR_NAME}]
    record = {
        "id": item.get("id"),
        "referencia": item.get("referencia"),
        # Llave de contratos y ofertas en SECOP II: el detalle los consulta en vivo con ella.
        "id_portafolio": item.get("id_portafolio"),
        "motivo": motivo,
        "entidad": item.get("entidad"),
        # Para cruzar con el diccionario de entidades (window.ENTITY_STATS) sin copiar sus cifras.
        "nit_entidad": item.get("nit_entidad"),
        "departamento": item.get("departamento"),
        "ciudad": item.get("ciudad"),
        "precio": item.get("precio"),
        "modalidad": item.get("modalidad"),
        "tipo_contrato": item.get("tipo_contrato"),
        "convenio": bool(item.get("convenio")),
        "descripcion": description,
        "unspsc": item.get("unspsc"),
        "etapa_comercial": item.get("etapa_comercial"),
        "estado_secop": item.get("estado_secop"),
        "fecha_publicacion": item.get("fecha_publicacion"),
        "cierre_ofertas": (item.get("fechas") or {}).get("cierre_ofertas"),
        "sectores": [{"id": s["id"], "name": s["name"]} for s in sectors],
        "url_secop": item.get("url_secop"),
    }
    # Solo lo que cambia la decisión en una ficha liviana adjudicada: cuándo y quién ganó. Las
    # abiertas no llevan estas claves. El resto (contrato, ofertas, consorcio) se consulta en
    # vivo al abrir el detalle.
    if is_awarded(item):
        record["fecha_adjudicacion"] = (item.get("fechas") or {}).get("adjudicacion")
        contractor = item.get("contratista") or {}
        if contractor.get("nombre") and contractor["nombre"] not in EMPTY_CONTRACTOR:
            record["contratista"] = {"nombre": contractor["nombre"], "es_consorcio": bool(contractor.get("es_consorcio"))}
    return record


def build_hidden(funnel: Dict[str, Any], curated: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Todo lo que pasó el filtro de ruido pero no está en el tablero."""
    curated_ids = {p["id"] for p in curated}
    overflow = [p for p in funnel["classified"] if p["id"] not in curated_ids]
    return (
        [light_record(p, "convenio" if is_open_agreement(p) else "sin_sector") for p in funnel["unclassified"]]
        + [light_record(p, "convenio" if is_open_agreement(p) else "fuera_de_corte") for p in overflow]
    )


def funnel_counts(funnel: Dict[str, Any], curated: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Cifras del embudo para el panel de sincronización y el reporte.

    `sin_clasificar` y `clasificados` incluyen los convenios abiertos; `convenios_abiertos`
    los cuenta aparte (de ambos grupos) porque salen del tablero por ese motivo.
    """
    classified = len(funnel["classified"])
    open_classified = sum(1 for p in funnel["classified"] if is_open_agreement(p))
    open_unclassified = sum(1 for p in funnel["unclassified"] if is_open_agreement(p))
    return {
        "descargados": funnel["descargados"],
        "duplicados": funnel["duplicados"],
        "rechazados": sum(funnel["rechazados"].values()),
        "rechazados_por_motivo": funnel["rechazados"],
        "sin_clasificar": len(funnel["unclassified"]),
        "clasificados": classified,
        "en_tablero": len(curated),
        "fuera_de_corte": classified - len(curated) - open_classified,
        "convenios_abiertos": open_classified + open_unclassified,
        "convenios_abiertos_clasificados": open_classified,
    }


def check_funnel(counts: Dict[str, Any]) -> None:
    """Nada puede desaparecer sin quedar contado."""
    total = counts["duplicados"] + counts["rechazados"] + counts["sin_clasificar"] + counts["clasificados"]
    if total != counts["descargados"]:
        raise AssertionError(f"El embudo no suma: {total} contados de {counts['descargados']} descargados")
    if counts["en_tablero"] + counts["fuera_de_corte"] + counts["convenios_abiertos_clasificados"] != counts["clasificados"]:
        raise AssertionError("El tablero, lo que quedó fuera del corte y los convenios abiertos no suman los clasificados")
