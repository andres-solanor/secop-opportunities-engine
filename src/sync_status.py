"""
Estado de la sincronización con SECOP II.

Cada corrida del pipeline produce un resumen (`meta`) que la web muestra como
"estado de la sincronización": cuándo se ejecutó, cuánto tardó, cuántos procesos
se consultaron, cuántas oportunidades quedaron, cuáles son nuevas, cuáles salieron,
cuáles pasaron a adjudicadas y cómo le fue al cruce con contratos.

"Nueva" significa **nunca vista antes** en la selección curada. Para eso se mantiene
un registro persistente (`data/seen_ids.json`) con la primera vez que se vio cada
proceso; así un proceso que sale del top 150 y vuelve a entrar no se cuenta como nuevo.
"""

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

HISTORY_KEEP = 30
SEEN_RETENTION_DAYS = 180
SCHEDULE_HOUR_UTC = 11  # cron del workflow: 11:00 UTC = 6:00 a. m. en Colombia


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: str, fallback: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def is_awarded(item: Dict[str, Any]) -> bool:
    return "adjudicado" in (item.get("etapa_comercial") or "").lower()


def _event_date(p: Dict[str, Any]) -> Optional[str]:
    """Fecha en que el proceso se volvió oportunidad: adjudicación si está adjudicado, si no publicación."""
    fechas = p.get("fechas") or {}
    date = fechas.get("adjudicacion") if is_awarded(p) else None
    return date or p.get("fecha_publicacion") or fechas.get("publicacion")


def stamp_first_seen(
    prospects: List[Dict[str, Any]],
    seen: Dict[str, Optional[str]],
    previous: List[Dict[str, Any]],
    now: datetime,
    reclassified_since: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    """Marca `primera_vez` y `nueva` en cada oportunidad y devuelve el registro actualizado.

    Si el registro aún no existe (primera corrida con esta función), se siembra con las
    oportunidades de la corrida anterior con fecha desconocida, para no contar como
    nuevas las 150 de golpe.

    `reclassified_since` (fecha ISO de la corrida anterior) se usa cuando cambió la taxonomía:
    muchos procesos entran al tablero solo porque ahora tienen sector. Esos se registran, pero
    solo cuentan como nuevos si se publicaron (o adjudicaron) después de esa corrida.
    """
    registry = dict(seen)
    if not registry:
        registry = {p["id"]: None for p in previous if p.get("id")}

    stamp = iso(now)
    cutoff = (reclassified_since or "")[:19]
    for p in prospects:
        pid = p.get("id")
        if not pid:
            continue
        if pid in registry:
            p["primera_vez"] = registry[pid]
            p["nueva"] = False
        else:
            registry[pid] = stamp
            p["primera_vez"] = stamp
            event = _event_date(p)
            p["nueva"] = not cutoff or bool(event and event[:19] >= cutoff)

    # Poda: se olvidan los procesos vistos por primera vez hace más de SEEN_RETENTION_DAYS días.
    cutoff = iso(now - timedelta(days=SEEN_RETENTION_DAYS))
    current = {p.get("id") for p in prospects}
    return {k: v for k, v in registry.items() if k in current or v is None or v >= cutoff}


def next_scheduled_run(now: datetime) -> str:
    candidate = now.astimezone(timezone.utc).replace(hour=SCHEDULE_HOUR_UTC, minute=0, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return iso(candidate)


def build_meta(
    prospects: List[Dict[str, Any]],
    previous: List[Dict[str, Any]],
    raw_count: int,
    started_at: datetime,
    finished_at: datetime,
    cross: Optional[Dict[str, Any]],
    history: List[Dict[str, Any]],
    extra_sources: Optional[Dict[str, Dict[str, Any]]] = None,
    paa_count: int = 0,
    queries: Optional[List[Dict[str, Any]]] = None,
    funnel: Optional[Dict[str, Any]] = None,
    taxonomy_version: Optional[int] = None,
    reclassified: bool = False,
) -> Dict[str, Any]:
    """Resumen de la corrida para la web y para el historial de sincronizaciones.

    `queries` es el estado de cada consulta de descarga (src/harvest.py) y `funnel` el embudo
    de curaduría (src/curation.py: descargados, rechazados, sin clasificar, en tablero…).
    """
    queries = queries or []
    failed_queries = [q["nombre"] for q in queries if q.get("estado") == "error"]
    if not raw_count:
        process_state = "sin_datos"
    elif failed_queries:
        process_state = "parcial"
    else:
        process_state = "ok"
    prev_by_id = {p.get("id"): p for p in previous if p.get("id")}
    current_ids = {p.get("id") for p in prospects}
    new_ids = [p["id"] for p in prospects if p.get("nueva")]
    newly_awarded = [
        p["id"] for p in prospects
        if is_awarded(p) and p.get("id") in prev_by_id and not is_awarded(prev_by_id[p["id"]])
    ]

    cross = cross or {}
    errors = cross.get("errores") or []
    if not cross:
        cross_state = "sin_datos"
    elif errors and cross.get("reutilizados"):
        cross_state = "parcial"
    elif errors:
        cross_state = "con_errores"
    else:
        cross_state = "ok"

    run = {
        "generated_at": iso(finished_at),
        "started_at": iso(started_at),
        "duracion_s": round((finished_at - started_at).total_seconds(), 1),
        "procesos_consultados": raw_count,
        "curadas": len(prospects),
        "adjudicadas": sum(1 for p in prospects if is_awarded(p)),
        "nuevas": len(new_ids),
        "salieron": len([pid for pid in prev_by_id if pid not in current_ids]),
        "nuevas_adjudicadas": len(newly_awarded),
        "cruce_contratos": cross_state,
        "compras_planeadas": paa_count,
        "fuentes_con_error": [k for k, v in (extra_sources or {}).items() if v.get("estado") == "error"],
    }
    if funnel:
        run["sin_clasificar"] = funnel["sin_clasificar"]
        run["fuera_de_corte"] = funnel["fuera_de_corte"]
    if taxonomy_version is not None:
        run["taxonomia_version"] = taxonomy_version
    if reclassified:
        # La web avisa que las "nuevas" de esta corrida excluyen lo que solo cambió de sector.
        run["reclasificacion"] = True

    return {
        **run,
        "proxima_programada": next_scheduled_run(finished_at),
        "ids_nuevas": new_ids,
        "ids_nuevas_adjudicadas": newly_awarded,
        "embudo": funnel,
        "fuentes": {
            "procesos": {"dataset": "p6dx-8zbt", "estado": process_state, "registros": raw_count,
                         "consultas": queries, "consultas_con_error": failed_queries},
            "contratos": {"dataset": "jbjy-vk9h", "estado": cross_state, **{k: v for k, v in cross.items() if k != "errores"},
                          "errores": errors[:5]},
            **(extra_sources or {}),
        },
        "historial": ([run] + [h for h in history if h.get("generated_at") != run["generated_at"]])[:HISTORY_KEEP],
    }
