"""
Catálogo UNSPSC en español: base de datos local con banderas de riesgo y exportación de lo publicable.

El clasificador v14 en español de Colombia Compra Eficiente (CCE) resuelve el 100 % de los códigos
de SECOP II, pero su aviso dice "Esta traducción no puede ser explotada comercialmente". Los códigos
y los nombres en inglés son de UNDP; lo que protege CCE es su traducción. A la vez, el Estado ya
publica muchos de esos nombres en español en datos abiertos con licencia CC BY-SA 4.0 (SECOP I:
familia y clase; SECOP II: categoría principal de proveedores). Esta herramienta:

1. Lee el clasificador de CCE (.xlsx, sin dependencias) y los nombres de datos abiertos.
2. Arma una base SQLite local con una bandera por código:
     publicado_igual     el Estado publica ese mismo nombre en datos abiertos (riesgo bajo);
     publicado_distinto  publica otro nombre para ese código (se usa el público);
     no_publicado        el nombre solo está en la traducción de CCE (no se publica).
3. Exporta solo lo publicable: nombres de datos abiertos, con su atribución. Para los códigos sin
   nombre público, nada sale del catálogo de CCE (ver docs/PLAN_ITERACIONES.md, A10).

La base completa contiene la traducción de CCE: se escribe fuera del repositorio (`local/`, en
.gitignore). Solo de lectura contra datos.gov.co.

Uso:
  python -m src.tools.unspsc_catalog descargar --out local/unspsc_abiertos.json
  python -m src.tools.unspsc_catalog construir --cce RUTA.xlsx --abiertos local/unspsc_abiertos.json \\
      --db local/unspsc.sqlite --export config/unspsc_publico.json
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata
import zipfile
from typing import Any, Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree

LEVELS = {2: "segmento", 4: "familia", 6: "clase", 8: "producto"}
ATTRIBUTION = (
    "Nombres de datos abiertos del Estado colombiano (Colombia Compra Eficiente, datos.gov.co), "
    "licencia CC BY-SA 4.0: SECOP I · Procesos de Compra Pública (f789-7hwg, qddk-cgux), "
    "SECOP II · Proveedores Registrados (qmzu-gj57) y SECOP II · Contacto Entidades y Proveedores (4ex9-j3n8)."
)
# SECOP II: pocos pares, se agregan en el servidor (dataset, columna del código, columna del nombre).
AGGREGATED_SOURCES = (
    ("qmzu-gj57", "codigo_categoria_principal", "descripcion_categoria_principal"),
    ("4ex9-j3n8", "codigo_categoria_principal", "descripci_n_categoria_principal"),
)
# SECOP I es enorme: agregarlo pasa del tiempo límite del servidor, incluso un solo año o un lote de
# 5 códigos (medido el 2026-10-02). Buscar un código con `limit 1` tarda ~0,6 s: se busca código por
# código, por nivel (familia de 4 dígitos, clase de 6).
SECOP1_DATASET = "f789-7hwg"
SECOP1_COLUMNS = {4: ("id_familia", "nombre_familia"), 6: ("id_clase", "nombre_clase")}
LOOKUP_WORKERS = 4
EMPTY_NAMES = {"no definido", "no aplica", "n/a", ""}


# ---------- Códigos ----------
def clean_code(raw: Any) -> Optional[str]:
    """'V1.72141000' → '721410'; 'V1.30180000' → '3018'; '4014' → '4014'; basura → None.

    SECOP II rellena con ceros hasta 8 dígitos. En UNSPSC ningún segmento, familia ni clase
    termina en "00" (empiezan en 10 y 15), así que se quitan pares de ceros hasta el nivel real.
    """
    digits = re.sub(r"\D", "", str(raw or "").replace("V1.", ""))
    while len(digits) > 2 and len(digits) % 2 == 0 and digits.endswith("00"):
        digits = digits[:-2]
    return digits if len(digits) in LEVELS else None


def parent(code: str) -> Optional[str]:
    return code[:-2] if len(code) > 2 else None


def fold(text: str) -> str:
    """Para comparar nombres: sin tildes, minúsculas, sin puntuación ni espacios repetidos."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text)).strip()


