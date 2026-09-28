"""
Pruebas del cruce con SECOP II Contratos (sin red: cliente falso).
"""

import unittest
from datetime import datetime

from src.enrichers.contract_enricher import ContractEnricher, normalize_nit, notice_uid, summarize_contracts


RAW_CONTRACT = {
    "proceso_de_compra": "CO1.BDOS.100",
    "id_contrato": "CO1.PCCNTR.1",
    "estado_contrato": "En ejecución",
    "objeto_del_contrato": "Suministro de estructuras metálicas",
    "fecha_de_firma": "2026-09-01T00:00:00.000",
    "fecha_de_inicio_de_ejecucion": "2026-09-10T00:00:00.000",
    "fecha_de_fin_de_ejecucion": "2027-03-10T00:00:00.000",
    "valor_del_contrato": "1000000000",
    "valor_facturado": "300000000",
    "valor_pagado": "250000000",
    "habilita_pago_adelantado": "Si",
    "valor_de_pago_adelantado": "200000000",
    "dias_adicionados": "0",
    "es_pyme": "No",
    "es_grupo": "Si",
    "sistema_general_de_regal_as": "500000000",
    "recursos_propios": "0",
    "proveedor_adjudicado": "CONSORCIO ACERO",
    "documento_proveedor": "901234567",
    "nombre_representante_legal": "Ana Pérez",
    "identificaci_n_representante_legal": "12345678",
    "nombre_ordenador_del_gasto": "Luis Gómez",
    "nombre_supervisor": "Marta Ruiz",
    "nombre_del_banco": "Banco X",
    "n_mero_de_cuenta": "000123",
    "urlproceso": {"url": "https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.555"},
}


class FakeClient:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def query(self, dataset_id, where=None, select=None, group=None, order=None, limit=100, offset=0):
        self.calls.append({"where": where, "select": select, "group": group})
        if self.fail:
            raise RuntimeError("sin red")
        if select is None:
            return [RAW_CONTRACT]
        if group == "documento_proveedor":
            return [{"documento_proveedor": "901234567", "contratos": "14", "valor_total": "48000000000",
                     "primero": "2021-02-01T00:00:00.000", "ultimo": "2026-09-01T00:00:00.000"}]
        if group == "documento_proveedor, nombre_entidad":
            return [{"documento_proveedor": "901234567", "nombre_entidad": "MUNICIPIO A", "contratos": "5", "valor": "20000000000"}]
        if group == "nit_entidad":
            return [{"nit_entidad": "890900286", "contratos": "120", "valor": "90000000000",
                     "facturado": "40000000000", "pagado": "36000000000"}]
        if group == "nit_entidad, proveedor_adjudicado":
            assert "tipo_de_contrato in" in where
            return [{"nit_entidad": "890900286", "proveedor_adjudicado": "CONSORCIO ACERO", "contratos": "2", "valor": "3000000000"}]
        return []


def prospect():
    return {
        "id": "CO1.REQ.1",
        "id_portafolio": "CO1.BDOS.100",
        "nit_entidad": "890900286",
        "etapa_comercial": "Adjudicado (Contratista Seleccionado)",
        "contratista": {"nombre": "CONSORCIO ACERO", "nit": "901234567-1"},
    }


