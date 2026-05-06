"""Cria 1 recebimento com 10-15 itens em uma loja.

Seleciona SKUs que tiveram venda no periodo importado (para popular saldo
positivo em produtos com historico interessante). Custo arbitrario coerente
com preco praticado mais comum (custo ~ 40% do preco).

Uso:
    python scripts/06_recebimento_simulado.py --loja BAL
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import date

from _db import get_client


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loja", required=True)
    ap.add_argument("--n", type=int, default=12, help="qtd de SKUs no recebimento")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    db = get_client()

    lojas = db.select("lj_lojas", "id", filters={"codigo": f"eq.{args.loja}"})
    if not lojas:
        print(f"ERRO: loja {args.loja}", file=sys.stderr); return 1
    loja_id = lojas[0]["id"]

    # Vendas aplicadas com produto resolvido (paginadas)
    print("Buscando SKUs com venda historica...")
    vendas = db.select_all(
        "lj_imports_vendas_linhas",
        columns="produto_id, preco_praticado",
        filters={
            "status": "eq.aplicado",
            "operacao": "eq.Venda",
            "produto_id": "not.is.null",
        },
    )
    by_prod: dict[str, list[float]] = {}
    for v in vendas:
        if v.get("preco_praticado") is not None:
            by_prod.setdefault(v["produto_id"], []).append(float(v["preco_praticado"]))
    if not by_prod:
        print("ERRO: nenhuma venda aplicada — rode o import antes.", file=sys.stderr)
        return 1
    print(f"  candidatos com venda: {len(by_prod)}")

    candidatos = list(by_prod.keys())
    random.shuffle(candidatos)
    selecionados = candidatos[: args.n]

    receb_row = db.insert("lj_recebimentos", {
        "loja_id": loja_id,
        "fornecedor": "Saint Germain Distribuicao (simulado)",
        "nf_numero": f"NF-SIM-{random.randint(10000, 99999)}",
        "data_recebimento": date.today().isoformat(),
        "observacao": "Recebimento simulado para teste end-to-end",
    })
    receb_id = receb_row[0]["id"]
    print(f"recebimento id = {receb_id}")

    itens = []
    total_qtd = 0
    total_valor = 0.0
    for produto_id in selecionados:
        precos = by_prod[produto_id]
        preco_medio = sum(precos) / len(precos)
        custo = round(preco_medio * 0.4, 2)
        qtd = random.randint(5, 20)
        itens.append({
            "recebimento_id": receb_id,
            "produto_id": produto_id,
            "qtd": qtd,
            "custo_unitario": custo,
        })
        total_qtd += qtd
        total_valor += custo * qtd

    db.insert("lj_recebimentos_itens", itens, returning=False)
    db.update("lj_recebimentos", {
        "total_itens": len(itens),
        "total_valor": round(total_valor, 2),
    }, filters={"id": f"eq.{receb_id}"})

    db.rpc("refresh_estoque_atual")

    print(f"  itens:        {len(itens)}")
    print(f"  qtd total:    {total_qtd}")
    print(f"  valor total:  R$ {total_valor:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
