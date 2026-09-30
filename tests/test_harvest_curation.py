"""
Pruebas de la descarga (cliente, consultas) y la curaduría (duplicados, embudo, sectores).
"""

import os
import unittest
from datetime import datetime
from unittest import mock

from src.curation import (
    build_hidden,
    check_funnel,
    classify,
    dedupe_by_portfolio,
    funnel_counts,
    light_record,
    select_curated,
)
from src.discovery import (
    family_of,
    frequent_phrases,
    group_by_contract_type,
    group_by_family,
    render_report,
    top_terms,
)
from src.enrichers.scope_extractor import ScopeExtractor
from src.filters.noise_filter import NoiseFilter, reason_group
from src.harvest import HarvestError, build_queries, harvest, sector_where
from src.services.socrata_client import SocrataClient, SocrataError
from src.taxonomy import SIN_CLASIFICAR, TaxonomyError, fold, load_groups, load_taxonomy, normalize_unspsc

TODAY = datetime(2026, 9, 30)


def raw(pid, portfolio=None, **extra):
    """Proceso crudo de SECOP II que pasa el filtro de ruido."""
    record = {
        "id_del_proceso": pid,
        "id_del_portafolio": portfolio,
        "referencia_del_proceso": f"REF-{pid}",
        "entidad": "MUNICIPIO DE PRUEBA",
        "precio_base": "500000000",
        "modalidad_de_contratacion": "Licitación pública",
        "tipo_de_contrato": "Suministros",
        "nombre_del_procedimiento": "Suministro de estructura metálica",
        "descripci_n_del_procedimiento": "Suministro e instalación de estructura metálica para cubierta",
        "estado_del_procedimiento": "Publicado",
        "adjudicado": "No",
        "codigo_principal_de_categoria": "V1.30102200",
    }
    record.update(extra)
    return record


class ScriptedClient(SocrataClient):
    """Cliente sin red: `_fetch` devuelve lo que indique el guion, en orden."""

    def __init__(self, script, **kwargs):
        self.script = list(script)
        self.urls = []
        self.sleeps = []
        super().__init__(sleep=self.sleeps.append, **kwargs)

    def _fetch(self, url):
        self.urls.append(url)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


class TestTaxonomy(unittest.TestCase):

    def test_loads_sectors_with_defaults(self):
        taxonomy = load_taxonomy()
        self.assertIn("acero_metalmecanica", taxonomy)
        for sector in taxonomy.values():
            self.assertIn("excluir_si", sector)
            self.assertIn("harvest", sector)

    def test_unspsc_code_is_normalized(self):
        self.assertEqual(normalize_unspsc("V1.72141000"), "72141000")
        self.assertEqual(normalize_unspsc(" 72141000 "), "72141000")
        self.assertEqual(normalize_unspsc("No definido"), "")
        self.assertEqual(normalize_unspsc(None), "")

    GROUPS = [{"id": "g", "name": "Grupo", "orden": 1}]
    OK = {"name": "X", "grupo": "g", "keywords": ["x"], "unspsc_prefixes": [], "weight": 1}

    def _write(self, tmp, sectors, groups=GROUPS):
        import json
        path = os.path.join(tmp, "taxonomy.json")
        content = {"sectores": sectors}
        if groups is not None:
            content["grupos"] = groups
        with open(path, "w", encoding="utf-8") as f:
            json.dump(content, f)
        return path

    def test_rejects_reserved_and_malformed_sectors(self):
        import tempfile
        ok = self.OK
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {SIN_CLASIFICAR: ok}))
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {"a": {"name": "A", "grupo": "g", "keywords": ["x"]}}))
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {"a": dict(ok, excluir_si={"otra": ["y"]})}))
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {"a": dict(ok, tipos_contrato="Obra")}))

    def test_every_sector_needs_a_known_group(self):
        import tempfile
        without_group = {k: v for k, v in self.OK.items() if k != "grupo"}
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {"a": without_group}))
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {"a": dict(self.OK, grupo="otro")}))
            with self.assertRaises(TaxonomyError):
                load_taxonomy(self._write(tmp, {"a": self.OK}, groups=None))

    def test_groups_come_in_display_order(self):
        import tempfile
        groups = [{"id": "b", "name": "B", "orden": 2}, {"id": "a", "name": "A", "orden": 1}]
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, {"x": dict(self.OK, grupo="a")}, groups=groups)
            self.assertEqual([g["id"] for g in load_groups(path)], ["a", "b"])

    def test_every_real_sector_has_a_known_group(self):
        group_ids = {g["id"] for g in load_groups()}
        for key, sector in load_taxonomy().items():
            self.assertIn(sector["grupo"], group_ids, key)


