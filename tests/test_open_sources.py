"""
Pruebas de las fuentes abiertas adicionales (sin red: cliente falso).
"""

import unittest
from datetime import datetime

from src.enrichers.open_sources import OpenSourcesEnricher, month_number
from src.enrichers.scope_extractor import ScopeExtractor

OFFERS = [
    {"id_del_proceso_de_compra": "CO1.BDOS.1", "identificador_de_la_oferta": "O1", "nombre_proveedor": "CONSORCIO ACERO",
     "nit_del_proveedor": "901234567", "valor_de_la_oferta": "900000000", "fecha_de_registro": "2026-09-01T00:00:00.000"},
    {"id_del_proceso_de_compra": "CO1.BDOS.1", "identificador_de_la_oferta": "O2", "nombre_proveedor": "OTRA SAS",
     "nit_del_proveedor": "800111222", "valor_de_la_oferta": "950000000"},
    {"id_del_proceso_de_compra": "CO1.BDOS.1", "identificador_de_la_oferta": "O2", "nombre_proveedor": "OTRA SAS",
     "nit_del_proveedor": "800111222", "valor_de_la_oferta": "950000000"},
]
GROUP = [
    {"codigo_grupo": "G1", "nombre_grupo": "CONSORCIO ACERO", "nombre_participante": "ACERIA UNO SAS", "nit_participante": "800000001",
     "participacion": "60", "es_lider_del_grupo": "Verdadero", "telefono_representante_legal_grupo": "3100000000",
     "correo_representante_legal_grupo": "persona@correo.com", "numero_doc_representante_legal_grupo": "55544433"},
    {"codigo_grupo": "G1", "nombre_grupo": "CONSORCIO ACERO", "nombre_participante": "MONTAJES DOS SAS", "nit_participante": "800000002",
     "participacion": "40", "es_lider_del_grupo": "Falso"},
]
SANCTIONS = [{"documento_contratista": "800000002", "nombre_contratista": "MONTAJES DOS SAS", "nombre_entidad": "MUNICIPIO X",
              "numero_de_resolucion": "RES 1 DE 2020", "valor_sancion": "5000000", "fecha_de_firmeza": "2020-05-01T00:00:00.000"}]
PAA = [
    {"id": "P1", "annio": "2026", "categorias_unspsc": "72141000;30102200", "descripcion": "Construcción de puente metálico",
     "fecha_esperada_de_recepcion": "Noviembre", "valor_total_esperado": "2500000000", "nombre_entidad": "GOBERNACION Y",
     "nit_entidad": "890000001", "modalidad": "Licitación pública", "correo_del_contacto": "persona@gov.co",
     "telefono_del_contacto": "300", "nombre_del_contacto": "Pedro"},
    {"id": "P1b", "annio": "2026", "categorias_unspsc": "72141000", "descripcion": "Construcción de puente metálico",
     "fecha_esperada_de_recepcion": "Noviembre", "valor_total_esperado": "2500000000", "nombre_entidad": "GOBERNACION Y",
     "nit_entidad": "890000001"},
    {"id": "P2", "annio": "2026", "categorias_unspsc": "72141000", "descripcion": "Obra que ya pasó",
     "fecha_esperada_de_recepcion": "Marzo", "valor_total_esperado": "900000000", "nit_entidad": "1"},
    {"id": "P3", "annio": "2026", "categorias_unspsc": "80111600", "descripcion": "Servicios personales",
     "fecha_esperada_de_recepcion": "Diciembre", "valor_total_esperado": "900000000", "nit_entidad": "2"},
    {"id": "P5", "annio": "2026", "categorias_unspsc": "72141000", "descripcion": "Valor mal digitado",
     "fecha_esperada_de_recepcion": "Diciembre", "valor_total_esperado": "6633749000000000", "nit_entidad": "4"},
    {"id": "P4", "annio": "2026", "categorias_unspsc": "39111500", "descripcion": "Luminarias pequeñas",
     "fecha_esperada_de_recepcion": "Diciembre", "valor_total_esperado": "50000000", "nit_entidad": "3"},
]


# Filas agregadas de jbjy-vk9h con los valores reales de `tipodocproveedor` (2026-10-01).
PROFILE = [
    {"modalidad_de_contratacion": "Mínima cuantía", "tipodocproveedor": "Cédula de Ciudadanía", "n": "19"},
    {"modalidad_de_contratacion": "Mínima cuantía", "tipodocproveedor": "Cédula de Extranjería", "n": "1"},
    {"modalidad_de_contratacion": "Mínima cuantía", "tipodocproveedor": "NIT", "n": "80"},
    {"modalidad_de_contratacion": "Mínima cuantía", "tipodocproveedor": "No Definido", "n": "3"},
    {"modalidad_de_contratacion": "Licitación pública", "tipodocproveedor": "NIT", "n": "40"},
    {"modalidad_de_contratacion": "Licitación pública", "tipodocproveedor": "Otro", "n": "2"},
]


class FakeClient:
    def __init__(self, fail=()):
        self.fail = fail
        self.calls = []

    def query(self, dataset_id, where=None, **kw):
        self.calls.append({"dataset_id": dataset_id, "where": where, **kw})
        if dataset_id in self.fail:
            raise RuntimeError("timeout")
        return {"wi7w-2nvm": OFFERS, "ceth-n4bn": GROUP, "4n4q-k399": SANCTIONS, "9sue-ezhx": PAA,
                "jbjy-vk9h": PROFILE}.get(dataset_id, [])


