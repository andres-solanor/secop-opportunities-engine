"""
Dossier por NIT con Croma (manual, no corre a diario y no publica nada).

Consulta el registro mercantil y las sanciones de SECOP de una empresa y, para sus representantes
legales, Procuraduría, Contraloría y el Boletín de Deudores Morosos del Estado. Deja el resultado en
`local/dossiers/<nit>.json` (fuera del repositorio) y lo imprime con fuente, fecha y contra-explicación
de cada señal.

Sirve para el experimento del dueño (5 NIT reales) y es la base del servicio "dossier por NIT" de la
fase B. Nunca se publica en el sitio: los términos de Croma prohíben redistribuir sin autorización y
los antecedentes son de personas (Ley 1581 de 2012).

Costo: 2 peticiones por empresa + 3 por representante legal (hasta 8 con los valores por defecto).
La cuota de Croma es de 100 peticiones diarias por organización; lo ya consultado sale de la caché
local (`local/croma.db`) sin gastar cuota.

Uso:
    export CROMA_API_KEY=...                                  # nunca en el repositorio
    python -m src.tools.croma_dossier 900123456               # empresa + 2 representantes legales
    python -m src.tools.croma_dossier 900123456 --solo-empresa  # 2 peticiones
    python -m src.tools.croma_dossier 900123456 --sin-red     # solo lo que ya está en caché
    python -m src.tools.croma_dossier --cuota                 # gasto de hoy y registro (0 peticiones)
"""

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any, Dict, List, Optional

from src.dossier import build_dossier, legal_representatives, render_text
from src.services import croma_endpoints as ep
from src.services.croma_client import BudgetExhausted, CromaClient, CromaError

OUT_DIR = os.path.join("local", "dossiers")
REQUESTS_PER_COMPANY = 2
REQUESTS_PER_PERSON = 3


def run_dossier(client: CromaClient, nit: str, max_people: int = 2, company_only: bool = False,
                today: Optional[date] = None, workers: int = 6) -> Dict[str, Any]:
    """Consulta las fuentes y arma el dossier. Un fallo de una fuente queda como "sin revisar"."""
    today = today or date.today()
    failures: List[Dict[str, Any]] = []
    budget_hit = []

    def guarded(source, fn, *args):
        try:
            return fn(client, *args)
        except BudgetExhausted as err:
            budget_hit.append(str(err))
        except CromaError as err:
            failures.append({"fuente": source, "error": str(err)[:200]})
        return None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        rues_f = pool.submit(guarded, "RUES", ep.rues_entity_by_nit, nit)
        sanc_f = pool.submit(guarded, "SECOP sanciones", ep.secop_sanctions_by_provider, nit)
        rues, sanctions = rues_f.result(), sanc_f.result()

        people = None
        if not company_only:
            people = legal_representatives(rues, nit, max_people)
            futures = []
            for person in people:
                doc = person["document"]
                futures.append((
                    person,
                    pool.submit(guarded, "Procuraduría", ep.procuraduria, doc),
                    pool.submit(guarded, "Contraloría", ep.contraloria, doc),
                    pool.submit(guarded, "Contaduría", ep.contaduria, doc),
                ))
            for person, proc, fiscal, debt in futures:
                person["procuraduria"], person["contraloria"], person["contaduria"] = (
                    proc.result(), fiscal.result(), debt.result())

    if budget_hit:
        failures.append({"fuente": "Presupuesto diario", "error": budget_hit[0]})
    # El dossier solo guarda el documento enmascarado: el completo hacía falta para consultar.
    return build_dossier(nit, rues, sanctions, people, today, failures, list(client.skipped))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Dossier por NIT con Croma (solo lectura, resultado local).")
    parser.add_argument("nit", nargs="?", help="NIT de la empresa (con o sin dígito de verificación)")
    parser.add_argument("--max-personas", type=int, default=2, help="representantes legales a consultar (3 peticiones c/u)")
    parser.add_argument("--solo-empresa", action="store_true", help="solo RUES y sanciones (2 peticiones)")
    parser.add_argument("--sin-red", action="store_true", help="usar solo la caché local: 0 peticiones")
    parser.add_argument("--json", action="store_true", help="imprimir el JSON en lugar del resumen")
    parser.add_argument("--cuota", action="store_true", help="mostrar el gasto de hoy y el registro, sin consultar")
    parser.add_argument("--salida", default=OUT_DIR, help=f"carpeta del JSON (por defecto {OUT_DIR})")
    args = parser.parse_args(argv)

    client = CromaClient(offline=args.sin_red)
    if args.cuota:
        print(json.dumps({"hoy": client.budget_status(), "registro": client.ledger_summary()},
                         ensure_ascii=False, indent=2))
        return 0

    nit = ep.normalize_nit(args.nit)
    if not nit:
        parser.error("NIT inválido: se esperan entre 5 y 15 dígitos.")
    if not args.sin_red and not client.api_key:
        parser.error("Falta CROMA_API_KEY en el entorno (o use --sin-red para leer la caché).")

    people = 0 if args.solo_empresa else max(0, args.max_personas)
    worst = REQUESTS_PER_COMPANY + REQUESTS_PER_PERSON * people
    status = client.budget_status()
    plan = "Sin red: 0 peticiones, solo caché." if args.sin_red else f"Hasta {worst} peticiones (menos lo que ya esté en caché)."
    print(f"{plan} Hoy: {status['spent']}/{status['budget']}.", file=sys.stderr)

    dossier = run_dossier(client, nit, max_people=people, company_only=args.solo_empresa)
    os.makedirs(args.salida, exist_ok=True)
    path = os.path.join(args.salida, f"{nit}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(dossier, fh, ensure_ascii=False, indent=2)

    print(json.dumps(dossier, ensure_ascii=False, indent=2) if args.json else render_text(dossier))
    status = client.budget_status()
    print(f"\nGuardado en {path}. Hoy: {status['spent']}/{status['budget']} peticiones.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
