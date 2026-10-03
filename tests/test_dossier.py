"""Dossier por NIT (src/dossier.py y src/tools/croma_dossier.py): señales, cobertura y privacidad."""

import json
import os
import tempfile
import unittest
from datetime import date, datetime, timezone

from src.dossier import (
    SIN_REVISAR,
    build_dossier,
    company_signals,
    legal_representatives,
    mask_document,
    person_signals,
    render_text,
    sanction_signal,
)
from src.services.croma_client import CromaClient
from src.tools.croma_dossier import run_dossier

TODAY = date(2026, 10, 3)
NIT = "900123456"
REP_DOC = "1012345678"


def rues(**over):
    base = {
        "found": True, "nit": NIT, "name": "ACME S.A.S.", "chamber_name": "BOGOTA",
        "registration_status": "ACTIVA", "registration_date": "2015-02-01",
        "primary_activity": {"code": "4290", "description": "Otras obras de ingeniería civil"},
        "commercial_email": "contacto@acme.example", "commercial_phones": ["6015550000"],
        "commercial_address": "Calle 1 # 2-3", "financials": [], "renewals": [], "related_parties": [],
        "checked_at": "2026-10-03T15:00:00+00:00",
    }
    base.update(over)
    return base


def by_id(signals, id_):
    return next(s for s in signals if s["id"] == id_)


class LegalRepresentativesTest(unittest.TestCase):
    def test_keeps_valid_representatives_principal_first_and_caps(self):
        parties = [
            {"document_number": "22222222", "name": "Suplente", "role": "Representante Legal - Suplente"},
            {"document_number": "4831", "name": "Truncado", "role": "Representante Legal - Principal"},
            {"document_number": NIT, "name": "ACME S.A.S.", "role": "Representante Legal - Principal"},
            {"document_number": "33333333", "name": "Socio", "role": "Socio"},
            {"document_number": "11111111", "name": "Principal", "role": "Representante Legal - Principal"},
            {"document_number": "11111111", "name": "Principal", "role": "Representante Legal - Principal"},
        ]
        reps = legal_representatives(rues(related_parties=parties), NIT, max_people=5)
        self.assertEqual([r["name"] for r in reps], ["Principal", "Suplente"])
        self.assertEqual(len(legal_representatives(rues(related_parties=parties), NIT, max_people=1)), 1)
        self.assertEqual(legal_representatives(None, NIT, 2), [])


class CompanySignalsTest(unittest.TestCase):
    def test_active_registration_variants_are_good(self):
        sig = by_id(company_signals(rues(registration_status="ACTIVA, CONSTITUCIÓN POR TRASLADO"), TODAY), "matricula")
        self.assertEqual(sig["tono"], "good")

    def test_cancelled_registration_is_risk_with_counter_explanation(self):
        sig = by_id(company_signals(rues(registration_status="CANCELADA"), TODAY), "matricula")
        self.assertEqual((sig["tono"], sig["estado"]), ("risk", "hallazgo"))
        self.assertTrue(sig["contra"])

    def test_not_in_rues_is_a_finding_and_missing_rues_is_unreviewed(self):
        self.assertEqual(company_signals(rues(found=False), TODAY)[0]["tono"], "warn")
        self.assertEqual(company_signals(None, TODAY)[0]["estado"], SIN_REVISAR)

    def test_renewal_is_expected_only_after_march_31(self):
        late = rues(renewals=[{"year": "2025"}])
        self.assertEqual(by_id(company_signals(late, TODAY), "renovacion")["tono"], "warn")
        self.assertEqual(by_id(company_signals(late, date(2026, 3, 15)), "renovacion")["tono"], "good")

    def test_new_company_is_flagged_for_review(self):
        sig = by_id(company_signals(rues(registration_date="2026-05-10"), TODAY), "antiguedad")
        self.assertEqual((sig["tono"], sig["titulo"]), ("warn", "Matriculada hace 5 meses"))

    def test_financials(self):
        none = by_id(company_signals(rues(), TODAY), "financieros")
        self.assertEqual(none["estado"], SIN_REVISAR)
        loss = rues(financials=[
            {"year": "2023", "total_assets": 100, "total_liabilities": 40, "equity": 60, "period_result": 5},
            {"year": "2024", "total_assets": 200, "total_liabilities": 150, "equity": 50, "period_result": -10},
        ])
        sig = by_id(company_signals(loss, TODAY), "financieros")
        self.assertEqual((sig["tono"], sig["titulo"]), ("warn", "Pérdida en 2024"))
        self.assertIn("endeudamiento 75%", sig["evidencia"])
        negative = rues(financials=[{"year": "2024", "total_assets": 10, "total_liabilities": 12, "equity": -2, "period_result": 1}])
        self.assertIn("Patrimonio negativo", by_id(company_signals(negative, TODAY), "financieros")["titulo"])

    def test_commercial_contact_is_reported(self):
        sig = by_id(company_signals(rues(), TODAY), "contacto")
        self.assertIn("contacto@acme.example", sig["evidencia"])