# ---------- Clasificador de CCE (.xlsx sin dependencias) ----------
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_xlsx_rows(path: str) -> List[List[str]]:
    """Filas de la primera hoja como listas de texto (celdas vacías como '')."""
    with zipfile.ZipFile(path) as z:
        shared: List[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ElementTree.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        sheet = ElementTree.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows: List[List[str]] = []
    for row in sheet.iter(f"{{{NS['m']}}}row"):
        cells: Dict[int, str] = {}
        for c in row.findall("m:c", NS):
            ref = re.match(r"[A-Z]+", c.get("r", "A"))
            col = 0
            for ch in ref.group(0) if ref else "A":
                col = col * 26 + (ord(ch) - 64)
            v = c.find("m:v", NS)
            text = (v.text or "") if v is not None else "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
            cells[col - 1] = shared[int(text)] if c.get("t") == "s" and text.isdigit() else text
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def parse_cce(rows: Iterable[List[str]]) -> Dict[str, str]:
    """{código: nombre} en los 4 niveles, desde las filas del clasificador (encabezado incluido)."""
    out: Dict[str, str] = {}
    started = False
    for row in rows:
        if not started:
            started = bool(row) and fold(row[0]).startswith("codigo segmento")
            continue
        for i in range(0, min(len(row), 8), 2):
            code, name = clean_code(row[i]), (row[i + 1] if i + 1 < len(row) else "").strip()
            if code and name:
                out.setdefault(code, name)
    return out


# ---------- Nombres de datos abiertos ----------
def fetch_open_names(query, codes: Iterable[str], log=print, done: Optional[set] = None,
                     workers: int = LOOKUP_WORKERS) -> List[Dict[str, Any]]:
    """Pares código-nombre de datos abiertos. `query(dataset, select, where, group, limit)` devuelve filas.

    SECOP II se agrega en el servidor. SECOP I se consulta código por código (familias y clases de
    `codes`, normalmente todo el clasificador de CCE). `done` permite retomar una descarga a medias:
    claves 'dataset|columna' (agregadas) o 'f789-7hwg|código' (por código).
    """
    from concurrent.futures import ThreadPoolExecutor

    done = done if done is not None else set()
    rows: List[Dict[str, Any]] = []
    for ds, code_col, name_col in AGGREGATED_SOURCES:
        key = f"{ds}|{code_col}"
        if key in done:
            continue
        page = query(ds, f"{code_col} as c, {name_col} as n, count(*) as k", None, f"{code_col}, {name_col}", 50000)
        rows += [{"ds": ds, "c": r.get("c"), "n": r.get("n"), "k": r.get("k")} for r in page]
        done.add(key)
        log(f"  {key}: {len(page)} pares")

    pending = [c for c in sorted(set(codes)) if len(c) in SECOP1_COLUMNS and f"{SECOP1_DATASET}|{c}" not in done]

    def lookup(code: str) -> Tuple[str, List[Dict[str, Any]]]:
        code_col, name_col = SECOP1_COLUMNS[len(code)]
        return code, query(SECOP1_DATASET, f"{code_col} as c, {name_col} as n", f"{code_col} = '{code}'", None, 1)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (code, page) in enumerate(pool.map(lookup, pending), start=1):
            rows += [{"ds": SECOP1_DATASET, "c": r.get("c"), "n": r.get("n"), "k": 1} for r in page]
            done.add(f"{SECOP1_DATASET}|{code}")
            if i % 250 == 0 or i == len(pending):
                log(f"  {SECOP1_DATASET}: {i} de {len(pending)} códigos consultados")
    return rows


def group_open_names(rows: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Dict[str, int]]]:
    """{código: {nombre: {dataset: veces}}}, sin vacíos ni 'No definido'."""
    out: Dict[str, Dict[str, Dict[str, int]]] = {}
    for r in rows:
        code, name = clean_code(r.get("c")), (r.get("n") or "").strip()
        if not code or fold(name) in EMPTY_NAMES:
            continue
        by_ds = out.setdefault(code, {}).setdefault(name, {})
        by_ds[r["ds"]] = by_ds.get(r["ds"], 0) + int(float(r.get("k") or 0))
    return out


# ---------- Banderas ----------
def best_public(variants: Dict[str, Dict[str, int]]) -> Optional[str]:
    """El nombre público más usado (desempate alfabético, para que sea estable)."""
    if not variants:
        return None
    return sorted(variants, key=lambda n: (-sum(variants[n].values()), n))[0]


def flag(cce_name: Optional[str], variants: Dict[str, Dict[str, int]]) -> str:
    if not variants:
        return "no_publicado"
    target = fold(cce_name or "")
    return "publicado_igual" if any(fold(n) == target for n in variants) else "publicado_distinto"


