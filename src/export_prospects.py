"""
Pipeline to extract, filter, enrich, and curate the SECOP II Opportunities Dataset.
Exports results to JSON, CSV, Markdown, and directly to web/data.js for instant deployment.
"""

import csv
import json
import os
import sys
from typing import Any, Dict, List

from src.enrichers.scope_extractor import ScopeExtractor
from src.filters.noise_filter import NoiseFilter
from src.services.socrata_client import SocrataClient


def harvest_target_records(client: SocrataClient) -> List[Dict[str, Any]]:
    """Fetches real-world candidates from SECOP II across target industry queries."""
    all_records = []
    seen_ids = set()

    queries = [
        # Query 1: Steel & Metalwork (prevents matching surnames like 'Acero' in procedure titles)
        (
            "precio_base >= 100000000 AND ("
            "upper(nombre_del_procedimiento) like '%ESTRUCTURA%MET%' OR "
            "upper(nombre_del_procedimiento) like '%VIGAS%' OR "
            "upper(nombre_del_procedimiento) like '%CUBIERTA%MET%' OR "
            "upper(nombre_del_procedimiento) like '%PERFILES%' OR "
            "upper(descripci_n_del_procedimiento) like '%ACERO%' OR "
            "upper(descripci_n_del_procedimiento) like '%ESTRUCTURA%MET%' OR "
            "upper(descripci_n_del_procedimiento) like '%VIGAS%' OR "
            "upper(descripci_n_del_procedimiento) like '%CUBIERTA%MET%' OR "
            "upper(descripci_n_del_procedimiento) like '%VARILLA%' "
            ")"
        ),
        # Query 2: HORECA & Industrial Gastronomy
        (
            "precio_base >= 50000000 AND ("
            "upper(nombre_del_procedimiento) like '%COCINA%' OR "
            "upper(nombre_del_procedimiento) like '%REFRIGERACI%' OR "
            "upper(nombre_del_procedimiento) like '%HORNO%' OR "
            "upper(nombre_del_procedimiento) like '%GASTRON%' OR "
            "upper(nombre_del_procedimiento) like '%ALIMENTACI%ESCOLAR%' OR "
            "upper(descripci_n_del_procedimiento) like '%CUARTO FR%' OR "
            "upper(descripci_n_del_procedimiento) like '%COCINA INDUSTRIAL%'"
            ")"
        ),
        # Query 3: Solar Energy, Electrical & Public Lighting
        (
            "precio_base >= 50000000 AND ("
            "upper(nombre_del_procedimiento) like '%SOLAR%' OR "
            "upper(nombre_del_procedimiento) like '%FOTOVOLTAIC%' OR "
            "upper(nombre_del_procedimiento) like '%ALUMBRADO%' OR "
            "upper(nombre_del_procedimiento) like '%ILUMINACI%' OR "
            "upper(descripci_n_del_procedimiento) like '%PANEL%SOLAR%' OR "
            "upper(descripci_n_del_procedimiento) like '%ENERGIA SOLAR%' OR "
            "upper(descripci_n_del_procedimiento) like '%LUMINARIA%LED%'"
            ")"
        ),
        # Query 4: Recently Awarded Commercial Contracts (for B2B Suppliers)
        (
            "precio_base >= 100000000 AND "
            "estado_del_procedimiento in ('Adjudicado', 'Celebrado') AND "
            "modalidad_de_contratacion in ('Licitación pública', 'Selección abreviada menor cuantía', 'Subasta', 'Régimen especial') AND ("
            "upper(descripci_n_del_procedimiento) like '%SUMINISTRO%' OR "
            "upper(descripci_n_del_procedimiento) like '%OBRA%' OR "
            "upper(descripci_n_del_procedimiento) like '%DOTACION%' OR "
            "upper(descripci_n_del_procedimiento) like '%DOTACIÓN%'"
            ")"
        ),
        # Query 5: Active High-Value Tenders (Licitaciones for Ally Consultants)
        (
            "precio_base >= 300000000 AND "
            "modalidad_de_contratacion in ('Licitación pública', 'Selección abreviada menor cuantía', 'Subasta') AND "
            "estado_del_procedimiento in ('Presentación de ofertas', 'Convocado', 'Publicado')"
        )
    ]

    print("[*] Harvesting records from SECOP II (datos.gov.co)...")
    for i, q in enumerate(queries, 1):
        try:
            print(f"    -> Querying slice {i}/{len(queries)}...")
            records = client.fetch_recent_processes(
                where_clause=q,
                limit=200,
                order="fecha_de_publicacion_del DESC"
            )
            print(f"       Found {len(records)} raw records.")
            for r in records:
                rec_id = r.get("id_del_proceso") or r.get("referencia_del_proceso")
                if rec_id and rec_id not in seen_ids:
                    seen_ids.add(rec_id)
                    all_records.append(r)
        except Exception as e:
            print(f"       [!] Query error: {e}")

    print(f"[*] Total unique candidates harvested: {len(all_records)}")
    return all_records


