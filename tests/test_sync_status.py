"""
Pruebas del estado de sincronización (nuevas, salidas, adjudicadas, historial).
"""

import unittest
from datetime import datetime, timezone

from src.sync_status import build_meta, next_scheduled_run, stamp_first_seen

NOW = datetime(2026, 9, 28, 11, 5, tzinfo=timezone.utc)


def opp(pid, etapa="Licitación Abierta (En Ofertas)"):
    return {"id": pid, "etapa_comercial": etapa}


class TestSyncStatus(unittest.TestCase):

    def test_first_run_seeds_registry_from_previous(self):
        previous = [opp("A"), opp("B")]
        current = [opp("A"), opp("C")]
        seen = stamp_first_seen(current, {}, previous, NOW)
        self.assertFalse(current[0]["nueva"])
        self.assertIsNone(current[0]["primera_vez"])
        self.assertTrue(current[1]["nueva"])
        self.assertEqual(seen["C"], "2026-09-28T11:05:00Z")

    def test_reentering_process_is_not_new(self):
        seen = {"A": "2026-09-01T11:00:00Z"}
        current = [opp("A")]
        stamp_first_seen(current, seen, [], NOW)
        self.assertFalse(current[0]["nueva"])
        self.assertEqual(current[0]["primera_vez"], "2026-09-01T11:00:00Z")

    def test_after_a_reclassification_only_recent_processes_are_new(self):
        since = "2026-09-27T11:05:00Z"
        old = dict(opp("OLD"), fecha_publicacion="2026-09-10T00:00:00")
        fresh = dict(opp("FRESH"), fecha_publicacion="2026-09-28T08:00:00")
        undated = opp("UNDATED")
        awarded_now = dict(opp("AW", "Adjudicado (Contratista Seleccionado)"), fecha_publicacion="2026-08-01T00:00:00",
                           fechas={"adjudicacion": "2026-09-28T09:00:00"})
        current = [old, fresh, undated, awarded_now]
        seen = stamp_first_seen(current, {"X": None}, [], NOW, reclassified_since=since)
        self.assertEqual({p["id"]: p["nueva"] for p in current}, {"OLD": False, "FRESH": True, "UNDATED": False, "AW": True})
        # Todos quedan registrados: mañana ninguno vuelve a contar como nuevo.
        self.assertTrue(all(seen[p["id"]] == "2026-09-28T11:05:00Z" for p in current))

    def test_without_reclassification_first_seen_is_new(self):
        current = [dict(opp("OLD"), fecha_publicacion="2026-01-01T00:00:00")]
        stamp_first_seen(current, {"X": None}, [], NOW)
        self.assertTrue(current[0]["nueva"])

    def test_meta_records_taxonomy_version_and_reclassification(self):
        meta = build_meta([], [], 10, NOW, NOW, {}, [], taxonomy_version=2, reclassified=True)
        self.assertEqual((meta["taxonomia_version"], meta["reclasificacion"]), (2, True))
        self.assertEqual(meta["historial"][0]["taxonomia_version"], 2)
        self.assertNotIn("reclasificacion", build_meta([], [], 10, NOW, NOW, {}, [], taxonomy_version=2))

    def test_old_entries_are_pruned(self):
        seen = {"OLD": "2025-01-01T00:00:00Z", "UNKNOWN": None}
        out = stamp_first_seen([opp("X")], seen, [], NOW)
        self.assertNotIn("OLD", out)
        self.assertIn("UNKNOWN", out)

    def test_meta_counts(self):
        previous = [opp("A"), opp("B"), opp("D")]
        current = [opp("A", "Adjudicado (Contrato firmado)"), opp("C"), opp("D")]
        stamp_first_seen(current, {"A": None, "B": None, "D": None}, previous, NOW)
        cross = {"contratos": 10, "historial": 9, "entidades": 50, "reutilizados": 0, "errores": []}
        meta = build_meta(current, previous, 681, NOW.replace(minute=0), NOW, cross,
                          [{"generated_at": "2026-09-27T11:05:00Z", "nuevas": 4}])
        self.assertEqual(meta["nuevas"], 1)
        self.assertEqual(meta["ids_nuevas"], ["C"])
        self.assertEqual(meta["salieron"], 1)
        self.assertEqual(meta["nuevas_adjudicadas"], 1)
        self.assertEqual(meta["procesos_consultados"], 681)
        self.assertEqual(meta["duracion_s"], 300.0)
        self.assertEqual(meta["cruce_contratos"], "ok")
        self.assertEqual(len(meta["historial"]), 2)
        self.assertEqual(meta["historial"][0]["generated_at"], "2026-09-28T11:05:00Z")

    def test_cross_state(self):
        base = dict(prospects=[], previous=[], raw_count=0, started_at=NOW, finished_at=NOW, history=[])
        self.assertEqual(build_meta(cross={"errores": ["entidades: timeout"], "reutilizados": 3}, **base)["cruce_contratos"], "parcial")
        self.assertEqual(build_meta(cross={"errores": ["x"], "reutilizados": 0}, **base)["cruce_contratos"], "con_errores")
        self.assertEqual(build_meta(cross=None, **base)["cruce_contratos"], "sin_datos")

    def test_next_run(self):
        self.assertEqual(next_scheduled_run(NOW), "2026-09-29T11:00:00Z")
        self.assertEqual(next_scheduled_run(NOW.replace(hour=3)), "2026-09-28T11:00:00Z")


if __name__ == "__main__":
    unittest.main()
