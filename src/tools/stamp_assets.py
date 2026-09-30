"""
Sella las versiones de los archivos estáticos en web/index.html (cache busting).

Uso:  python -m src.tools.stamp_assets          # reescribe los sufijos ?v=
      python -m src.tools.stamp_assets --check  # solo verifica (sale con 1 si hay alguno viejo)

Cada `<script src="app.js?v=...">` y `<link href="style.css?v=...">` recibe como versión un
resumen del contenido del archivo: si el archivo cambia, cambia la URL y el navegador lo vuelve
a descargar. Reemplaza el sufijo `?v=AAAAMMDD_NN` que había que actualizar a mano.

Los archivos generados por el pipeline (data.js, taxonomy.js) no se sellan: cambian a diario y
sellarlos obligaría a modificar index.html en cada sincronización.
"""

import hashlib
import os
import re
import sys
from typing import Dict

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "web")
INDEX = os.path.join(WEB_DIR, "index.html")
GENERATED = {"data.js", "taxonomy.js", "hidden.js"}
ASSET = re.compile(r'(?P<attr>src|href)="(?P<file>[\w.-]+\.(?:js|css))(?:\?v=(?P<version>[\w.-]*))?"')


def content_version(path: str) -> str:
    """Resumen corto del contenido. Se normalizan los saltos de línea para que el sello sea
    el mismo en Windows y en Linux."""
    with open(path, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()[:10]


def expected_versions(html: str, web_dir: str = WEB_DIR) -> Dict[str, str]:
    files = {m.group("file") for m in ASSET.finditer(html)} - GENERATED
    return {name: content_version(os.path.join(web_dir, name)) for name in sorted(files)}


def stamp(html: str, versions: Dict[str, str]) -> str:
    def replace(match: re.Match) -> str:
        name = match.group("file")
        if name not in versions:
            return match.group(0)
        return f'{match.group("attr")}="{name}?v={versions[name]}"'

    return ASSET.sub(replace, html)


def main() -> int:
    with open(INDEX, encoding="utf-8") as f:
        html = f.read()
    stamped = stamp(html, expected_versions(html))
    if "--check" in sys.argv[1:]:
        if stamped != html:
            print("[!] web/index.html tiene versiones viejas. Corre: python -m src.tools.stamp_assets")
            return 1
        print("[*] Versiones de archivos estáticos al día.")
        return 0
    if stamped != html:
        with open(INDEX, "w", encoding="utf-8", newline="\n") as f:
            f.write(stamped)
        print("[+] web/index.html sellado con las versiones actuales.")
    else:
        print("[*] web/index.html ya estaba al día.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
