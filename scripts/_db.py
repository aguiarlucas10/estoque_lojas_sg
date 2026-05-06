"""Cliente HTTP fino para a REST API do Supabase (PostgREST + RPC).

Evita a dep do supabase-py (que puxa pyiceberg e exige compilador C no
Windows com Python 3.14). Usa service_role -> bypassa RLS.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


class Sb:
    def __init__(self, url: str, key: str, timeout: float = 60.0) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        self.client = httpx.Client(timeout=timeout)

    # ---------- internal ----------
    def _params(self, filters: dict[str, str] | None, columns: str | None,
                order: str | None, limit: int | None, offset: int | None) -> dict[str, str]:
        params: dict[str, str] = {}
        if columns:
            params["select"] = columns
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        return params

    def _check(self, r: httpx.Response) -> None:
        if r.status_code >= 300:
            raise RuntimeError(f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text}")

    # ---------- queries ----------
    def select(self, table: str, columns: str = "*", filters: dict[str, str] | None = None,
               order: str | None = None, limit: int | None = None,
               offset: int | None = None) -> list[dict]:
        r = self.client.get(
            f"{self.base}/{table}",
            headers=self.headers,
            params=self._params(filters, columns, order, limit, offset),
        )
        self._check(r)
        return r.json()

    def select_all(self, table: str, columns: str = "*",
                   filters: dict[str, str] | None = None,
                   page_size: int = 1000) -> list[dict]:
        out: list[dict] = []
        offset = 0
        while True:
            chunk = self.select(table, columns, filters, limit=page_size, offset=offset)
            out.extend(chunk)
            if len(chunk) < page_size:
                return out
            offset += page_size

    def count(self, table: str, filters: dict[str, str] | None = None) -> int:
        r = self.client.get(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
            params=self._params(filters, "*", None, None, None),
        )
        self._check(r)
        cr = r.headers.get("Content-Range", "*/0")
        return int(cr.split("/")[-1]) if "/" in cr else 0

    def insert(self, table: str, rows: list[dict] | dict, returning: bool = True) -> list[dict]:
        if isinstance(rows, dict):
            rows = [rows]
        prefer = "return=representation" if returning else "return=minimal"
        r = self.client.post(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": prefer},
            json=rows,
        )
        self._check(r)
        return r.json() if returning else []

    def upsert(self, table: str, rows: list[dict] | dict, on_conflict: str,
               returning: bool = True) -> list[dict]:
        if isinstance(rows, dict):
            rows = [rows]
        prefer = (
            "resolution=merge-duplicates,"
            + ("return=representation" if returning else "return=minimal")
        )
        r = self.client.post(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": prefer},
            params={"on_conflict": on_conflict},
            json=rows,
        )
        self._check(r)
        return r.json() if returning else []

    def update(self, table: str, patch: dict, filters: dict[str, str],
               returning: bool = True) -> list[dict]:
        prefer = "return=representation" if returning else "return=minimal"
        r = self.client.patch(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": prefer},
            params=filters,
            json=patch,
        )
        self._check(r)
        return r.json() if returning else []

    # ---------- RPC ----------
    def rpc(self, fn: str, params: dict | None = None) -> Any:
        r = self.client.post(
            f"{self.base}/rpc/{fn}",
            headers=self.headers,
            json=params or {},
        )
        self._check(r)
        if not r.text:
            return None
        return r.json()


@lru_cache(maxsize=1)
def get_client() -> Sb:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar em .env")
    return Sb(url, key)


if __name__ == "__main__":
    db = get_client()
    print(f"Conectado em {os.environ['SUPABASE_URL']}")
    # Ping: select 1 do PostgREST root
    r = db.client.get(f"{db.base}/", headers=db.headers)
    print("status:", r.status_code)
