"""Importa vendas de uma loja para o periodo informado.

Le data/vendas_parseadas.json (gerado pelo 04_parser_pdv.py).
Resolve produto_id por: produtos.sku -> produtos.ean -> sku_aliases.codigo_alias.
Insere imports_vendas + imports_vendas_linhas + movimentos_estoque (apenas para
Operacao=Venda com qtd>0).

Uso:
    python scripts/05_import_vendas.py --loja BAL --inicio 2026-04-01 --fim 2026-04-30
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from _db import get_client

ROOT = Path(__file__).resolve().parent.parent
VENDAS_JSON = ROOT / "data" / "vendas_parseadas.json"


def parse_iso(s: str) -> date:
    return date.fromisoformat(s)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--loja", required=True, help="codigo da loja (BAL, MOO, GAR, NEU)")
    ap.add_argument("--inicio", required=True, help="data inicio YYYY-MM-DD")
    ap.add_argument("--fim", required=True, help="data fim YYYY-MM-DD")
    args = ap.parse_args()

    db = get_client()

    lojas = db.select("lj_lojas", "id, nome_pdv", filters={"codigo": f"eq.{args.loja}"})
    if not lojas:
        print(f"ERRO: loja '{args.loja}' nao encontrada", file=sys.stderr)
        return 1
    loja_id = lojas[0]["id"]
    nome_pdv = lojas[0]["nome_pdv"]

    if not VENDAS_JSON.exists():
        print(f"ERRO: rode antes o parser ({VENDAS_JSON})", file=sys.stderr)
        return 1
    todas = json.loads(VENDAS_JSON.read_text(encoding="utf-8"))

    inicio = parse_iso(args.inicio)
    fim = parse_iso(args.fim)
    vendas = [
        v for v in todas
        if v["loja_pdv"] == nome_pdv
        and v["data"]
        and inicio <= parse_iso(v["data"]) <= fim
    ]
    print(f"Vendas filtradas (loja={args.loja}, periodo): {len(vendas)}")

    # ====== Carrega lookups ======
    print("Carregando produtos e aliases...")
    produtos = db.select_all("lj_produtos", "id, sku, ean")
    sku_to_id = {p["sku"]: p["id"] for p in produtos}
    ean_to_id = {p["ean"]: p["id"] for p in produtos if p["ean"]}
    aliases = db.select_all("lj_sku_aliases", "codigo_alias, produto_id")
    alias_to_id = {a["codigo_alias"]: a["produto_id"] for a in aliases}
    print(f"  produtos: {len(sku_to_id)}, EANs: {len(ean_to_id)}, aliases: {len(alias_to_id)}")

    # ====== Checa reimport (mesma loja + periodo ja importado) ======
    previos = db.select("lj_imports_vendas",
                        columns="id, status, importado_em",
                        filters={
                            "loja_id": f"eq.{loja_id}",
                            "periodo_inicio": f"eq.{args.inicio}",
                            "periodo_fim": f"eq.{args.fim}",
                        })
    if previos:
        print(f"AVISO: ja existe(m) {len(previos)} import(s) anterior(es) para essa loja/periodo:")
        for p in previos:
            print(f"  id={p['id']}  status={p['status']}  em={p['importado_em']}")
        print("Abortando para evitar duplicacao. Apague-os antes de re-importar:")
        for p in previos:
            print(f"  delete from lj_imports_vendas where id='{p['id']}';")
        return 1

    # ====== Cria registro de import ======
    n_vendas = sum(1 for v in vendas if v["operacao"] == "Venda")
    n_trocas = sum(1 for v in vendas if v["operacao"] == "Troca")
    import_row = db.insert("lj_imports_vendas", {
        "loja_id": loja_id,
        "fonte": "pdv_analitico",
        "periodo_inicio": args.inicio,
        "periodo_fim": args.fim,
        "arquivo_nome": "pdv analitico_.csv",
        "total_linhas": len(vendas),
        "total_vendas": n_vendas,
        "total_trocas": n_trocas,
        "total_skus_nao_encontrados": 0,
        "status": "processando",
    })
    import_id = import_row[0]["id"]
    print(f"imports_vendas id = {import_id}")

    # ====== Resolve e classifica ======
    # Vendas reais (qtd>0) viram 'aplicado'. Trocas (qtd=0) viram 'ignorado'
    # (sao registros do PDV que nao alteram estoque). Sem produto_id, 'orfao'.
    linhas: list[dict] = []
    aplicados = orfaos = ignoradas = 0

    for v in vendas:
        cod = v["codigo_origem"]
        produto_id = sku_to_id.get(cod) or ean_to_id.get(cod) or alias_to_id.get(cod)
        is_venda = v["operacao"] == "Venda" and (v.get("qtd") or 0) > 0

        if produto_id is None:
            status = "orfao"; orfaos += 1
        elif not is_venda:
            status = "ignorado"; ignoradas += 1
        else:
            status = "aplicado"; aplicados += 1

        linhas.append({
            "import_id": import_id,
            "codigo_origem": cod,
            "descricao_origem": v.get("descricao_origem"),
            "produto_id": produto_id,
            "doc_pdv": v.get("doc"),
            "data_venda": v["data"],
            "hora_venda": v.get("hora"),
            "vendedor": v.get("vendedor"),
            "qtd": v.get("qtd") or 0,
            "operacao": v["operacao"],
            "preco_praticado": v.get("preco_praticado"),
            "preco_tabela": v.get("preco_tabela"),
            "status": status,
        })

    # ====== Insere linhas em batch e captura IDs ======
    print(f"Inserindo {len(linhas)} imports_vendas_linhas...")
    BATCH = 200
    linhas_inseridas: list[dict] = []
    for i in range(0, len(linhas), BATCH):
        chunk = linhas[i:i + BATCH]
        linhas_inseridas.extend(db.insert("lj_imports_vendas_linhas", chunk))

    # ====== Gera movimentos para vendas aplicadas com qtd>0 ======
    movimentos = []
    for linha in linhas_inseridas:
        if linha["status"] != "aplicado": continue
        if linha["operacao"] != "Venda": continue
        if (linha.get("qtd") or 0) <= 0: continue
        movimentos.append({
            "loja_id": loja_id,
            "produto_id": linha["produto_id"],
            "tipo": "venda",
            "qtd": -float(linha["qtd"]),
            "custo_unitario": None,
            "data_evento": linha["data_venda"],
            "origem_tipo": "import_vendas",
            "origem_id": linha["id"],
        })

    print(f"Inserindo {len(movimentos)} movimentos_estoque (vendas)...")
    for i in range(0, len(movimentos), BATCH):
        db.insert("lj_movimentos_estoque", movimentos[i:i + BATCH], returning=False)

    # ====== Finaliza import ======
    status_final = "concluido" if orfaos == 0 else "aguardando_resolucao"
    db.update("lj_imports_vendas", {
        "total_skus_nao_encontrados": orfaos,
        "status": status_final,
    }, filters={"id": f"eq.{import_id}"})

    db.rpc("refresh_estoque_atual")

    print()
    print(f"  aplicados:    {aplicados}")
    print(f"  orfaos:       {orfaos}")
    print(f"  ignoradas:    {ignoradas}  (trocas e qtd=0)")
    print(f"  movimentos:   {len(movimentos)}")
    print(f"  status:       {status_final}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
