"""
Contrato de datos entre el pipeline (Python) y la web (JavaScript).

`web/app.js` y `web/profile-engine.js` leen estos campos sin comprobarlos. Si SECOP cambia una
columna o un cambio en el pipeline rompe la forma, es mejor que la corrida falle aquí y la web
conserve los datos de ayer, a publicar un tablero en blanco.

Solo biblioteca estándar: es una validación de forma, no un JSON Schema completo.
"""

from typing import Any, Dict, Iterable, List, Optional, Tuple

NUMBER = (int, float)
TEXT_OR_NONE = (str, type(None))

# (campo, tipos permitidos)
PROSPECT_FIELDS: Tuple[Tuple[str, tuple], ...] = (
    ("id", (str,)),
    ("referencia", TEXT_OR_NONE),
    ("entidad", TEXT_OR_NONE),
    ("departamento", TEXT_OR_NONE),
    ("ciudad", TEXT_OR_NONE),
    ("precio", NUMBER),
    ("precio_formateado", (str,)),
    ("descripcion", TEXT_OR_NONE),
    ("etapa_comercial", (str,)),
    ("tipo_oportunidad", (str,)),
    ("accion_sugerida", (str,)),
    ("sectores", (list,)),
    ("materiales_detectados", (list,)),
    ("contratista", (dict,)),
    ("fechas", (dict,)),
    ("competencia", (dict,)),
    ("score_calidad", (int,)),
    ("url_secop", (str,)),
)

HIDDEN_FIELDS: Tuple[Tuple[str, tuple], ...] = (
    ("id", (str,)),
    ("motivo", (str,)),
    ("precio", NUMBER),
    ("descripcion", (str,)),
    ("sectores", (list,)),
    ("etapa_comercial", (str,)),
)

HIDDEN_REASONS = ("sin_sector", "fuera_de_corte", "convenio")
MAX_ERRORS = 20


class SchemaError(ValueError):
    """El dataset no cumple el contrato: no se debe publicar."""


def _check_fields(item: Any, fields: Iterable[Tuple[str, tuple]], label: str) -> List[str]:
    if not isinstance(item, dict):
        return [f"{label}: no es un objeto"]
    errors = []
    for name, types in fields:
        if name not in item:
            errors.append(f"{label}: falta '{name}'")
        elif isinstance(item[name], bool) or not isinstance(item[name], types):
            errors.append(f"{label}: '{name}' tiene tipo {type(item[name]).__name__}")
    return errors


def validate_prospects(prospects: Any, sector_ids: Optional[Iterable[str]] = None) -> List[str]:
    """Errores del dataset curado (lista vacía = válido)."""
    if not isinstance(prospects, list):
        return ["el dataset no es una lista"]
    known = set(sector_ids) if sector_ids is not None else None
    errors: List[str] = []
    seen = set()
    for index, p in enumerate(prospects):
        label = f"oportunidad #{index}" + (f" ({p.get('id')})" if isinstance(p, dict) and p.get("id") else "")
        field_errors = _check_fields(p, PROSPECT_FIELDS, label)
        errors += field_errors
        if field_errors:
            continue
        if p["id"] in seen:
            errors.append(f"{label}: id repetido")
        seen.add(p["id"])
        if p["precio"] < 0:
            errors.append(f"{label}: precio negativo")
        if not 1 <= p["score_calidad"] <= 100:
            errors.append(f"{label}: score_calidad fuera de 1-100")
        if not p["sectores"]:
            errors.append(f"{label}: sin sectores (debería estar en el grupo sin clasificar)")
        for sector in p["sectores"]:
            if not isinstance(sector, dict) or not sector.get("id") or not sector.get("name"):
                errors.append(f"{label}: sector mal formado")
            elif known is not None and sector["id"] not in known:
                errors.append(f"{label}: sector desconocido '{sector['id']}'")
        if not isinstance(p["contratista"].get("nombre"), str):
            errors.append(f"{label}: contratista sin nombre")
    return errors


def validate_hidden(items: Any) -> List[str]:
    """Errores de la lista "fuera del tablero"."""
    if not isinstance(items, list):
        return ["la lista fuera del tablero no es una lista"]
    errors: List[str] = []
    for index, item in enumerate(items):
        label = f"fuera del tablero #{index}"
        field_errors = _check_fields(item, HIDDEN_FIELDS, label)
        errors += field_errors
        if not field_errors and item["motivo"] not in HIDDEN_REASONS:
            errors.append(f"{label}: motivo desconocido '{item['motivo']}'")
    return errors


def validate_meta(meta: Any) -> List[str]:
    if not isinstance(meta, dict):
        return ["meta no es un objeto"]
    errors = []
    for name, types in (("generated_at", (str,)), ("curadas", (int,)), ("fuentes", (dict,)), ("historial", (list,))):
        if name not in meta:
            errors.append(f"meta: falta '{name}'")
        elif not isinstance(meta[name], types):
            errors.append(f"meta: '{name}' tiene tipo {type(meta[name]).__name__}")
    profile = meta.get("perfil_proponente")
    if profile is not None:  # opcional: si la fuente falla y no hay corrida anterior, va en null
        rows = profile.get("modalidades") if isinstance(profile, dict) else None
        if not isinstance(rows, list):
            errors.append("meta: 'perfil_proponente' sin lista de modalidades")
        else:
            for row in rows:
                if not isinstance(row, dict) or not isinstance(row.get("modalidad"), str) or not all(
                    isinstance(row.get(k), int) and not isinstance(row.get(k), bool) and row[k] >= 0
                    for k in ("persona_natural", "juridica", "sin_dato")
                ):
                    errors.append(f"meta: fila de 'perfil_proponente' mal formada: {row!r}"[:200])
    return errors


def assert_valid(errors: List[str], what: str) -> None:
    if errors:
        shown = "\n  - ".join(errors[:MAX_ERRORS])
        more = f"\n  … y {len(errors) - MAX_ERRORS} más" if len(errors) > MAX_ERRORS else ""
        raise SchemaError(f"{what} no cumple el contrato de datos ({len(errors)} errores):\n  - {shown}{more}")


def validate_dataset(prospects: Any, meta: Optional[Dict[str, Any]] = None, hidden: Any = None,
                     sector_ids: Optional[Iterable[str]] = None) -> None:
    """Valida todo lo que se va a publicar; lanza SchemaError si algo no cumple."""
    assert_valid(validate_prospects(prospects, sector_ids), "El dataset curado")
    if meta is not None:
        assert_valid(validate_meta(meta), "El estado de sincronización")
    if hidden is not None:
        assert_valid(validate_hidden(hidden), "La lista fuera del tablero")
