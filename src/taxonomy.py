"""
Taxonomía de sectores: se carga desde `config/taxonomy.json`, la fuente única del vocabulario.

Agregar un sector es editar ese archivo (y una prueba), no el código.
"""

import json
import os
import re
from typing import Any, Dict

TAXONOMY_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "taxonomy.json")

# Sector reservado para lo que pasa el filtro de ruido pero no coincide con ningún sector.
# No puede usarse como clave en config/taxonomy.json.
SIN_CLASIFICAR = "sin_clasificar"
SIN_CLASIFICAR_NAME = "Sin clasificar"

REQUIRED_KEYS = ("name", "keywords", "unspsc_prefixes", "weight")


class TaxonomyError(ValueError):
    """La taxonomía está mal formada: el pipeline no debe correr con ella."""


def load_taxonomy(path: str = TAXONOMY_PATH) -> Dict[str, Dict[str, Any]]:
    """Devuelve `{clave_sector: definición}` y valida la forma mínima de cada sector."""
    with open(path, encoding="utf-8") as f:
        sectors = json.load(f).get("sectores")
    if not isinstance(sectors, dict) or not sectors:
        raise TaxonomyError(f"{path}: falta el bloque 'sectores'")

    for key, data in sectors.items():
        if key == SIN_CLASIFICAR:
            raise TaxonomyError(f"'{SIN_CLASIFICAR}' es un sector reservado")
        missing = [k for k in REQUIRED_KEYS if k not in data]
        if missing:
            raise TaxonomyError(f"sector '{key}': faltan {', '.join(missing)}")
        if not data["keywords"] and not data["unspsc_prefixes"]:
            raise TaxonomyError(f"sector '{key}': necesita palabras clave o prefijos UNSPSC")
        data.setdefault("excluir_si", {})
        data.setdefault("harvest", None)
        data.setdefault("unspsc_clasifica", False)
        unknown = [kw for kw in data["excluir_si"] if kw not in data["keywords"]]
        if unknown:
            raise TaxonomyError(f"sector '{key}': excluir_si usa palabras que no son keywords: {unknown}")
    return sectors


def normalize_unspsc(raw: Any) -> str:
    """SECOP II entrega el código como 'V1.72141000'; aquí queda '72141000' (solo dígitos)."""
    text = str(raw or "").strip()
    text = re.sub(r"^[A-Za-z]\d*\.", "", text)
    return text if text.isdigit() else ""
