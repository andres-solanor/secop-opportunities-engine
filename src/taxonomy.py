"""
Taxonomía de sectores: se carga desde `config/taxonomy.json`, la fuente única del vocabulario.

Agregar un sector es editar ese archivo (y una prueba), no el código.
"""

import json
import os
import re
import unicodedata
from typing import Any, Dict, List

TAXONOMY_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "taxonomy.json")

# Sector reservado para lo que pasa el filtro de ruido pero no coincide con ningún sector.
# No puede usarse como clave en config/taxonomy.json.
SIN_CLASIFICAR = "sin_clasificar"
SIN_CLASIFICAR_NAME = "Sin clasificar"

REQUIRED_KEYS = ("name", "grupo", "keywords", "unspsc_prefixes", "weight")


class TaxonomyError(ValueError):
    """La taxonomía está mal formada: el pipeline no debe correr con ella."""


def fold(text: Any) -> str:
    """Minúsculas y sin tildes: 'Interventoría' y 'interventoria' comparan igual."""
    decomposed = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower().strip()


def _read(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _validate_groups(groups: Any, path: str) -> List[Dict[str, Any]]:
    if not isinstance(groups, list) or not groups:
        raise TaxonomyError(f"{path}: falta el bloque 'grupos'")
    for group in groups:
        if not isinstance(group, dict) or not group.get("id") or not group.get("name"):
            raise TaxonomyError(f"{path}: grupo mal formado: {group}")
    return sorted(groups, key=lambda g: g.get("orden", 0))


def taxonomy_version(path: str = TAXONOMY_PATH) -> int:
    """Versión del vocabulario. Cambiarla avisa al pipeline que hubo una reclasificación."""
    return int(_read(path).get("version", 1))


def load_groups(path: str = TAXONOMY_PATH) -> List[Dict[str, Any]]:
    """Familias de sectores (`{id, name, orden}`), en el orden en que se muestran."""
    return _validate_groups(_read(path).get("grupos"), path)


def load_taxonomy(path: str = TAXONOMY_PATH) -> Dict[str, Dict[str, Any]]:
    """Devuelve `{clave_sector: definición}` y valida la forma mínima de cada sector."""
    content = _read(path)
    sectors = content.get("sectores")
    if not isinstance(sectors, dict) or not sectors:
        raise TaxonomyError(f"{path}: falta el bloque 'sectores'")
    group_ids = {g["id"] for g in _validate_groups(content.get("grupos"), path)}

    for key, data in sectors.items():
        if key == SIN_CLASIFICAR:
            raise TaxonomyError(f"'{SIN_CLASIFICAR}' es un sector reservado")
        missing = [k for k in REQUIRED_KEYS if k not in data]
        if missing:
            raise TaxonomyError(f"sector '{key}': faltan {', '.join(missing)}")
        if data["grupo"] not in group_ids:
            raise TaxonomyError(f"sector '{key}': el grupo '{data['grupo']}' no está en 'grupos'")
        data.setdefault("excluir_si", {})
        data.setdefault("harvest", None)
        data.setdefault("unspsc_clasifica", False)
        for field in ("tipos_contrato", "excluir_tipos_contrato"):
            data.setdefault(field, [])
            values = data[field]
            if not isinstance(values, list) or not all(isinstance(t, str) and t.strip() for t in values):
                raise TaxonomyError(f"sector '{key}': {field} debe ser una lista de textos")
        types = data["tipos_contrato"]
        overlap = {fold(t) for t in types} & {fold(t) for t in data["excluir_tipos_contrato"]}
        if overlap:
            raise TaxonomyError(f"sector '{key}': un tipo de contrato no puede clasificar y excluir: {sorted(overlap)}")
        if not data["keywords"] and not data["unspsc_prefixes"] and not types:
            raise TaxonomyError(f"sector '{key}': necesita palabras clave, prefijos UNSPSC o tipos de contrato")
        unknown = [kw for kw in data["excluir_si"] if kw not in data["keywords"]]
        if unknown:
            raise TaxonomyError(f"sector '{key}': excluir_si usa palabras que no son keywords: {unknown}")
    return sectors


def normalize_unspsc(raw: Any) -> str:
    """SECOP II entrega el código como 'V1.72141000'; aquí queda '72141000' (solo dígitos)."""
    text = str(raw or "").strip()
    text = re.sub(r"^[A-Za-z]\d*\.", "", text)
    return text if text.isdigit() else ""
