"""
Unit tests for SECOP II Opportunities Engine.
"""

import unittest
from src.filters.noise_filter import NoiseFilter
from src.enrichers.scope_extractor import ScopeExtractor


class TestSecopEngine(unittest.TestCase):

    def setUp(self):
        self.noise_filter = NoiseFilter(min_budget=50_000_000)
        self.scope_extractor = ScopeExtractor()

    def test_noise_filter_rejects_ops_service_contracts(self):
        record = {
            "precio_base": "30000000",
            "tipo_de_contrato": "Prestación de servicios",
            "modalidad_de_contratacion": "Contratación directa",
            "codigo_principal_de_categoria": "80101504",
            "descripci_n_del_procedimiento": "Prestación de servicios profesionales de apoyo a la gestión..."
        }
        passes, reason = self.noise_filter.evaluate(record)
        self.assertFalse(passes)
        self.assertIn("Price below threshold", reason)

    def test_noise_filter_rejects_ops_even_high_value(self):
        record = {
            "precio_base": "85000000",
            "tipo_de_contrato": "Prestación de servicios",
            "modalidad_de_contratacion": "Contratación directa",
            "codigo_principal_de_categoria": "80101504",
            "descripci_n_del_procedimiento": "Prestación de servicios profesionales de asesoría jurídica"
        }
        passes, reason = self.noise_filter.evaluate(record)
        self.assertFalse(passes)
        self.assertIn("OPS", reason)

    def test_noise_filter_accepts_licitacion_publica(self):
        record = {
            "precio_base": "1500000000",
            "tipo_de_contrato": "Obra",
            "modalidad_de_contratacion": "Licitación pública",
            "codigo_principal_de_categoria": "72141000",
            "descripci_n_del_procedimiento": "Construcción de puente vehicular con estructura metálica y vigas de acero"
        }
        passes, reason = self.noise_filter.evaluate(record)
        self.assertTrue(passes)
        self.assertIsNone(reason)

    def test_scope_extractor_identifies_steel_vertical(self):
        record = {
            "id_del_proceso": "CO1.REQ.12345",
            "referencia_del_proceso": "LP-001-2024",
            "entidad": "Alcaldía Municipal de Medellín",
            "precio_base": "2500000000",
            "modalidad_de_contratacion": "Licitación pública",
            "tipo_de_contrato": "Obra",
            "nombre_del_procedimiento": "Adecuación coliseo deportivo",
            "descripci_n_del_procedimiento": "Suministro e instalación de cubierta metálica, vigas de acero y estructura metálica para el coliseo.",
            "estado_del_procedimiento": "Presentación de ofertas",
            "adjudicado": "No",
        }
        enriched = self.scope_extractor.enrich(record)
        sector_ids = [s["id"] for s in enriched["sectores"]]
        self.assertIn("acero_metalmecanica", sector_ids)
        self.assertIn("vigas", enriched["materiales_detectados"])
        self.assertIn("cubierta metálica", enriched["materiales_detectados"])
        self.assertGreaterEqual(enriched["score_calidad"], 50)
        self.assertEqual(enriched["tipo_oportunidad"], "Oportunidad de Alianza / Cotización")

    def test_scope_extractor_identifies_horeca_vertical(self):
        record = {
            "id_del_proceso": "CO1.REQ.67890",
            "referencia_del_proceso": "SAMC-042-2024",
            "entidad": "Gobernación del Valle",
            "precio_base": "650000000",
            "modalidad_de_contratacion": "Selección abreviada menor cuantía",
            "tipo_de_contrato": "Suministro",
            "nombre_del_procedimiento": "Dotación PAE",
            "descripci_n_del_procedimiento": "Dotación y suministro de cocina industrial, hornos combinados y cuarto frío para comedores escolares del programa de alimentación escolar.",
            "estado_del_procedimiento": "Adjudicado",
            "adjudicado": "Si",
            "nombre_del_proveedor": "CONSORCIO GASTRONOMICO VALLE 2024",
            "nit_del_proveedor_adjudicado": "901234567-8",
        }
        enriched = self.scope_extractor.enrich(record)
        sector_ids = [s["id"] for s in enriched["sectores"]]
        self.assertIn("horeca_industrial", sector_ids)
        self.assertIn("cocina industrial", enriched["materiales_detectados"])
        self.assertIn("cuarto frío", enriched["materiales_detectados"])
        self.assertTrue(enriched["contratista"]["es_consorcio"])
        self.assertEqual(enriched["contratista"]["nombre"], "CONSORCIO GASTRONOMICO VALLE 2024")
        self.assertEqual(enriched["tipo_oportunidad"], "Lead B2B de Venta Directa")


if __name__ == "__main__":
    unittest.main()