class SanctionAndPersonSignalsTest(unittest.TestCase):
    def test_sanctions(self):
        self.assertEqual(sanction_signal(None)["estado"], SIN_REVISAR)
        self.assertEqual(sanction_signal({"count": 0, "sanctions": []})["tono"], "good")
        sig = sanction_signal({"count": 1, "sanctions": [{"entity": "Alcaldía", "published_date": "2024-05-01", "sanction_value": 1000}]})
        self.assertEqual((sig["tono"], sig["titulo"]), ("warn", "1 sanción registrada en SECOP"))
        self.assertIn("Alcaldía, 2024-05-01, $1.000", sig["evidencia"])

    def test_person_findings_and_unreviewed_sources(self):
        person = {"document": REP_DOC, "name": "Ana Pérez", "role": "Representante Legal - Principal",
                  "procuraduria": None,
                  "contraloria": {"is_fiscal_responsible": True, "verification_code": "ABC"},
                  "contaduria": {"delinquent_to_state": False, "payment_agreement_default": False}}
        signals = {s["id"]: s for s in person_signals(person)}
        self.assertEqual(signals["procuraduria"]["estado"], SIN_REVISAR)
        self.assertEqual(signals["contraloria"]["tono"], "risk")
        self.assertEqual(signals["contaduria"]["tono"], "good")
        self.assertNotIn(REP_DOC, json.dumps(signals))
        self.assertEqual(mask_document(REP_DOC), "******5678")


class BuildDossierTest(unittest.TestCase):
    def test_company_only_marks_people_as_unreviewed(self):
        dossier = build_dossier(NIT, rues(), {"count": 0}, None, TODAY)
        self.assertEqual(by_id(dossier["senales"], "representantes")["estado"], SIN_REVISAR)
        self.assertEqual(dossier["resumen"]["sin_revisar"], 2)   # representantes + estados financieros
        text = render_text(dossier)
        self.assertIn("ACME S.A.S.", text)
        self.assertIn("no está limpio", text)

    def test_missing_rues_explains_why_people_were_not_reviewed(self):
        dossier = build_dossier(NIT, None, None, [], TODAY)
        self.assertIn("No se pudo consultar el RUES", by_id(dossier["senales"], "representantes")["evidencia"])


class FakeCroma:
    """Transporte simulado por ruta. Procuraduría responde 502: debe quedar sin revisar."""

    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        path = url.replace("https://api.croma.run", "")
        self.calls.append(path)
        if "procuraduria" in path:
            return 502, {}, "caído"
        data = {
            "/co/rues/entity-by-nit/v1": {"found": True, "entity": {"nit": NIT, "name": "ACME S.A.S.", "registration_status": "ACTIVA"},
                                          "related_parties": [{"document_number": REP_DOC, "name": "Ana Pérez",
                                                               "role": "Representante Legal - Principal"}]},
            "/co/secop/sanctions-by-provider/v1": {"count": 0, "sanctions": []},
            "/co/contraloria/fiscal-records/v1": {"found": True, "is_fiscal_responsible": False},
            "/co/contaduria/state-delinquent-debtors/v1": {"reported": False, "deudor_moroso": {"reported": False},
                                                           "incumplimiento_acuerdos": {"reported": False}},
        }[path]
        return 200, {}, json.dumps({"data": data})


class RunDossierTest(unittest.TestCase):
    def test_end_to_end_with_a_failing_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport = FakeCroma()
            client = CromaClient(api_key="k", db_path=os.path.join(tmp, "c.db"), transport=transport,
                                 sleep=lambda s: None, now=lambda: datetime(2026, 10, 3, tzinfo=timezone.utc))
            dossier = run_dossier(client, NIT, max_people=2, today=TODAY, workers=1)

        signals = {s["id"]: s for s in dossier["senales"]}
        self.assertEqual(signals["procuraduria"]["estado"], SIN_REVISAR)
        self.assertEqual(signals["contraloria"]["tono"], "good")
        self.assertEqual(signals["sanciones"]["tono"], "good")
        self.assertEqual(dossier["cobertura"]["omitidas"], [{"endpoint": "/co/procuraduria/disciplinary-records/v1",
                                                             "motivo": "endpoint_caido"}])
        self.assertNotIn(REP_DOC, json.dumps(dossier))
        self.assertEqual(transport.calls.count("/co/procuraduria/disciplinary-records/v1"), 3)


if __name__ == "__main__":
    unittest.main()