class TestClassification(unittest.TestCase):

    def setUp(self):
        self.extractor = ScopeExtractor()

    def sector_ids(self, **fields):
        return [s["id"] for s in self.extractor.enrich(raw("CO1.REQ.1", **fields))["sectores"]]

    def test_grounding_rod_is_not_steel(self):
        ids = self.sector_ids(
            nombre_del_procedimiento="Suministro de varillas de cobre",
            descripci_n_del_procedimiento="Varillas de cobre para puesta a tierra de redes",
            codigo_principal_de_categoria="No definido",
        )
        self.assertNotIn("acero_metalmecanica", ids)

    def test_steel_rod_is_still_steel(self):
        ids = self.sector_ids(
            nombre_del_procedimiento="Suministro de varilla corrugada",
            descripci_n_del_procedimiento="Varilla para reforzamiento de placas",
            codigo_principal_de_categoria="No definido",
        )
        self.assertIn("acero_metalmecanica", ids)

    def test_unspsc_with_version_prefix_matches_sector(self):
        ids = self.sector_ids(
            nombre_del_procedimiento="Adquisición de elementos",
            descripci_n_del_procedimiento="Elementos varios",
            codigo_principal_de_categoria="V1.39111500",
        )
        self.assertEqual(ids, ["energia_solar_alumbrado"])

    def test_construction_code_alone_does_not_make_a_process_steel(self):
        fields = dict(nombre_del_procedimiento="Mejoramiento urbano", descripci_n_del_procedimiento="Mejoramiento urbano",
                      codigo_principal_de_categoria="V1.72141100")
        self.assertEqual(self.sector_ids(**fields), ["obra_civil_general"])

    def test_code_adds_score_when_a_keyword_also_matches(self):
        with_code = self.extractor.enrich(raw("A", codigo_principal_de_categoria="V1.30102200"))
        without = self.extractor.enrich(raw("A", codigo_principal_de_categoria="No definido"))
        score = lambda out: next(s for s in out["sectores"] if s["id"] == "acero_metalmecanica")["relevance_score"]  # noqa: E731
        self.assertEqual(score(with_code) - score(without), 25)

    def test_contract_type_classifies_and_adds_score(self):
        taxonomy = {
            "obra": {"name": "Obra", "keywords": ["pavimento"], "unspsc_prefixes": [], "weight": 1,
                     "tipos_contrato": ["Obra"]},
            "otro": {"name": "Otro", "keywords": ["pavimento"], "unspsc_prefixes": [], "weight": 1},
        }
        extractor = ScopeExtractor(taxonomy)
        by_type = extractor.enrich(raw("A", tipo_de_contrato="Obra", nombre_del_procedimiento="Adecuación de sede",
                                       descripci_n_del_procedimiento="Adecuación de sede",
                                       codigo_principal_de_categoria="No definido"))
        self.assertEqual([s["id"] for s in by_type["sectores"]], ["obra"])
        self.assertEqual(by_type["sectores"][0]["relevance_score"], 25)

        both = extractor.enrich(raw("B", tipo_de_contrato="OBRA", nombre_del_procedimiento="Pavimento",
                                    descripci_n_del_procedimiento="", codigo_principal_de_categoria="No definido"))
        scores = {s["id"]: s["relevance_score"] for s in both["sectores"]}
        self.assertEqual(scores["obra"] - scores["otro"], 25)

    def test_contract_type_does_not_classify_sectors_without_the_rule(self):
        taxonomy = {"otro": {"name": "Otro", "keywords": ["pavimento"], "unspsc_prefixes": [], "weight": 1}}
        out = ScopeExtractor(taxonomy).enrich(raw("A", tipo_de_contrato="Obra", nombre_del_procedimiento="Adecuación",
                                                  descripci_n_del_procedimiento="Adecuación",
                                                  codigo_principal_de_categoria="No definido"))
        self.assertEqual(out["sectores"], [])

    def test_fold_ignores_accents_and_case(self):
        self.assertEqual(fold(" Interventoría "), "interventoria")
        self.assertEqual(fold(None), "")

    def test_adjusted_price_keeps_the_original(self):
        out = self.extractor.enrich(raw("CO1.REQ.1", precio_base="120000000000",
                                        modalidad_de_contratacion="Selección abreviada subasta inversa"))
        self.assertEqual(out["precio"], 120_000_000)
        self.assertEqual(out["precio_ajustado"]["original"], 120_000_000_000)

    def test_normal_and_awarded_prices_are_not_flagged(self):
        self.assertIsNone(self.extractor.enrich(raw("CO1.REQ.1"))["precio_ajustado"])
        awarded = self.extractor.enrich(raw("CO1.REQ.1", valor_total_adjudicacion="480000000"))
        self.assertEqual(awarded["precio"], 480_000_000)
        self.assertIsNone(awarded["precio_ajustado"])


