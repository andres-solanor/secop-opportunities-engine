"""
Pipeline to extract, filter, enrich, and curate the SECOP II Opportunities Dataset.
Exports results to JSON, CSV, Markdown, and directly to web/data.js for instant deployment.

Uso:
    python -m src.export_prospects              # escribe en data/ y web/ del repositorio
    python -m src.export_prospects --out DIR    # escribe en DIR/data y DIR/web (pruebas locales)
"""

import argparse
import csv
import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.curation import TARGET_COUNT, build_hidden, check_funnel, classify, funnel_counts, select_curated
from src.discovery import frequent_phrases, group_by_contract_type, group_by_family, render_report
from src.enrichers.contract_enricher import ContractEnricher, normalize_nit
from src.enrichers.open_sources import OpenSourcesEnricher
from src.enrichers.scope_extractor import ScopeExtractor
from src.filters.noise_filter import NoiseFilter
from src.harvest import GENERAL_WINDOW_DAYS, MIN_PRICE, HarvestError, harvest, universe_summary
from src.schema import SchemaError, validate_dataset
from src.services.socrata_client import SocrataClient
from src.sync_status import build_meta, load_json, save_json, stamp_first_seen
from src.taxonomy import load_groups, taxonomy_version

log = logging.getLogger("secop")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_JSON = "prospects.json"
DATASET_CSV = "prospects.csv"
DATASET_SUMMARY = "prospects_summary.md"
HIDDEN_SUMMARY = "hidden_summary.md"
# La vista "fuera del tablero" (y "Otros" en el filtro de sector) se carga solo cuando el
# usuario la abre, pero el archivo se versiona a diario: se limita para no inflar el
# repositorio. El reporte sí cubre todo.
HIDDEN_WEB_MAX = 1500
# Reparto del cupo por motivo. Si falta un motivo, su parte se reparte entre los demás.
HIDDEN_SHARES = {"sin_sector": 0.6, "fuera_de_corte": 0.2, "convenio": 0.2}


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# Cifras de la entidad que leen las fichas (badges "Gran comprador" y "Registra pagos").
ENTITY_CARD_FIELDS = ("contratos_12m", "valor_12m", "pagado_sobre_facturado_pct")


