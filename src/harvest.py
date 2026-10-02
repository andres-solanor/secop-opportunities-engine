"""
Descarga de candidatos desde SECOP II - Procesos (p6dx-8zbt).

Tres tipos de consulta:

  - sector:  una por cada sector de config/taxonomy.json que declare `harvest` (patrones LIKE
             sobre título y descripción). Son obligatorias: si una falla, la corrida se detiene
             y la web conserva los datos de ayer, en vez de publicar un tablero sin un sector.
  - general: procesos publicados en los últimos días, sin palabras clave de sector. Es lo que
             alimenta el grupo "sin clasificar": lo que el motor todavía no sabe nombrar.
  - adjudicadas: procesos adjudicados en los últimos días, para leads B2B recientes.

Los valores de `modalidad_de_contratacion` y `estado_del_procedimiento` usados aquí son los que
existen en el dataset (verificados con `python -m src.tools.probe_sources --valores`). SoQL
compara por igualdad exacta: un valor que no existe devuelve cero filas sin dar error.
"""

from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from src.services.socrata_client import SocrataClient

MIN_PRICE = 50_000_000
SECTOR_WINDOW_DAYS = 120   # los sectores miran más atrás: son pocos procesos y muy relevantes
GENERAL_WINDOW_DAYS = 14   # la descarga general es grande: ~400 procesos por día hábil (2026-10-01)
SECTOR_MAX_ROWS = 3000     # agua y tecnología pasaban de 1000 filas en 120 días (2026-09-30)
# Tras la recarga completa de SECOP II del 2026-10-01, publicados llegó a 4148 filas (83 % del
# tope anterior, 5000) y adjudicados a 2178 (73 % de 3000). Al llegar al tope se pierden los más
# viejos de la ventana: se deja holgura de casi el doble (docs/ESTADO.md, "Recarga de la fuente").
GENERAL_MAX_ROWS = 8000
AWARDED_MAX_ROWS = 5000

# Lo que el filtro de ruido descartaría de todos modos: no vale la pena descargarlo.
GENERAL_EXCLUSIONS = (
    "tipo_de_contrato != 'Prestación de servicios' AND "
    "modalidad_de_contratacion != 'Contratación directa' AND "
    "estado_del_procedimiento not in ('Cancelado', 'Suspendido')"
)

# Desempate por id: sin él, dos páginas consecutivas pueden repetir u omitir filas.
ORDER_PUBLISHED = "fecha_de_publicacion_del DESC, id_del_proceso"
ORDER_AWARDED = "fecha_adjudicacion DESC, id_del_proceso"


class HarvestError(RuntimeError):
    """Falló una consulta obligatoria: no se debe publicar un dataset incompleto."""


def soql_date(day: datetime) -> str:
    return day.strftime("%Y-%m-%dT00:00:00")


def like_clause(column: str, pattern: str) -> str:
    safe = pattern.upper().replace("'", "''")
    return f"upper({column}) like '%{safe}%'"


def sector_where(harvest_cfg: Dict[str, Any], since: datetime) -> str:
    """Consulta de un sector. Incluye los procesos sin fecha de publicación (borradores)."""
    likes = [like_clause("nombre_del_procedimiento", p) for p in harvest_cfg.get("titulo", [])]
    likes += [like_clause("descripci_n_del_procedimiento", p) for p in harvest_cfg.get("descripcion", [])]
    if not likes:
        raise ValueError("harvest sin patrones de título ni de descripción")
    price = int(harvest_cfg.get("precio_min", MIN_PRICE))
    return (
        f"precio_base >= {price} AND ({' OR '.join(likes)}) AND "
        f"(fecha_de_publicacion_del >= '{soql_date(since)}' OR fecha_de_publicacion_del IS NULL)"
    )


def build_queries(taxonomy: Dict[str, Dict[str, Any]], today: datetime) -> List[Dict[str, Any]]:
    queries = []
    sector_since = today - timedelta(days=SECTOR_WINDOW_DAYS)
    for key, sector in taxonomy.items():
        if sector.get("harvest"):
            queries.append({
                "nombre": f"sector:{key}", "tipo": "sector", "obligatoria": True,
                "where": sector_where(sector["harvest"], sector_since),
                "order": ORDER_PUBLISHED, "max_rows": SECTOR_MAX_ROWS,
            })
    general_since = soql_date(today - timedelta(days=GENERAL_WINDOW_DAYS))
    queries.append({
        "nombre": "general:publicados", "tipo": "general", "obligatoria": False,
        "where": f"precio_base >= {MIN_PRICE} AND {GENERAL_EXCLUSIONS} AND fecha_de_publicacion_del >= '{general_since}'",
        "order": ORDER_PUBLISHED, "max_rows": GENERAL_MAX_ROWS,
    })
    queries.append({
        "nombre": "general:adjudicados", "tipo": "adjudicadas", "obligatoria": False,
        "where": f"precio_base >= {MIN_PRICE} AND adjudicado = 'Si' AND {GENERAL_EXCLUSIONS} "
                 f"AND fecha_adjudicacion >= '{general_since}'",
        "order": ORDER_AWARDED, "max_rows": AWARDED_MAX_ROWS,
    })
    return queries


def record_id(record: Dict[str, Any]) -> Optional[str]:
    return record.get("id_del_proceso") or record.get("referencia_del_proceso")