class TestNoiseFilterReasons(unittest.TestCase):

    def test_reasons_are_grouped(self):
        nf = NoiseFilter()
        _, low = nf.evaluate(raw("A", precio_base="1000000"))
        _, ops = nf.evaluate(raw("B", tipo_de_contrato="Prestación de servicios"))
        _, state = nf.evaluate(raw("C", estado_del_procedimiento="Cancelado"))
        self.assertEqual(reason_group(low), "Valor por debajo del mínimo")
        self.assertEqual(reason_group(ops), "Tipo de contrato: prestación de servicios")
        self.assertEqual(reason_group(state), "Estado no viable (cancelado, desierto, cerrado)")
        self.assertEqual(reason_group("algo nuevo"), "Otro motivo")

    def test_administrative_unspsc_is_blocked_with_version_prefix(self):
        passes, reason = NoiseFilter().evaluate(raw(
            "A", codigo_principal_de_categoria="V1.80111600", precio_base="900000000",
            modalidad_de_contratacion="Contratación directa", tipo_de_contrato="Otro",
        ))
        self.assertFalse(passes)
        self.assertIn("UNSPSC", reason)


class TestSocrataClient(unittest.TestCase):

    def test_retries_transient_errors_with_backoff(self):
        client = ScriptedClient([SocrataError("timeout"), SocrataError("timeout"), [{"a": 1}]], retries=2, backoff=1)
        self.assertEqual(client.query(where="x = 1"), [{"a": 1}])
        self.assertEqual(client.sleeps, [1, 2])

    def test_gives_up_after_the_last_retry(self):
        client = ScriptedClient([SocrataError("timeout")] * 2, retries=1)
        with self.assertRaises(SocrataError):
            client.query()

    def test_malformed_query_is_not_retried(self):
        client = ScriptedClient([SocrataError("HTTP Error 400", retryable=False), [{"a": 1}]], retries=3)
        with self.assertRaises(SocrataError):
            client.query()
        self.assertEqual(len(client.urls), 1)

    def test_query_all_paginates_until_a_short_page(self):
        client = ScriptedClient([[{"i": n} for n in range(3)], [{"i": 3}]])
        rows = client.query_all(order="id_del_proceso", page_size=3, max_rows=100)
        self.assertEqual(len(rows), 4)
        self.assertIn("%24offset=3", client.urls[1])

    def test_query_all_stops_at_max_rows(self):
        client = ScriptedClient([[{"i": n} for n in range(3)], [{"i": 3}, {"i": 4}]])
        rows = client.query_all(order="id_del_proceso", page_size=3, max_rows=5)
        self.assertEqual(len(rows), 5)
        self.assertIn("%24limit=2", client.urls[1])

    def test_query_all_requires_an_order(self):
        with self.assertRaises(ValueError):
            ScriptedClient([]).query_all()

    def test_app_token_comes_from_the_environment(self):
        with mock.patch.dict(os.environ, {"SOCRATA_APP_TOKEN": "abc"}):
            self.assertEqual(SocrataClient().headers["X-App-Token"], "abc")
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertNotIn("X-App-Token", SocrataClient().headers)


