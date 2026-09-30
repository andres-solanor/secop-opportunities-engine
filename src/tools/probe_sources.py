"""
Diagnóstico de fuentes de datos abiertos (solo lectura, no modifica datos).

Uso:  python -m src.tools.probe_sources             # catálogo, columnas y anexos
      python -m src.tools.probe_sources --valores   # valores reales de modalidad, estado, tipo y fase
Se ejecuta desde el workflow manual "Probe SECOP sources" porque el entorno de desarrollo
no siempre tiene acceso a datos.gov.co. Imprime en el log:
  1. Datasets de SECOP encontrados en el catálogo de datos.gov.co (nombre, id, actualización).
  2. Columnas y una fila de ejemplo de los datasets candidatos para las siguientes fases.
  3. Los archivos (anexos) de un proceso real de la selección actual.
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from src.services.socrata_client import SocrataClient

CATALOG = "https://api.us.socrata.com/api/catalog/v1"
SEARCHES = [
    "SECOP II archivos descarga", "SECOP II proponentes", "SECOP II proveedores registrados",
    "plan anual de adquisiciones", "SECOP multas sanciones", "SECOP II grupos proveedores",
    "SECOP II ofertas por proceso", "SECOP II adiciones",
]
CANDIDATES = {
    "archivos_2025": "dmgg-8hin",
    "archivos_2024": "nbae-kzan",
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "SecopOpportunitiesEngine/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_catalog():
    found = {}
    for q in SEARCHES:
        params = urllib.parse.urlencode({"domains": "www.datos.gov.co", "search_context": "www.datos.gov.co", "q": q, "limit": 12})
        try:
            data = fetch_json(f"{CATALOG}?{params}")
        except Exception as exc:  # noqa: BLE001
            print(f"[!] Catálogo '{q}': {exc}")
            continue
        for r in data.get("results", []):
            res = r.get("resource", {})
            if "secop" in (res.get("name") or "").lower() or "adquisiciones" in (res.get("name") or "").lower():
                found[res.get("id")] = (res.get("name"), res.get("data_updated_at") or res.get("updatedAt"), res.get("columns_field_name", []))
    print(f"[*] Datasets encontrados en el catálogo: {len(found)}")
    for dsid, (name, updated, cols) in sorted(found.items(), key=lambda kv: kv[1][0] or ""):
        print(f"    - {dsid} | {name} | actualizado {updated} | {len(cols)} columnas")
    return found


def describe(client, label, dsid, where=None):
    try:
        rows = client.query(dataset_id=dsid, where=where, limit=3)
    except Exception as exc:  # noqa: BLE001
        print(f"[!] {label} ({dsid}): {exc}")
        return []
    print(f"[*] {label} ({dsid}): {len(rows)} filas de ejemplo")
    if rows:
        print("    Columnas: " + ", ".join(sorted(rows[0])))
        print("    Ejemplo: " + json.dumps(rows[0], ensure_ascii=False)[:1500])
    return rows


VALUE_COLUMNS = ("modalidad_de_contratacion", "estado_del_procedimiento", "tipo_de_contrato", "adjudicado", "fase")


def value_distributions(client, days=120, log=print):
    """Valores reales de las columnas que el pipeline usa en sus filtros, con su conteo.

    SoQL compara por igualdad exacta: un filtro con un valor que no existe (por ejemplo
    estado 'Adjudicado') devuelve cero filas sin dar error. Corre esto antes de escribir
    o cambiar un filtro en src/harvest.py o src/filters/noise_filter.py.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00")
    where = f"precio_base >= 50000000 AND fecha_de_publicacion_del >= '{since}'"
    out = {}
    for column in VALUE_COLUMNS:
        try:
            rows = client.query(select=f"{column}, count(*) as n", where=where, group=column, order="n DESC", limit=60)
        except Exception as exc:  # noqa: BLE001
            log(f"[!] {column}: {exc}")
            continue
        out[column] = [(r.get(column), int(r["n"])) for r in rows]
        log(f"[*] {column} ({len(rows)} valores, procesos publicados desde {since[:10]}):")
        for value, n in out[column]:
            log(f"    {n:>8}  {value!r}")
    return out


def main():
    if "--valores" in sys.argv[1:]:
        value_distributions(SocrataClient(timeout=120))
        return
    client = SocrataClient(timeout=60)
    found = search_catalog()

    for label, dsid in CANDIDATES.items():
        describe(client, label, dsid)

    # Datasets de catálogo que parecen proponentes, proveedores, PAA o sanciones
    for dsid, (name, _, _) in found.items():
        low = (name or "").lower()
        if any(k in low for k in ("proponente", "proveedores registrados", "plan anual", "multa", "sancion", "grupo", "oferta")):
            describe(client, name, dsid)

    # Anexos de un proceso real de la selección actual
    base = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    try:
        with open(os.path.join(base, "data", "prospects.json"), encoding="utf-8") as f:
            prospects = json.load(f)
    except (OSError, ValueError):
        prospects = []
    for p in prospects[:40]:
        for field in ("proceso", "id_del_proceso", "id_proceso", "id_del_portafolio", "numero_de_proceso"):
            for value in (p.get("id"), p.get("id_portafolio")):
                if not value:
                    continue
                rows = []
                try:
                    rows = client.query(dataset_id=CANDIDATES["archivos_2025"], where=f"{field} = '{value}'", limit=50)
                except Exception:  # noqa: BLE001 - el campo puede no existir
                    continue
                if rows:
                    print(f"[*] Anexos de {value} (campo {field}): {len(rows)} archivos")
                    for r in rows[:15]:
                        print("    - " + json.dumps(r, ensure_ascii=False)[:400])
                    return
    print("[!] No se encontraron anexos por id de proceso/portafolio en los primeros 40 procesos.")


if __name__ == "__main__":
    main()
