"""
Coherencia del repositorio: cosas que deben mantenerse iguales a mano y que nadie nota
cuando se desincronizan.
"""

import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOWS_DIR = os.path.join(ROOT, ".github", "workflows")
MIRROR_DIR = os.path.join(ROOT, "ci")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read().replace("\r\n", "\n")


class TestWorkflowMirror(unittest.TestCase):
    """`ci/` es la copia de plantilla de los workflows (para tokens sin alcance `workflow`)."""

    def test_every_workflow_has_an_identical_copy_in_ci(self):
        workflows = sorted(f for f in os.listdir(WORKFLOWS_DIR) if f.endswith(".yml"))
        self.assertTrue(workflows, "no se encontraron workflows")
        for name in workflows:
            mirror = os.path.join(MIRROR_DIR, name)
            self.assertTrue(os.path.exists(mirror), f"falta ci/{name}")
            self.assertEqual(
                read(os.path.join(WORKFLOWS_DIR, name)), read(mirror),
                f"ci/{name} difiere de .github/workflows/{name}",
            )

    def test_ci_has_no_orphan_copies(self):
        workflows = {f for f in os.listdir(WORKFLOWS_DIR) if f.endswith(".yml")}
        mirrors = {f for f in os.listdir(MIRROR_DIR) if f.endswith(".yml")}
        self.assertEqual(mirrors - workflows, set())


if __name__ == "__main__":
    unittest.main()