class FakeHarvestClient:
    def __init__(self, fail=(), rows_per_query=None):
        self.fail = fail
        self.rows = rows_per_query or {}
        self.calls = []

    def query_all(self, where=None, order=None, max_rows=None, **_):
        self.calls.append({"where": where, "order": order, "max_rows": max_rows})
        for marker in self.fail:
            if marker in where:
                raise SocrataError("timeout")
        for marker, rows in self.rows.items():
            if marker in where:
                return rows
        return []


TAXONOMY = {
    "acero": {"name": "Acero", "keywords": ["acero"], "unspsc_prefixes": [], "weight": 1,
              "harvest": {"precio_min": 100, "titulo": ["VIGAS"], "descripcion": ["ACERO", "O'HIGGINS"]}},
    "obra": {"name": "Obra", "keywords": ["obra"], "unspsc_prefixes": [], "weight": 1, "harvest": None},
}


class TestHarvest(unittest.TestCase):

    def test_queries_are_generated_from_the_taxonomy(self):
        queries = build_queries(TAXONOMY, TODAY)
        self.assertEqual([q["nombre"] for q in queries], ["sector:acero", "general:publicados", "general:adjudicados"])
        self.assertTrue(queries[0]["obligatoria"])
        self.assertFalse(queries[1]["obligatoria"])

    def test_sector_query_uses_patterns_price_and_keeps_undated_rows(self):
        where = sector_where(TAXONOMY["acero"]["harvest"], datetime(2026, 6, 2))
        self.assertIn("precio_base >= 100", where)
        self.assertIn("upper(nombre_del_procedimiento) like '%VIGAS%'", where)
        self.assertIn("upper(descripci_n_del_procedimiento) like '%ACERO%'", where)
        self.assertIn("like '%O''HIGGINS%'", where)
        self.assertIn("fecha_de_publicacion_del >= '2026-06-02T00:00:00' OR fecha_de_publicacion_del IS NULL", where)

    def test_general_queries_use_values_that_exist_in_secop(self):
        general, awarded = build_queries(TAXONOMY, TODAY)[1:]
        self.assertIn("adjudicado = 'Si'", awarded["where"])
        for where in (general["where"], awarded["where"]):
            self.assertIn("tipo_de_contrato != 'Prestación de servicios'", where)
            self.assertIn("'2026-09-16T00:00:00'", where)

    def test_failed_sector_query_stops_the_run(self):
        with self.assertRaises(HarvestError):
            harvest(FakeHarvestClient(fail=["VIGAS"]), TAXONOMY, TODAY, log=lambda _: None)

    def test_failed_general_query_is_reported_but_not_fatal(self):
        client = FakeHarvestClient(fail=["adjudicado = 'Si'"], rows_per_query={"VIGAS": [raw("A"), raw("B")]})
        out = harvest(client, TAXONOMY, TODAY, log=lambda _: None)
        self.assertEqual(len(out["records"]), 2)
        states = {q["nombre"]: q["estado"] for q in out["consultas"]}
        self.assertEqual(states, {"sector:acero": "ok", "general:publicados": "ok", "general:adjudicados": "error"})

    def test_same_process_from_two_queries_is_kept_once_and_truncation_is_flagged(self):
        many = [raw(f"G{n}") for n in range(5000)]
        client = FakeHarvestClient(rows_per_query={"VIGAS": [raw("A"), raw("G1")], "adjudicado = 'Si'": [], "precio_base >= 50000000": many})
        out = harvest(client, TAXONOMY, TODAY, log=lambda _: None)
        self.assertEqual(len(out["records"]), 5001)
        flags = {q["nombre"]: q["truncada"] for q in out["consultas"]}
        self.assertTrue(flags["general:publicados"])
        self.assertFalse(flags["sector:acero"])