def harvest(
    client: SocrataClient,
    taxonomy: Dict[str, Dict[str, Any]],
    today: datetime,
    log: Callable[[str], None] = print,
) -> Dict[str, Any]:
    """Ejecuta todas las consultas y devuelve `{"records": [...], "consultas": [...]}`.

    `consultas` trae el estado de cada una (ok, error) con filas y si llegó al tope
    (`truncada`), para que el panel de sincronización lo muestre.
    """
    records: List[Dict[str, Any]] = []
    seen = set()
    statuses: List[Dict[str, Any]] = []

    for q in build_queries(taxonomy, today):
        status = {"nombre": q["nombre"], "tipo": q["tipo"], "estado": "ok", "registros": 0, "truncada": False}
        try:
            rows = client.query_all(where=q["where"], order=q["order"], max_rows=q["max_rows"])
        except Exception as exc:  # noqa: BLE001 - se decide abajo si detiene la corrida
            status.update(estado="error", error=str(exc)[:200])
            statuses.append(status)
            log(f"[!] Consulta {q['nombre']} falló: {exc}")
            if q["obligatoria"]:
                raise HarvestError(f"Consulta obligatoria {q['nombre']} falló: {exc}") from exc
            continue

        status["registros"] = len(rows)
        status["truncada"] = len(rows) >= q["max_rows"]
        statuses.append(status)
        log(f"[*] Consulta {q['nombre']}: {len(rows)} filas" + (" (llegó al tope)" if status["truncada"] else ""))
        for row in rows:
            rid = record_id(row)
            if rid and rid not in seen:
                seen.add(rid)
                records.append(row)

    log(f"[*] Candidatos únicos descargados: {len(records)}")
    return {"records": records, "consultas": statuses}


UNSPSC_COVERAGE_WEEKS = 8


def week_start(day: str) -> str:
    """Lunes de la semana de una fecha ISO ("2026-09-17T00:00:00.000" → "2026-09-14")."""
    d = datetime.strptime(day[:10], "%Y-%m-%d")
    return (d - timedelta(days=d.weekday())).strftime("%Y-%m-%d")


def unspsc_coverage(client: SocrataClient, today: datetime, weeks: int = UNSPSC_COVERAGE_WEEKS) -> Optional[Dict[str, Any]]:
    """Qué parte de los procesos publicados trae código UNSPSC, por semana de publicación.

    Desde el 2026-09-15 SECOP II publica casi todos los procesos sin código (9 % frente a 91–95 %
    antes; docs/PLAN_ITERACIONES.md, A10). Se mide en el servidor, sobre todo el universo
    (≥ valor mínimo), para ver si vuelve. Devuelve None si falla: es un monitor, no un dato crítico.
    """
    since_day = today - timedelta(days=7 * weeks)
    since = soql_date(since_day - timedelta(days=since_day.weekday()))  # desde un lunes: semanas completas
    where = f"precio_base >= {MIN_PRICE} AND fecha_de_publicacion_del >= '{since}'"
    has_code = "codigo_principal_de_categoria IS NOT NULL AND codigo_principal_de_categoria != 'UNSPECIFIED'"
    try:
        totals = client.query(select="date_trunc_ymd(fecha_de_publicacion_del) as d, count(*) as n",
                              where=where, group="d", order="d", limit=500)
        coded = client.query(select="date_trunc_ymd(fecha_de_publicacion_del) as d, count(*) as n",
                             where=f"{where} AND {has_code}", group="d", order="d", limit=500)
    except Exception:  # noqa: BLE001
        return None
    weeks_out: Dict[str, Dict[str, Any]] = {}
    for rows, key in ((totals, "procesos"), (coded, "con_codigo")):
        for r in rows:
            if not r.get("d"):
                continue
            w = weeks_out.setdefault(week_start(r["d"]), {"semana": week_start(r["d"]), "procesos": 0, "con_codigo": 0})
            w[key] += int(r.get("n") or 0)
    return {"precio_min": MIN_PRICE, "semanas": [weeks_out[k] for k in sorted(weeks_out)]}


def universe_summary(client: SocrataClient, today: datetime, days: int = GENERAL_WINDOW_DAYS) -> Optional[Dict[str, Any]]:
    """Tamaño del universo publicado en la ventana (≥ valor mínimo), por tipo de contrato y
    modalidad. Se calcula en el servidor, así que cuenta también lo que no se descarga.
    Devuelve None si la consulta falla: es contexto para el reporte, no un dato crítico."""
    since = soql_date(today - timedelta(days=days))
    where = f"precio_base >= {MIN_PRICE} AND fecha_de_publicacion_del >= '{since}'"
    out: Dict[str, Any] = {"dias": days, "desde": since[:10], "precio_min": MIN_PRICE}
    try:
        for key, column in (("por_tipo_contrato", "tipo_de_contrato"), ("por_modalidad", "modalidad_de_contratacion")):
            rows = client.query(select=f"{column}, count(*) as n", where=where, group=column, order="n DESC", limit=50)
            out[key] = [{"valor": r.get(column) or "(vacío)", "procesos": int(r["n"])} for r in rows]
    except Exception:  # noqa: BLE001
        return None
    out["total"] = sum(r["procesos"] for r in out["por_tipo_contrato"])
    return out
