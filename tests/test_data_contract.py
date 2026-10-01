"""
Pruebas del contrato de datos entre el pipeline y la web, y de los archivos que se exportan.
"""

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone

from src.curation import light_record
from src.enrichers.scope_extractor import ScopeExtractor
from src.export_prospects import (
    BASE_DIR,
    DATASET_JSON,
    HIDDEN_WEB_MAX,
    cap_hidden,
    export_dataset,
    export_hidden,
    parse_args,
)
from src.schema import SchemaError, validate_dataset, validate_hidden, validate_meta, validate_prospects
from src.sync_status import build_meta

NOW = datetime(2026, 9, 30, 11, 5, tzinfo=timezone.utc)


def prospect(pid="CO1.REQ.1", **extra):
    item = ScopeExtractor().enrich({
        "id_del_proceso": pid,
        "referencia_del_proceso": "LP-001",
        "entidad": "MUNICIPIO DE PRUEBA",
        "precio_base": "500000000",
        "nombre_del_procedimiento": "Suministro de estructura metálica",
        "estado_del_procedimiento": "Publicado",
    })
    item.update(extra)
    return item


class TestProspectContract(unittest.TestCase):

    def test_pipeline_output_is_valid(self):
        self.assertEqual(validate_prospects([prospect()], ScopeExtractor.TAXONOMIES), [])

    def test_missing_field_and_wrong_type_are_reported(self):
        broken = prospect()
        del broken["etapa_comercial"]
        broken["precio"] = "500000000"
        errors = validate_prospects([broken])
        self.assertTrue(any("falta 'etapa_comercial'" in e for e in errors))
        self.assertTrue(any("'precio' tiene tipo str" in e for e in errors))

    def test_duplicate_ids_are_reported(self):
        errors = validate_prospects([prospect(), prospect()])
        self.assertTrue(any("id repetido" in e for e in errors))

    def test_unknown_or_empty_sectors_are_reported(self):
        unknown = validate_prospects([prospect(sectores=[{"id": "inventado", "name": "X"}])], ScopeExtractor.TAXONOMIES)
        self.assertTrue(any("sector desconocido 'inventado'" in e for e in unknown))
        empty = validate_prospects([prospect(sectores=[])])
        self.assertTrue(any("sin sectores" in e for e in empty))

    def test_score_out_of_range_is_reported(self):
        self.assertTrue(any("score_calidad" in e for e in validate_prospects([prospect(score_calidad=0)])))

    def test_invalid_dataset_raises_with_a_readable_message(self):
        with self.assertRaises(SchemaError) as ctx:
            validate_dataset([{"id": "A"}])
        self.assertIn("El dataset curado no cumple el contrato de datos", str(ctx.exception))

    def test_published_dataset_in_the_repository_is_valid(self):
        """El dataset que hoy está publicado debe cumplir el contrato: si no, el contrato está mal."""
        with open(os.path.join(BASE_DIR, "data", DATASET_JSON), encoding="utf-8") as f:
            published = json.load(f)
        self.assertGreater(len(published), 0)
        self.assertEqual(validate_prospects(published), [])


class TestHiddenAndMetaContract(unittest.TestCase):

    def test_hidden_items_are_valid_and_reason_is_checked(self):
        item = light_record(prospect(), "sin_sector")
        self.assertEqual(validate_hidden([item]), [])
        self.assertTrue(any("motivo desconocido" in e for e in validate_hidden([dict(item, motivo="otro")])))

    def test_meta_carries_queries_and_funnel(self):
        queries = [{"nombre": "sector:acero", "estado": "ok", "registros": 10, "truncada": False},
                   {"nombre": "general:publicados", "estado": "error", "registros": 0, "truncada": False}]
        funnel = {"descargados": 10, "duplicados": 1, "rechazados": 4, "rechazados_por_motivo": {},
                  "sin_clasificar": 3, "clasificados": 2, "en_tablero": 1, "fuera_de_corte": 1}
        meta = build_meta([prospect()], [], 10, NOW, NOW, {"errores": []}, [], queries=queries, funnel=funnel)
        self.assertEqual(validate_meta(meta), [])
        self.assertEqual(meta["fuentes"]["procesos"]["estado"], "parcial")
        self.assertEqual(meta["fuentes"]["procesos"]["consultas_con_error"], ["general:publicados"])
        self.assertEqual(meta["embudo"]["sin_clasificar"], 3)
        self.assertEqual(meta["historial"][0]["sin_clasificar"], 3)

    def test_meta_without_queries_keeps_the_previous_behaviour(self):
        meta = build_meta([], [], 5, NOW, NOW, None, [])
        self.assertEqual(meta["fuentes"]["procesos"]["estado"], "ok")
        self.assertIsNone(meta["embudo"])
        self.assertIsNone(meta["perfil_proponente"])
        self.assertEqual(validate_meta(meta), [])

    def test_meta_bidder_profile_shape_is_checked(self):
        good = {"desde": "2025-10-01", "modalidades": [{"modalidad": "Mínima cuantía", "persona_natural": 20, "juridica": 80, "sin_dato": 3}]}
        meta = build_meta([], [], 5, NOW, NOW, None, [], bidder_profile=good)
        self.assertEqual(meta["perfil_proponente"], good)
        self.assertEqual(validate_meta(meta), [])
        bad = {"modalidades": [{"modalidad": "Mínima cuantía", "persona_natural": "20", "juridica": 80, "sin_dato": 3}]}
        self.assertTrue(validate_meta(dict(meta, perfil_proponente=bad)))
        self.assertTrue(validate_meta(dict(meta, perfil_proponente={"desde": "x"})))


