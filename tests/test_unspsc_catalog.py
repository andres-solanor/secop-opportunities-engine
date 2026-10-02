"""Catálogo UNSPSC (src/tools/unspsc_catalog.py): banderas de riesgo y exportación de lo publicable."""

import io
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile

from src.tools.unspsc_catalog import (
    build_db,
    clean_code,
    export_public,
    fetch_open_names,
    flag,
    group_open_names,
    parse_cce,
    public_ancestor,
    read_xlsx_rows,
)

# Filas como las del clasificador de CCE: avisos, encabezado y datos.
CCE_ROWS = [
    ["Esta es una traducción al castellano…"],
    ["Esta traducción no puede ser explotada comercialmente."],
    [],
    ["Código Segmento", "Nombre Segmento", "Código Familia", "Nombre Familia", "Código Clase", "Nombre Clase", "Código Producto", "Nombre Producto"],
    ["72", "Servicios de Edificación", "7214", "Servicios de construcción pesada", "721410", "Construcción de autopistas", "72141003", "Pavimentación"],
    ["72", "Servicios de Edificación", "7214", "Servicios de construcción pesada", "721411", "Servicios de infraestructura", "72141101", "Puentes"],
]
OPEN_ROWS = [
    {"ds": "f789-7hwg", "c": "7214", "n": "Servicios de construcción pesada", "k": "900"},
    {"ds": "f789-7hwg", "c": "721410", "n": "Construccion de autopistas.", "k": "40"},     # igual, salvo tilde y punto
    {"ds": "qmzu-gj57", "c": "V1.72141100", "n": "Infraestructura vial", "k": "7"},        # otro nombre, clase rellena con 00
    {"ds": "qmzu-gj57", "c": "No Definido", "n": "No Definido", "k": "5000"},
    {"ds": "4ex9-j3n8", "c": "72141101", "n": "No definido", "k": "3"},
]


def tiny_xlsx(rows):
    """Un .xlsx mínimo con cadenas compartidas, como el del clasificador."""
    strings, index = [], {}
    def sid(text):
        if text not in index:
            index[text] = len(strings)
            strings.append(text)
        return index[text]
    xml_rows = []
    for r, row in enumerate(rows, start=1):
        cells = "".join(f'<c r="{chr(65 + i)}{r}" t="s"><v>{sid(v)}</v></c>' for i, v in enumerate(row) if v)
        xml_rows.append(f'<row r="{r}">{cells}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/sharedStrings.xml", f'<sst {ns}>' + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData>{"".join(xml_rows)}</sheetData></worksheet>')
    return buf.getvalue()


class TestUnspscCatalog(unittest.TestCase):

    def test_codes_are_cleaned_like_secop_uses_them(self):
        self.assertEqual(clean_code("V1.72141000"), "721410")
        self.assertEqual(clean_code("V1.30180000"), "3018")  # familia rellena con 0000 (SECOP II)
        self.assertEqual(clean_code("V1.72141003"), "72141003")
        self.assertEqual(clean_code("4014"), "4014")
        self.assertIsNone(clean_code("No Definido"))
        self.assertIsNone(clean_code("123"))

    def test_cce_xlsx_is_read_without_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "cce.xlsx")
            with open(path, "wb") as f:
                f.write(tiny_xlsx(CCE_ROWS))
            cce = parse_cce(read_xlsx_rows(path))
        self.assertEqual(cce["72"], "Servicios de Edificación")
        self.assertEqual(cce["721410"], "Construcción de autopistas")
        self.assertEqual(cce["72141003"], "Pavimentación")
        self.assertEqual(len(cce), 6)  # 1 segmento, 1 familia, 2 clases, 2 productos; sin los avisos

    def test_flags_compare_names_without_accents_or_punctuation(self):
        cce = parse_cce(CCE_ROWS)
        public = group_open_names(OPEN_ROWS)
        self.assertEqual(flag(cce["721410"], public["721410"]), "publicado_igual")
        self.assertEqual(flag(cce["721411"], public["721411"]), "publicado_distinto")
        self.assertEqual(flag(cce["72141003"], public.get("72141003", {})), "no_publicado")
        self.assertNotIn("72141101", public)  # "No definido" no cuenta como nombre
        self.assertEqual(public_ancestor("72141003", public), ("721410", "Construccion de autopistas."))

    def test_export_never_includes_the_cce_translation(self):
        cce = parse_cce(CCE_ROWS)
        public = group_open_names(OPEN_ROWS)
        exported = export_public(public)
        self.assertEqual(exported["licencia"], "CC BY-SA 4.0")
        self.assertEqual(set(exported["codigos"]), {"7214", "721410", "721411"})
        text = json.dumps(exported, ensure_ascii=False)
        for cce_only in ("Pavimentación", "Puentes", "Servicios de Edificación"):
            self.assertNotIn(cce_only, text)
        self.assertNotIn(cce["721411"], text)  # publicado con otro nombre: sale el público

    def test_local_db_has_one_row_per_code_with_its_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "local", "unspsc.sqlite")
            counts = build_db(parse_cce(CCE_ROWS), group_open_names(OPEN_ROWS), path)
            db = sqlite3.connect(path)
            rows = dict(db.execute("SELECT codigo, bandera FROM codigo").fetchall())
            anc = db.execute("SELECT ancestro_publico FROM codigo WHERE codigo = '72141003'").fetchone()[0]
            variants = db.execute("SELECT COUNT(*) FROM variante").fetchone()[0]
            db.close()
        self.assertEqual(rows["721410"], "publicado_igual")
        self.assertEqual(rows["721411"], "publicado_distinto")
        self.assertEqual(rows["72141101"], "no_publicado")
        self.assertEqual(anc, "721410")
        self.assertEqual(variants, 3)
        self.assertEqual(sum(counts.values()), 6)

    def test_open_names_secop2_aggregated_secop1_code_by_code_and_resumable(self):
        calls = []

        def query(ds, select, where, group, limit):
            calls.append((ds, where, group, limit))
            return [{"c": "7214", "n": "Servicios", "k": "1"}]

        done = {"qmzu-gj57|codigo_categoria_principal", "f789-7hwg|721410"}
        rows = fetch_open_names(query, ["72", "7214", "721410", "721411", "72141003"], log=lambda _: None, done=done, workers=2)
        datasets = [c[0] for c in calls]
        self.assertNotIn("qmzu-gj57", datasets)  # ya estaba hecha: se retoma
        self.assertIn(("4ex9-j3n8", None, "codigo_categoria_principal, descripci_n_categoria_principal", 50000), calls)
        # SECOP I: una consulta por familia o clase, con limit 1; ni segmentos ni productos.
        secop1 = sorted(c[1] for c in calls if c[0] == "f789-7hwg")
        self.assertEqual(secop1, ["id_clase = '721411'", "id_familia = '7214'"])
        self.assertTrue(all(c[3] == 1 for c in calls if c[0] == "f789-7hwg"))
        self.assertIn("f789-7hwg|721411", done)
        self.assertEqual(len(rows), 3)


if __name__ == "__main__":
    unittest.main()
