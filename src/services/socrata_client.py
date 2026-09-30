"""
Socrata Open Data API (SODA) Client for SECOP II
Connects to datos.gov.co to fetch public procurement records.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional


class SocrataError(RuntimeError):
    """Error al consultar datos.gov.co. `retryable` indica si tiene sentido reintentar."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class SocrataClient:
    """Client for querying Colombian Open Data (datos.gov.co) Socrata APIs."""

    BASE_URL = "https://www.datos.gov.co/resource"
    PROCESSES_DATASET = "p6dx-8zbt"   # SECOP II - Procesos de Contratación
    CONTRACTS_DATASET = "jbjy-vk9h"   # SECOP II - Contratos Electrónicos

    def __init__(
        self,
        app_token: Optional[str] = None,
        timeout: int = 30,
        retries: int = 0,
        backoff: float = 2.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        # El token es opcional: sin él datos.gov.co aplica un límite de peticiones más bajo.
        self.app_token = app_token or os.environ.get("SOCRATA_APP_TOKEN") or None
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self.sleep = sleep
        self.headers = {
            "User-Agent": "SecopOpportunitiesEngine/1.0",
            "Accept": "application/json",
        }
        if self.app_token:
            self.headers["X-App-Token"] = self.app_token

    def _fetch(self, url: str) -> List[Dict[str, Any]]:
        """Una petición HTTP. Separada de `query` para poder sustituirla en las pruebas."""
        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                if response.status != 200:
                    raise SocrataError(f"Socrata API returned status {response.status}")
                payload = response.read().decode("utf-8")
                return json.loads(payload)
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="ignore")
            # Un 4xx (salvo 429) es una consulta mal formada: reintentar no la arregla.
            retryable = err.code == 429 or err.code >= 500
            raise SocrataError(f"HTTP Error {err.code} querying Socrata: {err_body}", retryable) from err
        except urllib.error.URLError as err:
            raise SocrataError(f"Network error connecting to datos.gov.co: {err.reason}") from err
        except TimeoutError as err:
            raise SocrataError("Timeout connecting to datos.gov.co") from err

    def query(
        self,
        dataset_id: str = PROCESSES_DATASET,
        where: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        select: Optional[str] = None,
        group: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Executes a SoQL query against a Socrata dataset.
        """
        params = {
            "$limit": str(limit),
            "$offset": str(offset),
        }
        if where:
            params["$where"] = where
        if order:
            params["$order"] = order
        if select:
            params["$select"] = select
        if group:
            params["$group"] = group

        query_string = urllib.parse.urlencode(params)
        url = f"{self.BASE_URL}/{dataset_id}.json?{query_string}"

        for attempt in range(self.retries + 1):
            try:
                return self._fetch(url)
            except SocrataError as err:
                if not err.retryable or attempt == self.retries:
                    raise
                self.sleep(self.backoff * (2 ** attempt))
        raise AssertionError("unreachable")  # pragma: no cover

    def query_all(
        self,
        dataset_id: str = PROCESSES_DATASET,
        where: Optional[str] = None,
        order: Optional[str] = None,
        select: Optional[str] = None,
        page_size: int = 1000,
        max_rows: int = 5000,
    ) -> List[Dict[str, Any]]:
        """Pagina una consulta hasta agotar los resultados o llegar a `max_rows`.

        Requiere `order` estable: sin orden, Socrata puede repetir u omitir filas entre páginas.
        """
        if not order:
            raise ValueError("query_all necesita un `order` para paginar de forma estable")
        rows: List[Dict[str, Any]] = []
        while len(rows) < max_rows:
            page = self.query(
                dataset_id=dataset_id, where=where, order=order, select=select,
                limit=min(page_size, max_rows - len(rows)), offset=len(rows),
            )
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows

    def fetch_recent_processes(
        self,
        where_clause: Optional[str] = None,
        limit: int = 200,
        order: str = "fecha_de_publicacion_del DESC",
    ) -> List[Dict[str, Any]]:
        """Convenience method to query SECOP II Procesos."""
        return self.query(
            dataset_id=self.PROCESSES_DATASET,
            where=where_clause,
            order=order,
            limit=limit,
        )

    def fetch_recent_contracts(
        self,
        where_clause: Optional[str] = None,
        limit: int = 200,
        order: str = "fecha_de_firma DESC",
    ) -> List[Dict[str, Any]]:
        """Convenience method to query SECOP II Contratos Electrónicos."""
        return self.query(
            dataset_id=self.CONTRACTS_DATASET,
            where=where_clause,
            order=order,
            limit=limit,
        )