class TestExports(unittest.TestCase):

    def test_dataset_files_use_the_current_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir, web_dir = os.path.join(tmp, "data"), os.path.join(tmp, "web")
            export_dataset([prospect()], data_dir, web_dir, {"generated_at": "2026-09-30T11:05:00Z"}, [])
            self.assertEqual(sorted(os.listdir(data_dir)), ["prospects.csv", "prospects.json", "prospects_summary.md"])
            with open(os.path.join(web_dir, "data.js"), encoding="utf-8") as f:
                content = f.read()
        self.assertTrue(content.startswith("window.PROSPECTS_DATA = "))
        self.assertIn('window.PROSPECTS_UPDATED_AT = "2026-09-30T11:05:00Z";', content)
        self.assertIn("window.PAA_DATA = ", content)

    def test_hidden_web_file_is_capped_but_counts_everything(self):
        reasons = ("sin_sector", "fuera_de_corte", "convenio")
        hidden = [light_record(prospect(f"ID{n}"), reasons[n % 3]) for n in range(HIDDEN_WEB_MAX + 10)]
        hidden[0]["tipo_contrato"] = "Seguros"
        hidden[1]["tipo_contrato"] = "Seguros"  # fuera del corte: no cuenta como seguro en "Otros"
        with tempfile.TemporaryDirectory() as tmp:
            data_dir, web_dir = os.path.join(tmp, "data"), os.path.join(tmp, "web")
            export_hidden(hidden, "# reporte\n", data_dir, web_dir, "2026-09-30T11:05:00Z", full_dump=True)
            with open(os.path.join(web_dir, "hidden.js"), encoding="utf-8") as f:
                content = f.read()
            with open(os.path.join(data_dir, "hidden_full.json"), encoding="utf-8") as f:
                full = json.load(f)
            self.assertTrue(os.path.exists(os.path.join(data_dir, "hidden_summary.md")))
        prefix = "window.HIDDEN_DATA = "
        payload = json.loads(content[len(prefix):].rstrip().rstrip(";"))
        self.assertEqual(payload["total"], HIDDEN_WEB_MAX + 10)
        self.assertEqual(len(payload["items"]), HIDDEN_WEB_MAX)
        self.assertEqual(payload["sin_sector"] + payload["fuera_de_corte"] + payload["convenio"], payload["total"])
        self.assertEqual(payload["seguros"], 1)
        self.assertEqual(len(full), HIDDEN_WEB_MAX + 10)

    def test_cap_splits_three_reasons(self):
        items = [{"id": f"{r}{i}", "motivo": r} for r in ("sin_sector", "fuera_de_corte", "convenio") for i in range(500)]
        capped = cap_hidden(items, limit=100)
        counts = {r: sum(1 for h in capped if h["motivo"] == r) for r in ("sin_sector", "fuera_de_corte", "convenio")}
        self.assertEqual(counts, {"sin_sector": 60, "fuera_de_corte": 20, "convenio": 20})
        self.assertEqual(len(cap_hidden(items, limit=7)), 7)

    def test_cap_keeps_both_reasons_and_passes_unused_quota(self):
        def items(reason, n):
            return [{"id": f"{reason}{i}", "motivo": reason} for i in range(n)]

        capped = cap_hidden(items("sin_sector", 500) + items("fuera_de_corte", 500), limit=100)
        self.assertEqual(sum(1 for h in capped if h["motivo"] == "sin_sector"), 75)
        self.assertEqual(sum(1 for h in capped if h["motivo"] == "fuera_de_corte"), 25)
        self.assertEqual(capped[0]["id"], "sin_sector0")

        few_overflow = cap_hidden(items("sin_sector", 500) + items("fuera_de_corte", 10), limit=100)
        self.assertEqual(sum(1 for h in few_overflow if h["motivo"] == "sin_sector"), 90)
        few_unclassified = cap_hidden(items("sin_sector", 10) + items("fuera_de_corte", 500), limit=100)
        self.assertEqual(sum(1 for h in few_unclassified if h["motivo"] == "fuera_de_corte"), 90)
        self.assertEqual(len(cap_hidden(items("sin_sector", 3), limit=100)), 3)

    def test_out_option_is_parsed(self):
        self.assertIsNone(parse_args([]).out)
        self.assertEqual(parse_args(["--out", "tmp/run"]).out, "tmp/run")


if __name__ == "__main__":
    unittest.main()