class TestCuration(unittest.TestCase):

    def test_keeps_the_latest_phase_of_each_portfolio(self):
        records = [raw("CO1.REQ.100", "P1"), raw("CO1.REQ.250", "P1"), raw("CO1.REQ.180", "P1")]
        kept, removed = dedupe_by_portfolio(records)
        self.assertEqual([r["id_del_proceso"] for r in kept], ["CO1.REQ.250"])
        self.assertEqual(removed, 2)

    def test_awarded_row_wins_over_a_later_phase(self):
        records = [raw("CO1.REQ.100", "P1", adjudicado="Si"), raw("CO1.REQ.250", "P1")]
        kept, _ = dedupe_by_portfolio(records)
        self.assertEqual(kept[0]["id_del_proceso"], "CO1.REQ.100")

    def test_different_portfolios_with_same_price_are_not_merged(self):
        kept, removed = dedupe_by_portfolio([raw("A", "P1"), raw("B", "P2"), raw("C", None), raw("D", None)])
        self.assertEqual(len(kept), 4)
        self.assertEqual(removed, 0)

    def funnel(self):
        records = [
            raw("CO1.REQ.1", "P1"),
            raw("CO1.REQ.2", "P1"),                                   # duplicado
            raw("CO1.REQ.3", "P3", precio_base="1000"),               # rechazado
            raw("CO1.REQ.4", "P4", nombre_del_procedimiento="Compra de uniformes",
                descripci_n_del_procedimiento="Dotación de uniformes", codigo_principal_de_categoria="V1.53101500"),
            raw("CO1.REQ.5", "P5", adjudicado="Si", nombre_del_proveedor="ACEROS SAS"),
        ]
        return classify(records, NoiseFilter(), ScopeExtractor())

    def test_every_downloaded_process_is_accounted_for(self):
        funnel = self.funnel()
        curated = select_curated(funnel["classified"], target_count=1)
        counts = funnel_counts(funnel, curated)
        self.assertEqual(counts["descargados"], 5)
        self.assertEqual(counts["duplicados"], 1)
        self.assertEqual(counts["rechazados"], 1)
        self.assertEqual(counts["sin_clasificar"], 1)
        self.assertEqual(counts["clasificados"], 2)
        self.assertEqual(counts["en_tablero"], 1)
        self.assertEqual(counts["fuera_de_corte"], 1)
        check_funnel(counts)
        with self.assertRaises(AssertionError):
            check_funnel(dict(counts, rechazados=0))

    def test_hidden_list_has_unclassified_and_overflow(self):
        funnel = self.funnel()
        curated = select_curated(funnel["classified"], target_count=1)
        hidden = build_hidden(funnel, curated)
        self.assertEqual(sorted(h["motivo"] for h in hidden), ["fuera_de_corte", "sin_sector"])
        unclassified = next(h for h in hidden if h["motivo"] == "sin_sector")
        self.assertEqual(unclassified["sectores"][0]["id"], SIN_CLASIFICAR)
        self.assertEqual(unclassified["unspsc"], "53101500")
        self.assertNotIn(curated[0]["id"], [h["id"] for h in hidden])

    def test_selection_balances_awarded_and_open(self):
        extractor = ScopeExtractor()
        awarded = [extractor.enrich(raw(f"A{n}", adjudicado="Si", nombre_del_proveedor="X SAS")) for n in range(5)]
        opened = [extractor.enrich(raw(f"O{n}")) for n in range(5)]
        picked = select_curated(awarded + opened, target_count=4, awarded_quota=2, open_quota=2)
        self.assertEqual(sum(1 for p in picked if p["id"].startswith("A")), 2)
        self.assertEqual(sum(1 for p in picked if p["id"].startswith("O")), 2)

    def test_quota_not_filled_is_completed_from_the_other_group(self):
        extractor = ScopeExtractor()
        opened = [extractor.enrich(raw(f"O{n}")) for n in range(5)]
        self.assertEqual(len(select_curated(opened, target_count=4, awarded_quota=2, open_quota=2)), 4)

    def test_light_record_truncates_long_descriptions(self):
        item = ScopeExtractor().enrich(raw("A", descripci_n_del_procedimiento="x" * 900))
        light = light_record(item, "fuera_de_corte")
        self.assertLessEqual(len(light["descripcion"]), 241)
        self.assertNotIn("contratista", light)


