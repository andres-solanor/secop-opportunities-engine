"""
Coherencia del repositorio: cosas que deben mantenerse iguales a mano y que nadie nota
cuando se desincronizan.
"""

import os
import unittest

from src.tools.stamp_assets import GENERATED, INDEX, expected_versions, stamp

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


class TestAssetVersions(unittest.TestCase):
    """Si cambias un JS o CSS de web/, corre `python -m src.tools.stamp_assets`."""

    def test_index_html_versions_match_file_contents(self):
        with open(INDEX, encoding="utf-8") as f:
            html = f.read()
        self.assertEqual(
            stamp(html, expected_versions(html)), html,
            "web/index.html tiene versiones viejas: corre `python -m src.tools.stamp_assets`",
        )

    def test_generated_files_are_not_stamped_and_others_are(self):
        html = '<link href="style.css?v=old"><script src="data.js?v=keep"></script><script src="app.js"></script>'
        out = stamp(html, {"style.css": "aaa", "app.js": "bbb"})
        self.assertIn('href="style.css?v=aaa"', out)
        self.assertIn('src="app.js?v=bbb"', out)
        self.assertIn('src="data.js?v=keep"', out)
        self.assertTrue(GENERATED.isdisjoint(expected_versions(read(INDEX))))


if __name__ == "__main__":
    unittest.main()
