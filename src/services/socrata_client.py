"""
Socrata Open Data API (SODA) Client for SECOP II
Connects to datos.gov.co to fetch public procurement records.
"""

import json
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional


class SocrataClient:
    """Client for querying Colombian Open Data (datos.gov.co) Socrata APIs."""

    BASE_URL = "https://www.datos.gov.co/resource"
    PROCESSES_DATASET = "p6dx-8zbt"   # SECOP II - Procesos de Contratación
    CONTRACTS_DATASET = "jbjy-vk9h"   # SECOP II - Contratos Electrónicos

    def __init__(self, app_token: Optional[str] = None, timeout: int = 30):
        self.app_token = app_token
        self.timeout = timeout
        self.headers = {
            "User-Agent": "SecopOpportunitiesEngine/1.0",
            "Accept": "application/json",
        }
        if self.app_token:
            self.headers["X-App-Token"] = self.app_token

    def query(
        self,
        dataset_id: str = PROCESSES_DATASET,
        where: Optional[str] = None,
        order: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        select: Optional[str] = None,
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

        query_string = urllib.parse.urlencode(params)
        url = f"{self.BASE_URL}/{dataset_id}.json?{query_string}"

        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"Socrata API returned status {response.status}")
                payload = response.read().decode("utf-8")
                return json.loads(payload)
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"HTTP Error {err.code} querying Socrata: {err_body}") from err
        except urllib.error.URLError as err:
            raise RuntimeError(f"Network error connecting to datos.gov.co: {err.reason}") from err

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