def prospect():
    return {"id": "CO1.REQ.1", "id_portafolio": "CO1.BDOS.1",
            "contratista": {"nombre": "CONSORCIO ACERO", "nit": "901234567", "es_consorcio": True},
            "contrato": {"codigo_proveedor": "G1"}}


def enricher(client=None, **kw):
    return OpenSourcesEnricher(client or FakeClient(), ScopeExtractor.TAXONOMIES, log=lambda _: None,
                               today=datetime(2026, 9, 28), **kw)


class TestOpenSources(unittest.TestCase):

    def test_offers_deduplicated_and_winner_marked(self):
        p = enricher().enrich([prospect()])[0]
        self.assertEqual(p["ofertas"]["cantidad"], 2)
        self.assertTrue(p["ofertas"]["proveedores"][0]["ganador"])
        self.assertFalse(p["ofertas"]["proveedores"][1]["ganador"])

    def test_group_members_with_history_and_no_personal_contacts(self):
        def history(nits):
            return {"800000001": {"contratos": 12, "valor_total": 3e10}}

        p = enricher(history_fn=history).enrich([prospect()])[0]
        self.assertEqual([m["nombre"] for m in p["integrantes"]], ["ACERIA UNO SAS", "MONTAJES DOS SAS"])
        self.assertTrue(p["integrantes"][0]["lider"])
        self.assertEqual(p["integrantes"][0]["contratos"], 12)
        text = repr(p)
        for secret in ("3100000000", "persona@correo.com", "55544433"):
            self.assertNotIn(secret, text)

    def test_sanctions_include_consortium_members(self):
        p = enricher().enrich([prospect()])[0]
        self.assertEqual(p["sanciones"][0]["sancionado"], "MONTAJES DOS SAS")

    def test_failed_source_reuses_previous_run(self):
        previous = [dict(prospect(), ofertas={"cantidad": 7, "proveedores": []})]
        e = enricher(FakeClient(fail=("wi7w-2nvm",)), previous=previous)
        p = e.enrich([prospect()])[0]
        self.assertEqual(p["ofertas"]["cantidad"], 7)
        self.assertEqual(e.summary["ofertas"]["estado"], "error")
        self.assertEqual(e.summary["consorcios"]["estado"], "ok")

    def test_paa_filters_dedupes_and_hides_contacts(self):
        items = enricher().paa()
        self.assertEqual([i["id"] for i in items], ["P1"])
        self.assertEqual(items[0]["mes_esperado"], 11)
        # El orden de los sectores sigue al de config/taxonomy.json: no se asume ninguno.
        self.assertIn("acero_metalmecanica", [s["id"] for s in items[0]["sectores"]])
        self.assertNotIn("persona@gov.co", repr(items))
        self.assertNotIn("Pedro", repr(items))

    def test_paa_is_not_queried_with_two_digit_segments(self):
        class Recorder(FakeClient):
            def __init__(self):
                super().__init__()
                self.wheres = []

            def query(self, dataset_id, where=None, **kw):
                self.wheres.append(where or "")
                return super().query(dataset_id, where=where, **kw)

        client = Recorder()
        taxonomy = {"salud": {"name": "Salud", "unspsc_prefixes": ["42"]},
                    "acero": {"name": "Acero", "unspsc_prefixes": ["7214", "3010"]}}
        OpenSourcesEnricher(client, taxonomy, log=lambda _: None, today=datetime(2026, 9, 28)).fetch_paa()
        self.assertFalse(any("'%42%'" in w for w in client.wheres))
        self.assertTrue(any("'%7214%'" in w for w in client.wheres))

    def test_bidder_profile_counts_natural_persons_by_modality(self):
        client = FakeClient()
        profile = enricher(client).bidder_profile()
        rows = {r["modalidad"]: r for r in profile["modalidades"]}
        self.assertEqual(rows["Mínima cuantía"], {"modalidad": "Mínima cuantía", "persona_natural": 20, "juridica": 80, "sin_dato": 3})
        self.assertEqual(rows["Licitación pública"]["sin_dato"], 2)
        self.assertEqual(profile["desde"], "2025-09-28")
        # La consulta se restringe a contratos parecidos a los del tablero: sin prestación de servicios.
        where = client.calls[-1]["where"]
        self.assertIn("valor_del_contrato >= 50000000", where)
        self.assertIn("'Suministros'", where)
        self.assertNotIn("Prestación de servicios", where)
        self.assertEqual(client.calls[-1]["group"], "modalidad_de_contratacion, tipodocproveedor")

    def test_bidder_profile_reuses_previous_on_failure(self):
        previous = {"desde": "2025-09-01", "modalidades": [{"modalidad": "X", "persona_natural": 1, "juridica": 1, "sin_dato": 0}]}
        e = enricher(FakeClient(fail=("jbjy-vk9h",)), previous_profile=previous)
        self.assertEqual(e.bidder_profile(), previous)
        self.assertEqual(e.summary["perfil_proponente"]["estado"], "error")
        self.assertIsNone(enricher(FakeClient(fail=("jbjy-vk9h",))).bidder_profile())

    def test_month_number(self):
        self.assertEqual(month_number("Septiembre"), 9)
        self.assertEqual(month_number("11"), 11)
        self.assertIsNone(month_number("No Definido"))


if __name__ == "__main__":
    unittest.main()
