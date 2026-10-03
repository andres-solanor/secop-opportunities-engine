"""
Cliente de la API de Croma (datos de fuentes oficiales sin descarga masiva).

Porta a Python el cliente de la hackatón (repositorio `andres-solanor/croma-hackaton`, `src/croma.js`),
con lo que se aprendió contra la API real:

- La cuota es por ORGANIZACIÓN y por día (100/día en condiciones normales), no por llave.
- Los aciertos de la caché de Croma también consumen cuota, y una petición mal formada (400) también.
  Por eso la caché es nuestra (SQLite local) y los documentos se validan antes de llamar.
- Algunas fuentes responden 202 con un trabajo asíncrono: hay que sondearlo. Un dato pendiente
  no es un dato ausente, así que no se guarda en caché.
- Las fuentes oficiales se caen: tras varios 5xx seguidos, el endpoint se omite (cortacircuitos).
- El limitador falla abierto: los encabezados `X-RateLimit-*` pueden no venir.

Solo biblioteca estándar. La llave (`CROMA_API_KEY`) nunca va al navegador ni al repositorio.
"""

import hashlib
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

BASE_URL = "https://api.croma.run"
DEFAULT_DB_PATH = os.path.join("local", "croma.db")
DEFAULT_DAILY_BUDGET = 60   # de 100 diarios por organización: deja margen para pruebas manuales
JOB_POLL_SUFFIX = " [job-poll]"

# transport(method, url, headers, body, timeout) -> (status, encabezados en minúscula, texto)
Transport = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, Dict[str, str], str]]