class TestDiscovery(unittest.TestCase):

    ITEMS = [
        {"unspsc": "53101500", "precio": 300e6, "descripcion": "Dotación de uniformes escolares", "etapa_comercial": "Licitación Abierta (En Ofertas)"},
        {"unspsc": "53102700", "precio": 100e6, "descripcion": "Uniformes para personal operativo", "etapa_comercial": "Adjudicado (Contratista Seleccionado)"},
        {"unspsc": None, "precio": 50e6, "descripcion": "Otro objeto", "etapa_comercial": "Borrador de Pliegos"},
    ]

    def test_groups_by_unspsc_family(self):
        groups = group_by_family(self.ITEMS)
        self.assertEqual(groups[0]["familia"], "5310")
        self.assertEqual(groups[0]["procesos"], 2)
        self.assertEqual(groups[0]["valor"], 400e6)
        self.assertEqual(groups[0]["adjudicados"], 1)
        self.assertIn("uniformes", groups[0]["terminos"])
        self.assertEqual(groups[1]["familia"], "sin código")
        self.assertEqual(family_of(None), "sin código")

    def test_terms_ignore_generic_procurement_words(self):
        terms = top_terms(["Suministro de luminarias para el municipio", "Suministro de luminarias y postes"])
        self.assertEqual(terms, ["luminarias"])

    def test_items_without_code_are_grouped_by_contract_type(self):
        items = [
            {"tipo_contrato": "Suministros", "precio": 200e6, "descripcion": "Suministro de aire acondicionado"},
            {"tipo_contrato": "Suministros", "precio": 100e6, "descripcion": "Mantenimiento de aire acondicionado"},
            {"tipo_contrato": None, "precio": 50e6, "descripcion": "Otro"},
        ]
        groups = group_by_contract_type(items)
        self.assertEqual([(g["tipo"], g["procesos"], g["valor"]) for g in groups],
                         [("Suministros", 2, 300e6), ("(sin tipo)", 1, 50e6)])

    def test_frequent_phrases_count_processes_and_skip_generic_words(self):
        items = [{"precio": 100e6, "descripcion": "Suministro de aire acondicionado, aire acondicionado central"},
                 {"precio": 50e6, "descripcion": "Mantenimiento del aire acondicionado"}]
        phrases = frequent_phrases(items, min_count=2)
        self.assertEqual(phrases, [{"frase": "aire acondicionado", "procesos": 2, "valor": 150e6}])
        report = render_report(
            {"descargados": 2, "duplicados": 0, "rechazados": 0, "rechazados_por_motivo": {}, "sin_clasificar": 2,
             "clasificados": 0, "en_tablero": 0, "fuera_de_corte": 0},
            [], "2026-09-30T11:00:00Z", 14, phrases=phrases,
            contract_types=[{"tipo": "Suministros", "procesos": 2, "valor": 150e6, "terminos": ["aire"]}],
        )
        self.assertIn("| aire acondicionado | 2 | $150 M |", report)
        self.assertIn("2 de los 2 procesos sin clasificar no traen código UNSPSC", report)

    def test_report_figures_come_from_the_counts(self):
        counts = {"descargados": 900, "duplicados": 40, "rechazados": 300, "rechazados_por_motivo": {"Valor por debajo del mínimo": 300},
                  "sin_clasificar": 410, "clasificados": 150, "en_tablero": 120, "fuera_de_corte": 30}
        report = render_report(counts, group_by_family(self.ITEMS), "2026-09-30T11:00:00Z", 14,
                               queries=[{"nombre": "sector:acero", "estado": "ok", "registros": 7, "truncada": False}])
        self.assertIn("| Descargados de SECOP II | 900 |", report)
        self.assertIn("**410**", report)
        self.assertIn("| Valor por debajo del mínimo | 300 |", report)
        self.assertIn("| 5310 | 2 | 1 | $400 M |", report)
        self.assertIn("| `sector:acero` | ok | 7 | no |", report)


if __name__ == "__main__":
    unittest.main()
