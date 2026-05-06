"""Importa os 2.231 produtos do export Nuvemshop (Info Cadastro.csv).

- encoding latin-1, separador ;
- categoria deduzida do nome via regex
- subcategoria = campo 'Sexo' (lowercase)
- custo = null (sera populado pelos recebimentos)
- nome ausente (1.064 SKUs tipo CLRx) -> usa SKU como placeholder
- upsert por sku, em batches de 500
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

from _db import get_client

ROOT = Path(__file__).resolve().parent.parent
NUVEMSHOP_CSV = ROOT / "Info Cadastro.csv"

# Ordem importa: testar mais especifico antes do generico (Óculos de Grau antes de Óculos)
CATEGORIAS_REGEX = [
    ("Óculos de Sol",   re.compile(r"\b(óculos|oculos)\s+de\s+sol\b", re.IGNORECASE)),
    ("Óculos de Grau",  re.compile(r"\b(óculos|oculos)\s+de\s+grau\b", re.IGNORECASE)),
    ("Relógio",         re.compile(r"\brel[óo]gio\b", re.IGNORECASE)),
    ("Semijoias",       re.compile(r"\b(brinco|colar|pulseira|anel|semijoia|bracelete)\b", re.IGNORECASE)),
    ("Embalagem",       re.compile(r"\b(embalagem|sacola|caixa)\b", re.IGNORECASE)),
]


def deduzir_categoria(nome: str) -> str | None:
    if not nome:
        return None
    for cat, rx in CATEGORIAS_REGEX:
        if rx.search(nome):
            return cat
    return None


def carregar_produtos() -> list[dict]:
    produtos: list[dict] = []
    with NUVEMSHOP_CSV.open("r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            sku = (row.get("SKU") or "").strip()
            if not sku:
                continue
            nome = (row.get("Nome (Português)") or "").strip() or sku
            ean = (row.get("Código de barras") or "").strip() or None
            sexo = (row.get("Sexo") or "").strip().lower() or None
            produtos.append({
                "sku": sku,
                "ean": ean,
                "nome": nome,
                "categoria": deduzir_categoria(nome),
                "subcategoria": sexo,
                "custo": None,
                "preco_venda": None,
                "ativo": True,
            })
    return produtos


def main() -> int:
    db = get_client()
    produtos = carregar_produtos()
    print(f"Lendo {NUVEMSHOP_CSV.name}: {len(produtos)} produtos")

    sem_categoria = sum(1 for p in produtos if not p["categoria"])
    print(f"  sem categoria deduzida: {sem_categoria}  (revisar depois)")

    BATCH = 500
    inseridos = 0
    for i in range(0, len(produtos), BATCH):
        batch = produtos[i:i + BATCH]
        db.upsert("lj_produtos", batch, on_conflict="sku", returning=False)
        inseridos += len(batch)
        print(f"  upsert batch {i // BATCH + 1}: {inseridos}/{len(produtos)}")

    total = db.count("lj_produtos")
    print(f"\nTotal de produtos no banco: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