def entity_stats(prospects: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Diccionario {NIT: cifras de la entidad} para las fichas livianas y el PAA.

    Sale de los `entidad_stats` que ya calculó el cruce con contratos: ninguna consulta nueva.
    Una entrada por entidad (377 copias eran de 225 entidades el 2026-10-01).
    """
    out: Dict[str, Dict[str, Any]] = {}
    for p in prospects:
        stats = p.get("entidad_stats")
        nit = normalize_nit(p.get("nit_entidad"))
        if stats and nit and nit not in out:
            out[nit] = {k: stats[k] for k in ENTITY_CARD_FIELDS if stats.get(k) is not None}
    return out


def cap_hidden(hidden: List[Dict[str, Any]], limit: int = HIDDEN_WEB_MAX) -> List[Dict[str, Any]]:
    """Recorta la lista para la web conservando todos los motivos.

    Sin este reparto, los sin clasificar (que son muchos más) ocuparían todo el cupo y las
    clasificadas fuera del corte nunca se verían. Cada grupo conserva su orden (mejor puntaje
    primero) y el cupo que un grupo no usa pasa a los otros.
    """
    groups = {m: [h for h in hidden if h["motivo"] == m] for m in HIDDEN_SHARES}
    present = [m for m in HIDDEN_SHARES if groups[m]]
    share_sum = sum(HIDDEN_SHARES[m] for m in present) or 1
    take = {m: min(len(groups[m]), round(limit * HIDDEN_SHARES[m] / share_sum)) for m in present}
    while sum(take.values()) > limit:  # el redondeo puede pasarse por uno
        take[max(take, key=take.get)] -= 1
    left = limit - sum(take.values())
    for m in present:
        extra = min(left, len(groups[m]) - take[m])
        take[m] += extra
        left -= extra
    return [h for m in present for h in groups[m][:take[m]]]


def build_curated_dataset(records: List[Dict[str, Any]], target_count: int = TARGET_COUNT) -> List[Dict[str, Any]]:
    """Applies NoiseFilter and ScopeExtractor, balancing both by Sector and Commercial Stage (Adjudicado vs Open)."""
    funnel = classify(records, NoiseFilter(min_budget=MIN_PRICE), ScopeExtractor())
    return select_curated(funnel["classified"], target_count)


def report_field_coverage(prospects: List[Dict[str, Any]]) -> Dict[str, int]:
    """Cuenta cuántas oportunidades traen cada fecha/señal. Se imprime en el log del pipeline
    para detectar columnas de SECOP que cambiaron de nombre o dejaron de llegar."""
    coverage: Dict[str, int] = {}
    for p in prospects:
        for group in ("fechas", "competencia"):
            for key, value in (p.get(group) or {}).items():
                coverage[f"{group}.{key}"] = coverage.get(f"{group}.{key}", 0) + (value is not None)
        coverage["plazo"] = coverage.get("plazo", 0) + (p.get("plazo") is not None)
    log.info("[*] Cobertura de campos (%d oportunidades):", len(prospects))
    for key in sorted(coverage):
        log.info("    - %s: %d", key, coverage[key])
    return coverage


def export_dataset(prospects: List[Dict[str, Any]], data_dir: str, web_dir: str, meta: Dict[str, Any] = None,
                   paa: List[Dict[str, Any]] = None):
    """Exports dataset to JSON, CSV, Markdown, and web/data.js."""
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(web_dir, exist_ok=True)

    json_path = os.path.join(data_dir, DATASET_JSON)
    csv_path = os.path.join(data_dir, DATASET_CSV)
    summary_path = os.path.join(data_dir, DATASET_SUMMARY)
    web_js_path = os.path.join(web_dir, "data.js")

    # 1. JSON Export
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(prospects, f, ensure_ascii=False, indent=2)
    log.info("[+] Saved JSON dataset: %s", json_path)

    # 2. Web JS Export (for GitHub Pages instant execution without CORS)
    # JSON compacto: con sangría, ~27 % del archivo eran espacios (medido el 2026-10-01). Para leerlo
    # a mano está data/prospects.json.
    generated_at = (meta or {}).get("generated_at") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(web_js_path, "w", encoding="utf-8") as f:
        f.write("window.PROSPECTS_DATA = " + compact_json(prospects) + ";\n")
        f.write(f"window.PROSPECTS_UPDATED_AT = \"{generated_at}\";\n")
        f.write("window.ENTITY_STATS = " + compact_json(entity_stats(prospects)) + ";\n")
        if meta:
            f.write("window.PROSPECTS_META = " + compact_json(meta) + ";\n")
        if paa is not None:
            f.write("window.PAA_DATA = " + compact_json(paa) + ";\n")
    log.info("[+] Updated Web App data: %s", web_js_path)

    # 3. CSV Export
    csv_fields = [
        "id", "referencia", "score_calidad", "etapa_comercial", "tipo_oportunidad",
        "sectores", "materiales_detectados", "precio_formateado", "entidad",
        "departamento", "ciudad", "modalidad", "contratista_nombre", "contratista_nit",
        "accion_sugerida", "url_secop", "descripcion"
    ]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=csv_fields)
        writer.writeheader()
        for p in prospects:
            writer.writerow({
                "id": p.get("id"),
                "referencia": p.get("referencia"),
                "score_calidad": p.get("score_calidad"),
                "etapa_comercial": p.get("etapa_comercial"),
                "tipo_oportunidad": p.get("tipo_oportunidad"),
                "sectores": ", ".join(s["name"] for s in p.get("sectores", [])),
                "materiales_detectados": ", ".join(p.get("materiales_detectados", [])),
                "precio_formateado": p.get("precio_formateado"),
                "entidad": p.get("entidad"),
                "departamento": p.get("departamento"),
                "ciudad": p.get("ciudad"),
                "modalidad": p.get("modalidad"),
                "contratista_nombre": p.get("contratista", {}).get("nombre"),
                "contratista_nit": p.get("contratista", {}).get("nit"),
                "accion_sugerida": p.get("accion_sugerida"),
                "url_secop": p.get("url_secop"),
                "descripcion": (p.get("descripcion") or "")[:250],
            })
    log.info("[+] Saved CSV dataset: %s", csv_path)

    # 4. Markdown Executive Summary
    total_val = sum(p.get("precio", 0) for p in prospects)
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("# Observatorio SECOP II - Oportunidades Calificadas\n\n")
        f.write(f"**Total Oportunidades Curadas:** {len(prospects)}  \n")
        f.write(f"**Valor Acumulado en Pipeline:** ${total_val:,.0f} COP  \n\n")
        f.write("| # | Score | Sector | Etapa | Entidad | Valor | Materiales Detectados | Acción Recomendada |\n")
        f.write("|---|---|---|---|---|---|---|---|\n")
        for idx, p in enumerate(prospects, 1):
            sectores = ", ".join(s["name"] for s in p.get("sectores", []))
            mats = ", ".join(p.get("materiales_detectados", [])[:3]) or "Especificación en pliegos"
            f.write(
                f"| {idx} | **{p['score_calidad']}** | {sectores} | {p['etapa_comercial']} | "
                f"{(p.get('entidad') or '')[:30]}... | {p['precio_formateado']} | {mats} | {p['accion_sugerida']} |\n"
            )
    log.info("[+] Saved Executive Summary: %s", summary_path)


def export_hidden(hidden: List[Dict[str, Any]], report: str, data_dir: str, web_dir: str,
                  generated_at: str, full_dump: bool = False) -> None:
    """Publica lo que pasó el filtro pero no está en el tablero.

    - web/hidden.js: lista liviana (tope HIDDEN_WEB_MAX) que la web carga solo al abrir la vista.
    - data/hidden_summary.md: reporte de descubrimiento, que sí cubre todos los procesos.
    - data/hidden_full.json: lista completa, solo en corridas locales con --out.
    """
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(web_dir, exist_ok=True)

    payload = {
        "generated_at": generated_at,
        "total": len(hidden),
        "sin_sector": sum(1 for h in hidden if h["motivo"] == "sin_sector"),
        "fuera_de_corte": sum(1 for h in hidden if h["motivo"] == "fuera_de_corte"),
        "convenio": sum(1 for h in hidden if h["motivo"] == "convenio"),
        # Los seguros quedan en "Otros" identificados: solo aseguradoras pueden ofertar.
        "seguros": sum(1 for h in hidden if h["motivo"] == "sin_sector" and h.get("tipo_contrato") == "Seguros"),
        "items": cap_hidden(hidden),
    }
    web_path = os.path.join(web_dir, "hidden.js")
    with open(web_path, "w", encoding="utf-8") as f:
        f.write("window.HIDDEN_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    log.info("[+] Updated hidden view data: %s (%d de %d)", web_path, len(payload["items"]), len(hidden))

    report_path = os.path.join(data_dir, HIDDEN_SUMMARY)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)
    log.info("[+] Saved discovery report: %s", report_path)

    if full_dump:
        save_json(os.path.join(data_dir, "hidden_full.json"), hidden)


def export_taxonomy(web_dir: str):
    """Exports the sector taxonomy to web/taxonomy.js so profile matching in the browser
    uses exactly the same vocabulary as the SECOP enrichment pipeline."""
    os.makedirs(web_dir, exist_ok=True)
    taxonomy = {
        key: {"name": data["name"], "grupo": data["grupo"], "keywords": data["keywords"]}
        for key, data in ScopeExtractor.TAXONOMIES.items()
    }
    groups = [{"id": g["id"], "name": g["name"]} for g in load_groups()]
    path = os.path.join(web_dir, "taxonomy.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("window.SECTOR_TAXONOMY = " + json.dumps(taxonomy, ensure_ascii=False, indent=2) + ";\n")
        f.write("window.SECTOR_GROUPS = " + json.dumps(groups, ensure_ascii=False, indent=2) + ";\n")
    log.info("[+] Updated Web taxonomy: %s", path)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresca el dataset de oportunidades desde SECOP II.")
    parser.add_argument(
        "--out", metavar="DIR", default=None,
        help="Escribe en DIR/data y DIR/web en vez de las carpetas del repositorio. "
             "El estado anterior (corrida previa, ids vistos, historial) se sigue leyendo del repositorio.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args(argv)
    started_at = datetime.now(timezone.utc)
    today = started_at.replace(tzinfo=None)

    state_dir = os.path.join(BASE_DIR, "data")
    out_base = os.path.abspath(args.out) if args.out else BASE_DIR
    data_dir = os.path.join(out_base, "data")
    web_dir = os.path.join(out_base, "web")

    # 1. Descarga. Si falla una consulta obligatoria no se publica nada: la web conserva lo de ayer.
    harvest_client = SocrataClient(timeout=90, retries=2)
    try:
        harvested = harvest(harvest_client, ScopeExtractor.TAXONOMIES, today, log.info)
    except HarvestError as exc:
        log.error("[!] Descarga incompleta, no se publica: %s", exc)
        return 1
    raw_records = harvested["records"]
    if not raw_records:
        log.error("[!] No records fetched. Check internet connection.")
        return 1

    # 2. Curaduría: duplicados, filtro de ruido, sectores y selección para el tablero.
    funnel = classify(raw_records, NoiseFilter(min_budget=MIN_PRICE), ScopeExtractor())
    prospects = select_curated(funnel["classified"], TARGET_COUNT)
    counts = funnel_counts(funnel, prospects)
    check_funnel(counts)
    hidden = build_hidden(funnel, prospects)
    log.info("[*] Embudo: %d descargados, %d duplicados, %d rechazados, %d sin clasificar, %d clasificados "
             "(%d en tablero, %d fuera del corte); %d convenios abiertos fuera del tablero.", counts["descargados"],
             counts["duplicados"], counts["rechazados"], counts["sin_clasificar"], counts["clasificados"],
             counts["en_tablero"], counts["fuera_de_corte"], counts["convenios_abiertos"])
    report_field_coverage(prospects)
    date_like = sorted(k for k in raw_records[0] if k.startswith(("fecha", "duracion", "unidad_de")))
    log.info("[*] Columnas de fecha/plazo en SECOP: %s", ", ".join(date_like))

    # 3. Cruce con SECOP II Contratos: fechas de ejecución, pagos, contactos por rol,
    # historial del contratista y comportamiento de la entidad.
    client = SocrataClient()
    previous = load_json(os.path.join(state_dir, DATASET_JSON), [])
    enricher = ContractEnricher(client, log=log.info, previous=previous)
    enricher.enrich(prospects)

    # 4. Fuentes abiertas gratuitas: ofertas (competencia), integrantes de consorcios,
    # sanciones y compras planeadas del Plan Anual de Adquisiciones.
    open_sources = OpenSourcesEnricher(
        client, ScopeExtractor.TAXONOMIES, log=log.info, previous=previous,
        previous_paa=load_json(os.path.join(state_dir, "paa.json"), []),
        history_fn=lambda nits: enricher.fetch_contractor_history(nits),
        paa_client=SocrataClient(timeout=120),
        previous_profile=load_json(os.path.join(state_dir, "perfil_proponente.json"), None),
    )
    open_sources.enrich(prospects)
    paa = open_sources.paa()
    bidder_profile = open_sources.bidder_profile()

    # 5. Estado de la sincronización: nuevas (nunca vistas), salidas, nuevas adjudicadas e historial.
    # Si cambió la taxonomía, lo que entra al tablero solo por tener sector nuevo no es "nueva".
    finished_at = datetime.now(timezone.utc)
    history = load_json(os.path.join(state_dir, "sync_history.json"), [])
    version = taxonomy_version()
    reclassified = bool(history) and history[0].get("taxonomia_version") != version
    seen = stamp_first_seen(prospects, load_json(os.path.join(state_dir, "seen_ids.json"), {}), previous, finished_at,
                            reclassified_since=history[0].get("generated_at") if reclassified else None)
    meta = build_meta(prospects, previous, len(raw_records), started_at, finished_at,
                      enricher.summary, history,
                      extra_sources=open_sources.summary, paa_count=len(paa),
                      queries=harvested["consultas"], funnel=counts,
                      taxonomy_version=version, reclassified=reclassified,
                      bidder_profile=bidder_profile)
    log.info("[*] Sincronización: %d nuevas, %d salieron, %d pasaron a adjudicadas, cruce de contratos: %s.",
             meta["nuevas"], meta["salieron"], meta["nuevas_adjudicadas"], meta["cruce_contratos"])

    unclassified = funnel["unclassified"]
    report = render_report(
        counts, group_by_family(unclassified), meta["generated_at"], GENERAL_WINDOW_DAYS,
        universe=universe_summary(client, today), queries=harvested["consultas"],
        contract_types=group_by_contract_type([u for u in unclassified if not u.get("unspsc")]),
        phrases=frequent_phrases(unclassified),
    )

    # 6. Contrato de datos: se valida todo antes de escribir el primer archivo.
    try:
        validate_dataset(prospects, meta, hidden, sector_ids=ScopeExtractor.TAXONOMIES)
    except SchemaError as exc:
        log.error("[!] %s", exc)
        return 1

    save_json(os.path.join(data_dir, "paa.json"), paa)
    if bidder_profile:
        save_json(os.path.join(data_dir, "perfil_proponente.json"), bidder_profile)
    save_json(os.path.join(data_dir, "seen_ids.json"), seen)
    save_json(os.path.join(data_dir, "sync_history.json"), meta["historial"])
    export_dataset(prospects, data_dir, web_dir, meta, paa)
    export_hidden(hidden, report, data_dir, web_dir, meta["generated_at"], full_dump=bool(args.out))
    export_taxonomy(web_dir)
    log.info("[*] Pipeline completed successfully!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