class TestContractSummary(unittest.TestCase):

    def test_summary_fields(self):
        c = summarize_contracts([RAW_CONTRACT])
        self.assertEqual(c["inicio_ejecucion"], "2026-09-10T00:00:00")
        self.assertEqual(c["fin_ejecucion"], "2027-03-10T00:00:00")
        self.assertEqual(c["avance_pagos_pct"], 25.0)
        self.assertTrue(c["anticipo"])
        self.assertEqual(c["valor_anticipo"], 200000000)
        self.assertEqual(c["origen_recursos"], ["Regalías (SGR)"])
        self.assertTrue(c["es_grupo"])
        self.assertEqual(c["contactos"]["representante_legal"], "Ana Pérez")
        self.assertEqual(c["contactos"]["ordenador_gasto"], "Luis Gómez")

    def test_sensitive_fields_never_copied(self):
        text = repr(summarize_contracts([RAW_CONTRACT]))
        for secret in ("12345678", "000123", "Banco X"):
            self.assertNotIn(secret, text)

    def test_multiple_lots_are_aggregated(self):
        lot2 = dict(RAW_CONTRACT, valor_del_contrato="500000000", valor_pagado="0",
                    fecha_de_fin_de_ejecucion="2027-06-30T00:00:00.000")
        c = summarize_contracts([RAW_CONTRACT, lot2])
        self.assertEqual(c["cantidad"], 2)
        self.assertEqual(c["valor"], 1500000000)
        self.assertEqual(c["fin_ejecucion"], "2027-06-30T00:00:00")

    def test_noise_is_cleaned(self):
        raw = dict(RAW_CONTRACT, condiciones_de_entrega="NXTWY.DLVY.6", origen_de_los_recursos="Distribuido",
                   recursos_propios="100")
        c = summarize_contracts([raw])
        self.assertIsNone(c["condiciones_entrega"])
        self.assertEqual(c["origen_recursos"], ["Recursos propios", "Regalías (SGR)"])

    def test_helpers(self):
        self.assertEqual(normalize_nit("901.234.567-1"), "901234567")
        self.assertIsNone(normalize_nit("No Definido"))
        self.assertEqual(notice_uid(RAW_CONTRACT["urlproceso"]), "CO1.NTC.555")
        self.assertIsNone(summarize_contracts([]))


class TestContractEnricher(unittest.TestCase):

    def test_enrich_adds_contract_history_and_entity(self):
        client = FakeClient()
        p = ContractEnricher(client, log=lambda _: None, today=datetime(2026, 9, 28)).enrich([prospect()])[0]
        self.assertEqual(p["contrato"]["id"], "CO1.PCCNTR.1")
        self.assertEqual(p["historial_contratista"]["contratos"], 14)
        self.assertEqual(p["historial_contratista"]["entidades_top"][0]["nombre"], "MUNICIPIO A")
        self.assertEqual(p["entidad_stats"]["pagado_sobre_facturado_pct"], 90.0)
        self.assertEqual(p["entidad_stats"]["proveedores_top"][0]["nombre"], "CONSORCIO ACERO")
        self.assertIn("proceso_de_compra in ('CO1.BDOS.100')", client.calls[0]["where"])
        self.assertTrue(any("fecha_de_firma >= '2025-09-28" in (c["where"] or "") for c in client.calls))

    def test_signed_contract_promotes_selected_process(self):
        p = prospect()
        p["etapa_comercial"] = "Proceso Activo (Seleccionado)"
        p["contratista"] = {"nombre": "No Definido", "nit": "N/A"}
        p["fechas"] = {"adjudicacion": None}
        out = ContractEnricher(FakeClient(), log=lambda _: None).enrich([p])[0]
        self.assertTrue(out["etapa_comercial"].startswith("Adjudicado"))
        self.assertEqual(out["contratista"]["nombre"], "CONSORCIO ACERO")
        self.assertTrue(out["contratista"]["es_consorcio"])
        self.assertEqual(out["fechas"]["adjudicacion"], "2026-09-01T00:00:00")

    def test_cancelled_contract_is_not_promoted(self):
        p = prospect()
        p["etapa_comercial"] = "Proceso Activo (Seleccionado)"
        p["contrato"] = summarize_contracts([dict(RAW_CONTRACT, estado_contrato="Cancelado")])
        self.assertFalse(ContractEnricher.promote_signed_contract(p))
        self.assertEqual(p["etapa_comercial"], "Proceso Activo (Seleccionado)")

    def test_network_failure_does_not_break_pipeline(self):
        logs = []
        p = ContractEnricher(FakeClient(fail=True), log=logs.append).enrich([prospect()])[0]
        self.assertIsNone(p["contrato"])
        self.assertIsNone(p["historial_contratista"])
        self.assertIsNone(p["entidad_stats"])
        self.assertTrue(any("falló" in line for line in logs))


if __name__ == "__main__":
    unittest.main()