def public_ancestor(code: str, public: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """El ancestro más cercano con nombre público: (código, nombre)."""
    p = parent(code)
    while p:
        name = best_public(public.get(p, {}))
        if name:
            return p, name
        p = parent(p)
    return None


def build_db(cce: Dict[str, str], public: Dict[str, Dict[str, Dict[str, int]]], path: str) -> Dict[str, int]:
    """Base SQLite con una fila por código (unión de CCE y datos abiertos). Devuelve conteos por bandera."""
    if os.path.exists(path):
        os.remove(path)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE codigo (
            codigo TEXT PRIMARY KEY, nivel TEXT, padre TEXT,
            nombre_cce TEXT,               -- traducción de CCE: no se publica
            nombre_publico TEXT,           -- el más usado en datos abiertos (CC BY-SA 4.0)
            bandera TEXT,                  -- publicado_igual | publicado_distinto | no_publicado
            ancestro_publico TEXT, ancestro_publico_nombre TEXT
        );
        CREATE TABLE variante (codigo TEXT, nombre TEXT, dataset TEXT, veces INTEGER);
    """)
    counts: Dict[str, int] = {}
    for code in sorted(set(cce) | set(public)):
        variants = public.get(code, {})
        f = flag(cce.get(code), variants)
        counts[f] = counts.get(f, 0) + 1
        anc = public_ancestor(code, public)
        db.execute("INSERT INTO codigo VALUES (?,?,?,?,?,?,?,?)",
                   (code, LEVELS[len(code)], parent(code), cce.get(code), best_public(variants), f,
                    anc[0] if anc else None, anc[1] if anc else None))
        for name, by_ds in variants.items():
            for ds, n in by_ds.items():
                db.execute("INSERT INTO variante VALUES (?,?,?,?)", (code, name, ds, n))
    db.commit()
    db.close()
    return counts


def export_public(public: Dict[str, Dict[str, Dict[str, int]]]) -> Dict[str, Any]:
    """Lo publicable: solo nombres de datos abiertos, nunca la traducción de CCE."""
    return {
        "atribucion": ATTRIBUTION,
        "licencia": "CC BY-SA 4.0",
        "codigos": {code: best_public(v) for code, v in sorted(public.items()) if best_public(v)},
    }


# ---------- Línea de comandos ----------
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("descargar", help="Nombres de datos abiertos (solo lectura contra datos.gov.co)")
    d.add_argument("--cce", required=True, help="Clasificador de CCE en .xlsx: dice qué familias y clases buscar")
    d.add_argument("--out", required=True)
    b = sub.add_parser("construir", help="Base local con banderas y exportación de lo publicable")
    b.add_argument("--cce", required=True, help="Clasificador de CCE en .xlsx")
    b.add_argument("--abiertos", required=True, help="JSON de 'descargar'")
    b.add_argument("--db", required=True, help="Base SQLite local (fuera del repositorio)")
    b.add_argument("--export", required=True, help="JSON publicable")
    args = parser.parse_args(argv)

    if args.cmd == "descargar":
        from src.services.socrata_client import SocrataClient
        client = SocrataClient(timeout=300, retries=1)
        state = json.load(open(args.out, encoding="utf-8")) if os.path.exists(args.out) else {"done": [], "rows": []}
        done = set(state["done"])

        def query(ds, select, where, group, limit):
            params = {"select": select, "limit": limit}
            if where:
                params["where"] = where
            if group:
                params["group"] = group
            return client.query(dataset_id=ds, **params)

        codes = parse_cce(read_xlsx_rows(args.cce))
        try:
            state["rows"] += fetch_open_names(query, codes, done=done)
        finally:
            state["done"] = sorted(done)
            os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False)
        return 0

    cce = parse_cce(read_xlsx_rows(args.cce))
    with open(args.abiertos, encoding="utf-8") as f:
        public = group_open_names(json.load(f)["rows"])
    counts = build_db(cce, public, args.db)
    exported = export_public(public)
    with open(args.export, "w", encoding="utf-8", newline="\n") as f:
        json.dump(exported, f, ensure_ascii=False, indent=0, sort_keys=True)
        f.write("\n")
    print(f"[+] {len(cce)} códigos de CCE, {len(public)} con nombre público. Banderas: {counts}")
    print(f"[+] Base local: {args.db}. Publicable: {args.export} ({len(exported['codigos'])} nombres).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
