"""Cliente de Croma (src/services/croma_client.py) y adaptadores: nunca llaman a la API real."""

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone

from src.services import croma_endpoints as ep
from src.services.croma_client import BudgetExhausted, CromaClient, CromaError, cache_key

RUES = "/co/rues/entity-by-nit/v1"
FIXED_NOW = datetime(2026, 10, 3, 15, 0, tzinfo=timezone.utc)


class FakeTransport:
    """Responde en orden lo que se le encola; registra cada petición."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append((method, url, json.loads(body) if body else None))
        if not self.responses:
            raise AssertionError(f"Petición inesperada: {method} {url}")
        status, payload, headers_out = (self.responses.pop(0) + ({},))[:3]
        return status, headers_out, payload if isinstance(payload, str) else json.dumps(payload)


def ok(data, status=200):
    return (status, {"data": data})


class CromaClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "croma.db")
        self.sleeps = []

    def tearDown(self):
        self.tmp.cleanup()

    def client(self, transport, **kw):
        kw.setdefault("api_key", "llave-de-prueba")
        kw.setdefault("daily_budget", 10)
        return CromaClient(db_path=self.db, transport=transport, sleep=self.sleeps.append,
                           now=lambda: FIXED_NOW, **kw)

    def test_cache_key_ignores_key_order(self):
        self.assertEqual(cache_key(RUES, {"a": 1, "b": 2})[0], cache_key(RUES, {"b": 2, "a": 1})[0])

    def test_second_identical_call_costs_zero_requests(self):
        transport = FakeTransport(ok({"found": True}))
        c = self.client(transport)
        self.assertEqual(c.call(RUES, {"document_number": "900123456"}), {"found": True})
        self.assertEqual(c.call(RUES, {"document_number": "900123456"}), {"found": True})
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(c.spent_today(), 1)
        summary = c.ledger_summary()[0]
        self.assertEqual((summary["desde_red"], summary["desde_cache"]), (1, 1))

    def test_budget_is_read_from_disk_and_survives_a_restart(self):
        self.client(FakeTransport(ok({"found": True})), daily_budget=1).call(RUES, {"document_number": "1"})
        again = self.client(FakeTransport(), daily_budget=1)
        with self.assertRaises(BudgetExhausted):
            again.call(RUES, {"document_number": "2"})
        self.assertEqual(again.skipped, [{"endpoint": RUES, "motivo": "presupuesto_agotado"}])
        # Lo que ya está en caché sigue saliendo gratis aunque no quede presupuesto.
        self.assertEqual(again.call(RUES, {"document_number": "1"}), {"found": True})

    def test_429_waits_retry_after_and_each_attempt_counts(self):
        transport = FakeTransport((429, {"error": "rate"}, {"retry-after": "7"}), ok({"found": False}))
        c = self.client(transport)
        self.assertEqual(c.call(RUES, {"document_number": "1"}), {"found": False})
        self.assertEqual(self.sleeps, [7])
        self.assertEqual(c.spent_today(), 2)

    def test_4xx_is_not_retried_nor_cached(self):
        transport = FakeTransport((400, {"error": "documento inválido"}))
        c = self.client(transport)
        with self.assertRaises(CromaError) as ctx:
            c.call(RUES, {"document_number": "4831"})
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(len(transport.calls), 1)

    def test_circuit_opens_after_three_5xx_and_skips_the_endpoint(self):
        transport = FakeTransport((502, "caído"), (502, "caído"), (502, "caído"))
        c = self.client(transport)
        self.assertIsNone(c.call(RUES, {"document_number": "1"}))
        self.assertIsNone(c.call(RUES, {"document_number": "2"}))
        self.assertEqual(len(transport.calls), 3)
        self.assertIn(RUES, c.tripped)
        self.assertEqual([s["motivo"] for s in c.skipped], ["endpoint_caido", "endpoint_caido"])

    def test_async_job_is_polled_and_polls_do_not_count(self):
        job = {"job": {"id": "run_1", "status": "running", "status_url": "https://api.croma.run/jobs/run_1"}, "data": None}
        transport = FakeTransport(
            (202, job),
            (200, {"job": {"status": "running"}, "data": None}),
            (200, {"job": {"status": "succeeded"}, "data": {"reported": False}}),
        )
        c = self.client(transport)
        self.assertEqual(c.call("/co/contaduria/state-delinquent-debtors/v1", {"document_number": "12345"}),
                         {"reported": False})
        self.assertEqual([m for m, _, _ in transport.calls], ["POST", "GET", "GET"])
        self.assertEqual(c.spent_today(), 1)
        # Ya resuelto, queda en caché.
        self.assertEqual(c.call("/co/contaduria/state-delinquent-debtors/v1", {"document_number": "12345"}),
                         {"reported": False})

    def test_unresolved_job_is_not_cached_as_an_empty_answer(self):
        job = {"job": {"status": "running", "status_url": "https://api.croma.run/jobs/x"}, "data": None}
        running = (200, {"job": {"status": "running"}, "data": None})
        c = self.client(FakeTransport((202, job), running, running), job_polls=2)
        self.assertIsNone(c.call("/co/contraloria/fiscal-records/v1", {"document_number": "12345"}))
        self.assertEqual(c.skipped[-1]["motivo"], "trabajo_sin_resolver")
        retry = FakeTransport(ok({"is_fiscal_responsible": False}))
        c.transport = retry
        c.call("/co/contraloria/fiscal-records/v1", {"document_number": "12345"})
        self.assertEqual(len(retry.calls), 1)

    def test_non_json_answer_is_a_croma_error(self):
        c = self.client(FakeTransport((200, "<html>mantenimiento</html>")))
        with self.assertRaises(CromaError):
            c.call(RUES, {"document_number": "1"})

    def test_missing_rate_limit_headers_are_not_an_error(self):
        c = self.client(FakeTransport(ok({"found": True})))
        c.call(RUES, {"document_number": "1"})
        row = c.db.execute("SELECT x_ratelimit_remaining FROM ledger").fetchone()
        self.assertIsNone(row[0])

    def test_offline_and_missing_key(self):
        transport = FakeTransport()
        self.assertIsNone(self.client(transport, offline=True).call(RUES, {"document_number": "1"}))
        self.assertEqual(transport.calls, [])
        old = os.environ.pop("CROMA_API_KEY", None)
        try:
            with self.assertRaises(CromaError):
                CromaClient(db_path=self.db, transport=transport).call(RUES, {"document_number": "1"})
        finally:
            if old is not None:
                os.environ["CROMA_API_KEY"] = old


class StubClient:
    def __init__(self, data):
        self.data = data
        self.calls = []

    def call(self, path, body, allow_network=True):
        self.calls.append(path)
        return self.data


class EndpointsTest(unittest.TestCase):
    def test_normalize_nit(self):
        self.assertEqual(ep.normalize_nit("900.123.456-7"), "900123456")
        self.assertEqual(ep.normalize_nit(" 900123456 "), "900123456")
        self.assertIsNone(ep.normalize_nit("CO1.NTC.123"))

    def test_invalid_person_document_costs_no_request(self):
        stub = StubClient({"has_records": False})
        self.assertIsNone(ep.procuraduria(stub, "4831"))
        self.assertIsNone(ep.contaduria(stub, ""))
        self.assertEqual(stub.calls, [])

    def test_contaduria_reads_the_real_fields_not_the_documented_ones(self):
        # INC-03 de la hackatón: la respuesta real no trae `delinquent_to_state`.
        real = {"reported": True,
                "deudor_moroso": {"reported": True, "message": "El documento 1234567 SÍ está incluido en el BDME"},
                "incumplimiento_acuerdos": {"reported": False}}
        out = ep.contaduria(StubClient(real), "1234567")
        self.assertTrue(out["delinquent_to_state"])
        self.assertFalse(out["payment_agreement_default"])
        self.assertNotIn("1234567", out["delinquent_message"])
        documented = ep.contaduria(StubClient({"delinquent_to_state": True}), "1234567")
        self.assertTrue(documented["delinquent_to_state"])

    def test_rues_adapter_maps_entity_financials_and_parties(self):
        raw = {"found": True, "entity": {"nit": "900123456", "name": "ACME S.A.S.", "registration_status": "ACTIVA"},
               "financials": [{"year": "2024", "total_assets": 10, "total_liabilities": 4, "equity": 6, "period_result": 1}],
               "related_parties": [{"document_number": "12345678", "name": "Persona", "role": "Representante Legal - Principal"}]}
        out = ep.rues_entity_by_nit(StubClient(raw), "900123456")
        self.assertEqual(out["name"], "ACME S.A.S.")
        self.assertEqual(out["financials"][0]["equity"], 6)
        self.assertEqual(out["related_parties"][0]["role"], "Representante Legal - Principal")


if __name__ == "__main__":
    unittest.main()