class CromaError(RuntimeError):
    """Error al consultar Croma. `status` es el código HTTP, si lo hubo."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class BudgetExhausted(CromaError):
    """Se alcanzó el presupuesto diario. Corta la corrida: seguir pidiendo no tiene sentido."""


def _urllib_transport(method, url, headers, body, timeout):
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read().decode("utf-8", errors="ignore")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def cache_key(path: str, body: Dict[str, Any]) -> Tuple[str, str]:
    """Clave estable: el orden de las claves del cuerpo no produce fallos de caché."""
    canonical = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(f"{path}|{canonical}".encode("utf-8")).hexdigest(), canonical


def _int_header(headers: Dict[str, str], name: str) -> Optional[int]:
    raw = headers.get(name)
    try:
        return int(raw) if raw not in (None, "") else None
    except ValueError:
        return None


class CromaClient:
    """Todas las llamadas a Croma pasan por aquí: caché, registro, presupuesto y cortacircuitos."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        db_path: str = DEFAULT_DB_PATH,
        daily_budget: Optional[int] = None,
        base_url: Optional[str] = None,
        transport: Optional[Transport] = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = _now,
        timeout: float = 90.0,
        max_retries: int = 3,
        circuit_threshold: int = 3,
        job_polls: int = 14,
        job_interval: float = 3.0,
        offline: bool = False,
    ):
        self.api_key = api_key or os.environ.get("CROMA_API_KEY") or None
        self.base_url = (base_url or os.environ.get("CROMA_BASE_URL") or BASE_URL).rstrip("/")
        budget = daily_budget if daily_budget is not None else os.environ.get("CROMA_DAILY_BUDGET")
        self.daily_budget = int(budget) if budget not in (None, "") else DEFAULT_DAILY_BUDGET
        self.transport = transport or _urllib_transport
        self.sleep = sleep
        self.now = now
        self.timeout = timeout
        self.max_retries = max_retries
        self.circuit_threshold = circuit_threshold
        self.job_polls = job_polls
        self.job_interval = job_interval
        self.offline = offline   # solo caché: ninguna petición sale a la red

        # Lo que se quiso pedir y no se pidió, con el motivo. Es evidencia de cobertura, no ruido.
        self.skipped: List[Dict[str, Any]] = []
        self._failures: Dict[str, int] = {}
        self.tripped: set = set()
        self._inflight = 0
        self._lock = threading.RLock()

        if db_path != ":memory:":
            os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS cache (
              key TEXT PRIMARY KEY, endpoint TEXT NOT NULL, params TEXT NOT NULL,
              body TEXT NOT NULL, status INTEGER NOT NULL, fetched_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ledger (
              id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, endpoint TEXT NOT NULL,
              params_hash TEXT NOT NULL, status INTEGER, x_ratelimit_limit INTEGER,
              x_ratelimit_remaining INTEGER, x_ratelimit_reset TEXT, x_cache TEXT, x_request_id TEXT,
              latency_ms INTEGER, cache_hit_local INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
              error TEXT
            );
            CREATE INDEX IF NOT EXISTS ledger_ts ON ledger (timestamp);
            """
        )

    # ---- registro y presupuesto ---------------------------------------------------------------

    def _log(self, endpoint, key, status, headers=None, latency_ms=0, local_hit=False, attempt=1, error=None):
        headers = headers or {}
        with self._lock:
            self.db.execute(
                "INSERT INTO ledger (timestamp, endpoint, params_hash, status, x_ratelimit_limit,"
                " x_ratelimit_remaining, x_ratelimit_reset, x_cache, x_request_id, latency_ms,"
                " cache_hit_local, attempt, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    self.now().isoformat(), endpoint, key, status,
                    _int_header(headers, "x-ratelimit-limit"), _int_header(headers, "x-ratelimit-remaining"),
                    headers.get("x-ratelimit-reset"), headers.get("x-cache"), headers.get("x-request-id"),
                    latency_ms, 1 if local_hit else 0, attempt, error,
                ),
            )
            self.db.commit()

    def spent_today(self) -> int:
        """Peticiones reales de hoy (UTC), leídas del registro en disco: sobrevive a reinicios.

        Los sondeos de trabajos asíncronos se registran para ver su costo en tiempo, pero no son
        consultas de datos y no cuentan contra la cuota.
        """
        day = self.now().date().isoformat()
        with self._lock:
            row = self.db.execute(
                "SELECT COUNT(*) FROM ledger WHERE cache_hit_local = 0 AND endpoint NOT LIKE ?"
                " AND substr(timestamp, 1, 10) = ?",
                (f"%{JOB_POLL_SUFFIX}", day),
            ).fetchone()
        return row[0] if row else 0

    def budget_status(self) -> Dict[str, int]:
        spent = self.spent_today()
        return {"spent": spent, "budget": self.daily_budget, "remaining": max(0, self.daily_budget - spent)}

    def ledger_summary(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self.db.execute(
                "SELECT endpoint, COUNT(*), SUM(cache_hit_local), SUM(1 - cache_hit_local),"
                " CAST(AVG(CASE WHEN cache_hit_local = 0 THEN latency_ms END) AS INTEGER)"
                " FROM ledger GROUP BY endpoint ORDER BY 4 DESC"
            ).fetchall()
        return [
            {"endpoint": e, "total": t, "desde_cache": c, "desde_red": r, "latencia_media_ms": lat}
            for e, t, c, r, lat in rows
        ]

    def _skip(self, path, body, reason):
        with self._lock:
            self.skipped.append({"endpoint": path, "motivo": reason})
        return None

    # ---- llamada ------------------------------------------------------------------------------

    def call(self, path: str, body: Dict[str, Any], allow_network: bool = True) -> Optional[Dict[str, Any]]:
        """Llama un endpoint (todos son POST con cuerpo JSON) y devuelve `data` ya desenvuelto.

        Devuelve None si la consulta se omitió (sin red, endpoint caído o trabajo sin resolver);
        el motivo queda en `self.skipped`. `found: false` dentro de `data` es un dato, no un error.
        """
        key, canonical = cache_key(path, body)
        with self._lock:
            cached = self.db.execute("SELECT body, status FROM cache WHERE key = ?", (key,)).fetchone()
        if cached:
            self._log(path, key, cached[1], local_hit=True)
            return json.loads(cached[0]).get("data")

        if not allow_network or self.offline:
            return self._skip(path, body, "sin_red")
        if path in self.tripped:
            return self._skip(path, body, "endpoint_caido")
        if not self.api_key:
            raise CromaError("Falta CROMA_API_KEY en el entorno.")

        with self._lock:
            spent = self.spent_today()
            # Con varias consultas en paralelo, las que están en vuelo también cuentan.
            if spent + self._inflight >= self.daily_budget:
                self._skip(path, body, "presupuesto_agotado")
                raise BudgetExhausted(f"Presupuesto agotado: {spent}/{self.daily_budget} peticiones hoy (UTC).")
            self._inflight += 1
        try:
            return self._request(path, body, key, canonical)
        finally:
            with self._lock:
                self._inflight -= 1

    def _request(self, path, body, key, canonical):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "SecopOpportunitiesEngine/1.0",
        }
        data = json.dumps(body).encode("utf-8")
        last_error: Optional[CromaError] = None

        for attempt in range(1, self.max_retries + 1):
            started = time.monotonic()
            try:
                status, res_headers, text = self.transport("POST", self.base_url + path, headers, data, self.timeout)
            except (urllib.error.URLError, OSError, TimeoutError) as err:
                self._log(path, key, None, latency_ms=int((time.monotonic() - started) * 1000),
                          attempt=attempt, error=str(err)[:300])
                last_error = CromaError(f"Error de red en {path}: {err}")
                if attempt < self.max_retries:
                    self.sleep(2 ** attempt * 0.5)
                    continue
                raise last_error from err

            latency = int((time.monotonic() - started) * 1000)
            ok = 200 <= status < 300
            self._log(path, key, status, res_headers, latency, attempt=attempt, error=None if ok else text[:500])

            if status == 429:
                retry_after = _int_header(res_headers, "retry-after")
                last_error = CromaError(f"429 rate_limit_error en {path}", status)
                if attempt < self.max_retries:
                    self.sleep(retry_after if retry_after and retry_after > 0 else 2 ** attempt)
                    continue
                raise last_error

            if not ok:
                err = CromaError(f"HTTP {status} en {path}: {text[:300]}", status)
                if status < 500:
                    raise err   # un 4xx no cambia al repetirlo
                with self._lock:
                    n = self._failures.get(path, 0) + 1
                    self._failures[path] = n
                    if n >= self.circuit_threshold:
                        self.tripped.add(path)
                if path in self.tripped:
                    return self._skip(path, body, "endpoint_caido")
                last_error = err
                if attempt < self.max_retries:
                    self.sleep(2 ** attempt * 0.5)
                    continue
                raise err

            with self._lock:
                self._failures.pop(path, None)   # una respuesta buena limpia el historial
            try:
                payload = json.loads(text)
            except ValueError as err:
                raise CromaError(f"Respuesta que no es JSON en {path}: {text[:200]}", status) from err

            # 202: trabajo asíncrono con data null. Guardarlo así lo haría indistinguible de
            # "consultado y sin resultado"; hay que resolverlo o dejarlo sin caché.
            job = payload.get("job") if isinstance(payload, dict) else None
            if status == 202 and isinstance(job, dict) and job.get("status_url"):
                payload = self._poll_job(job["status_url"], path, key, headers)
                if payload is None:
                    return self._skip(path, body, "trabajo_sin_resolver")
                text = json.dumps(payload, ensure_ascii=False)

            with self._lock:
                self.db.execute(
                    "INSERT INTO cache (key, endpoint, params, body, status, fetched_at) VALUES (?,?,?,?,?,?)"
                    " ON CONFLICT(key) DO UPDATE SET body = excluded.body, status = excluded.status,"
                    " fetched_at = excluded.fetched_at",
                    (key, path, canonical, text, status, self.now().isoformat()),
                )
                self.db.commit()
            return payload.get("data")

        raise last_error or CromaError(f"Fallo sin diagnóstico en {path}")

    def _poll_job(self, status_url, path, key, headers):
        poll_headers = {k: v for k, v in headers.items() if k != "Content-Type"}
        for i in range(1, self.job_polls + 1):
            self.sleep(self.job_interval)
            started = time.monotonic()
            try:
                status, res_headers, text = self.transport("GET", status_url, poll_headers, None, self.timeout)
            except (urllib.error.URLError, OSError, TimeoutError):
                continue
            ok = 200 <= status < 300
            self._log(path + JOB_POLL_SUFFIX, key, status, res_headers, int((time.monotonic() - started) * 1000),
                      attempt=i, error=None if ok else text[:300])
            if not ok:
                continue
            try:
                payload = json.loads(text)
            except ValueError:
                continue
            job = payload.get("job") or {}
            state = job.get("status") or payload.get("status")
            if state in ("running", "queued", "pending"):
                continue
            if payload.get("data") is not None:
                return payload
            if state in ("failed", "error"):
                return None
        return None
