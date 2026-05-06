"""Cria as 4 lojas no banco. Idempotente (upsert por codigo)."""
from __future__ import annotations

import sys

from _db import get_client

LOJAS = [
    {"codigo": "BAL", "nome": "Balneário Shopping", "nome_pdv": "QUIOSQUE BALNEARIO SHOPPING"},
    # 2 espacos entre MOOCA e PLAZA, conforme aparece no PDV
    {"codigo": "MOO", "nome": "Mooca Plaza",        "nome_pdv": "QUIOSQUE MOOCA  PLAZA"},
    {"codigo": "GAR", "nome": "Garten Shopping",    "nome_pdv": "QUIOSQUE GARTEN SHOPPING"},
    {"codigo": "NEU", "nome": "Neumarkt Shopping",  "nome_pdv": "QUIOSQUE NEUMARKT SHOPPING"},
]


def main() -> int:
    db = get_client()
    db.upsert("lj_lojas", LOJAS, on_conflict="codigo")
    rows = db.select("lj_lojas", "codigo, nome, nome_pdv", order="codigo")
    print(f"Total de lojas no banco: {len(rows)}")
    for r in rows:
        print(f"  {r['codigo']}  {r['nome']:25s}  ({r['nome_pdv']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