def build_curated_dataset(records: List[Dict[str, Any]], target_count: int = 150) -> List[Dict[str, Any]]:
    """Applies NoiseFilter and ScopeExtractor, balancing both by Sector and Commercial Stage (Adjudicado vs Open)."""
    noise_filter = NoiseFilter(min_budget=50_000_000)
    scope_extractor = ScopeExtractor()

    passed_items = []

    for r in records:
        passes, reason = noise_filter.evaluate(r)
        if not passes:
            continue

        enriched = scope_extractor.enrich(r)
        if enriched["sectores"]:
            passed_items.append(enriched)

    # Sort descending by score_calidad, then by precio
    passed_items.sort(key=lambda x: (x["score_calidad"], x["precio"]), reverse=True)

    # Split into Adjudicados (B2B Leads) and Open Bids (Observatorio)
    adjudicados = [item for item in passed_items if "adjudicado" in item["etapa_comercial"].lower()]
    open_tenders = [item for item in passed_items if "adjudicado" not in item["etapa_comercial"].lower()]

    print(f"[*] Post-filter qualified leads pool:")
    print(f"    - Adjudicados (B2B Proveedores): {len(adjudicados)}")
    print(f"    - Licitaciones Abiertas (Observatorio): {len(open_tenders)}")

    selected = []
    selected_ids = set()

    def add_from_list(source_list, quota):
        count = 0
        for item in source_list:
            if count >= quota:
                break
            if item["id"] not in selected_ids:
                selected.append(item)
                selected_ids.add(item["id"])
                count += 1

    # Ensure robust balanced representation:
    # Target ~60 Adjudicados for Proveedores and ~90 Open Tenders for Observatorio
    add_from_list(adjudicados, 65)
    add_from_list(open_tenders, 85)

    # Fill remaining from pool if needed
    for item in passed_items:
        if len(selected) >= target_count:
            break
        if item["id"] not in selected_ids:
            selected.append(item)
            selected_ids.add(item["id"])

    # Final re-sort by score
    selected.sort(key=lambda x: (x["score_calidad"], x["precio"]), reverse=True)
    return selected


def export_dataset(prospects: List[Dict[str, Any]], data_dir: str, web_dir: str):
    """Exports dataset to JSON, CSV, Markdown, and web/data.js."""
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(web_dir, exist_ok=True)

    json_path = os.path.join(data_dir, "prospects_prototype_50.json")
    csv_path = os.path.join(data_dir, "prospects_prototype_50.csv")
    summary_path = os.path.join(data_dir, "prospects_prototype_summary.md")
    web_js_path = os.path.join(web_dir, "data.js")

    # 1. JSON Export
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(prospects, f, ensure_ascii=False, indent=2)
    print(f"[+] Saved JSON dataset: {json_path}")

    # 2. Web JS Export (for GitHub Pages instant execution without CORS)
    with open(web_js_path, "w", encoding="utf-8") as f:
        f.write("window.PROSPECTS_DATA = " + json.dumps(prospects, ensure_ascii=False, indent=2) + ";\n")
    print(f"[+] Updated Web App data: {web_js_path}")

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
    print(f"[+] Saved CSV dataset: {csv_path}")

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
    print(f"[+] Saved Executive Summary: {summary_path}")


def main():
    client = SocrataClient()
    raw_records = harvest_target_records(client)
    if not raw_records:
        print("[!] No records fetched. Check internet connection.")
        sys.exit(1)

    prospects = build_curated_dataset(raw_records, target_count=150)
    print(f"[*] Successfully curated {len(prospects)} high-value prospects.")

    base_dir = os.path.dirname(os.path.dirname(__file__))
    data_dir = os.path.join(base_dir, "data")
    web_dir = os.path.join(base_dir, "web")
    export_dataset(prospects, data_dir, web_dir)
    print("[*] Pipeline completed successfully!")


if __name__ == "__main__":
    main()
