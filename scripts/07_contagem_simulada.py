"""Roda 1 ciclo completo de contagem amostragem em uma loja.

Cria sessao -> popula lj_sessoes_itens com qtd_teorica (snapshot) ->
simula bipagens via update qtd_contada (60% bate, 20% +1, 20% -1/-2) ->
aprova todos os itens -> aplicar_contagem_validada (gera movimentos).

Uso:
    python scripts/07_contagem_simulada.py --loja BAL
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timezone

from _db import get_client


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loja", required=True)
    ap.add_argument("--n", type=int, default=12, help="qtd de SKUs no escopo")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    random.seed(args.seed)
    db = get_client()

    lojas = db.select("lj_lojas", "id", filters={"codigo": f"eq.{args.loja}"})
    if not lojas:
        print(f"ERRO: loja {args.loja}", file=sys.stderr); return 1
    loja_id = lojas[0]["id"]

    print("Buscando SKUs com saldo positivo...")
    saldos = db.select(
        "lj_estoque_atual",
        columns="produto_id, quantidade",
        filters={"loja_id": f"eq.{loja_id}", "quantidade": "gt.0"},
    )
    if not saldos:
        print("ERRO: nenhum SKU com saldo>0. Rode 06_recebimento_simulado antes.", file=sys.stderr)
        return 1
    random.shuffle(saldos)
    escopo = saldos[: args.n]
    print(f"Escopo: {len(escopo)} SKUs")

    sessao_row = db.insert("lj_sessoes_contagem", {
        "loja_id": loja_id,
        "tipo": "amostragem",
        "status": "aberta",
        "escopo": {"selecao": "saldo_positivo", "n": len(escopo)},
        "iniciada_em": datetime.now(timezone.utc).isoformat(),
    })
    sessao_id = sessao_row[0]["id"]
    print(f"sessao_id = {sessao_id}")

    # Snapshot: 1 linha por SKU em lj_sessoes_itens com qtd_teorica
    itens = [{
        "sessao_id": sessao_id,
        "produto_id": s["produto_id"],
        "qtd_teorica": float(s["quantidade"]),
        "qtd_contada": 0,
        "status": "pendente",
    } for s in escopo]
    db.insert("lj_sessoes_itens", itens, returning=False)
    db.update("lj_sessoes_contagem", {"status": "em_contagem"},
              filters={"id": f"eq.{sessao_id}"})

    # Bipagens simuladas: update qtd_contada por SKU
    for s in escopo:
        teorica = int(float(s["quantidade"]))
        roll = random.random()
        if roll < 0.6:
            contada = teorica
        elif roll < 0.8:
            contada = teorica + 1
        else:
            contada = max(0, teorica - random.randint(1, 2))
        db.update("lj_sessoes_itens", {"qtd_contada": contada}, filters={
            "sessao_id": f"eq.{sessao_id}",
            "produto_id": f"eq.{s['produto_id']}",
        })

    db.update("lj_sessoes_contagem", {"status": "em_revisao"},
              filters={"id": f"eq.{sessao_id}"})

    # Aprova todos
    db.update("lj_sessoes_itens", {
        "status": "aprovada",
        "aprovado_em": datetime.now(timezone.utc).isoformat(),
    }, filters={"sessao_id": f"eq.{sessao_id}"})

    aplicadas = db.rpc("aplicar_contagem_validada", {"p_sessao_id": sessao_id})
    print(f"movimentos contagem_validada gerados: {aplicadas}")

    db.rpc("refresh_estoque_atual")

    rows = db.select(
        "lj_sessoes_itens", "diferenca, valor_diferenca",
        filters={"sessao_id": f"eq.{sessao_id}"},
    )
    bate = sum(1 for r in rows if float(r["diferenca"]) == 0)
    excesso = sum(1 for r in rows if float(r["diferenca"]) > 0)
    quebra = sum(1 for r in rows if float(r["diferenca"]) < 0)
    valor_quebra = sum(float(r["valor_diferenca"] or 0) for r in rows if float(r["diferenca"]) < 0)
    print()
    print(f"  bateu:        {bate}")
    print(f"  excesso (+):  {excesso}")
    print(f"  quebra (-):   {quebra}")
    print(f"  valor quebra: R$ {valor_quebra:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
