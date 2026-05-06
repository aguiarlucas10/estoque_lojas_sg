"""Gera propostas de sku_aliases para os codigos orfaos do PDV.

Modo padrao (offline): le data/vendas_parseadas.json + Info Cadastro.csv,
faz fuzzy match e escreve data/aliases_propostos.csv para revisao manual.

Modo --aplicar: le o CSV revisado (coluna 'escolhido' preenchida) e insere
em sku_aliases via Supabase.

Uso:
    python scripts/03_seed_aliases.py
    python scripts/03_seed_aliases.py --aplicar
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from rapidfuzz import process, fuzz


def normalizar(s: str) -> str:
    """lowercase + remove acentos. Necessario porque PDV vem em CAIXA ALTA
    e Nuvemshop em Caixa Mista, e token_set_ratio e case-sensitive."""
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s)
    sem_acento = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return sem_acento.lower().strip()

ROOT = Path(__file__).resolve().parent.parent
VENDAS_JSON = ROOT / "data" / "vendas_parseadas.json"
NUVEMSHOP_CSV = ROOT / "Info Cadastro.csv"
PROPOSTAS_CSV = ROOT / "data" / "aliases_propostos.csv"


def carregar_produtos_nuvemshop() -> list[dict]:
    """Le Info Cadastro.csv (latin-1, ;) e retorna todos os SKUs.
    Produtos sem 'Nome (Portugues)' (~1.064 sao variantes tipo CLRx com EAN)
    ainda contam pra resolucao via SKU/EAN; so nao entram no fuzzy de nome.
    """
    produtos: list[dict] = []
    with NUVEMSHOP_CSV.open("r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            sku = (row.get("SKU") or "").strip()
            nome = (row.get("Nome (Português)") or "").strip()
            ean = (row.get("Código de barras") or "").strip()
            if sku:
                produtos.append({"sku": sku, "nome": nome, "ean": ean})
    return produtos


def identificar_orfaos(vendas: list[dict], produtos: list[dict]) -> dict[str, dict]:
    """Retorna {codigo_origem: {descricao, qtd_aparicoes}} para codigos
    que nao batem nem com SKU nem com EAN do cadastro Nuvemshop."""
    skus = {p["sku"] for p in produtos}
    eans = {p["ean"] for p in produtos if p["ean"]}

    aparicoes: dict[str, Counter] = defaultdict(Counter)
    for v in vendas:
        cod = v.get("codigo_origem")
        desc = v.get("descricao_origem")
        if cod and cod not in skus and cod not in eans:
            aparicoes[cod][desc or ""] += 1

    orfaos: dict[str, dict] = {}
    for cod, descs in aparicoes.items():
        descricao_top = descs.most_common(1)[0][0]
        orfaos[cod] = {
            "descricao": descricao_top,
            "qtd_aparicoes": sum(descs.values()),
        }
    return orfaos


def fuzzy_top3(descricao: str, produtos: list[dict]) -> list[tuple[dict, float]]:
    """Top 3 candidatos. Usa token_set_ratio como score primario (tolera ordem
    e palavras extras) e ratio como desempate (penaliza diferencas de tamanho —
    importante quando varios produtos tem token_set_ratio=100 mas alguns sao
    nomes mais genericos contidos em nomes mais especificos)."""
    candidatos = [p for p in produtos if p["nome"]]
    nomes_norm = [normalizar(p["nome"]) for p in candidatos]
    descricao_norm = normalizar(descricao)

    pre = process.extract(
        descricao_norm, nomes_norm, scorer=fuzz.token_set_ratio, limit=15
    )
    rescored: list[tuple[dict, float, float]] = []
    for _nome_match, score, idx in pre:
        nome_norm = nomes_norm[idx]
        # ratio (Levenshtein) eh menor quando o tamanho difere muito
        tiebreak = fuzz.ratio(descricao_norm, nome_norm)
        rescored.append((candidatos[idx], float(score), float(tiebreak)))
    rescored.sort(key=lambda x: (-x[1], -x[2]))
    return [(p, s) for p, s, _t in rescored[:3]]


def gerar_propostas() -> int:
    if not VENDAS_JSON.exists():
        print(f"ERRO: rode primeiro o parser ({VENDAS_JSON} nao existe)", file=sys.stderr)
        return 1

    vendas = json.loads(VENDAS_JSON.read_text(encoding="utf-8"))
    produtos = carregar_produtos_nuvemshop()
    print(f"Vendas parseadas: {len(vendas)}")
    print(f"Produtos Nuvemshop: {len(produtos)}")

    orfaos = identificar_orfaos(vendas, produtos)
    print(f"Codigos orfaos (nao batem com SKU nem EAN): {len(orfaos)}")

    PROPOSTAS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with PROPOSTAS_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow([
            "codigo", "descricao_pdv", "qtd_aparicoes",
            "sku_1", "nome_1", "score_1",
            "sku_2", "nome_2", "score_2",
            "sku_3", "nome_3", "score_3",
            "escolhido",
        ])
        for cod, info in sorted(orfaos.items(), key=lambda kv: -kv[1]["qtd_aparicoes"]):
            top = fuzzy_top3(info["descricao"], produtos)
            row = [cod, info["descricao"], info["qtd_aparicoes"]]
            for prod, score in top:
                row.extend([prod["sku"], prod["nome"], f"{score:.0f}"])
            while len(row) < 12:  # 3 base + 3 sugestoes x 3 campos = 12 antes do escolhido
                row.extend(["", "", ""])
            # Pre-preenche com top-1 — usuario revisa e ajusta os duvidosos
            escolhido_default = top[0][0]["sku"] if top else ""
            row.append(escolhido_default)
            w.writerow(row)

    print(f"-> {PROPOSTAS_CSV}")
    print()
    print("Proximos passos:")
    print(f"  1. Abra {PROPOSTAS_CSV.name} (separador ';')")
    print("  2. Para cada linha, preencha 'escolhido' com o SKU correto")
    print("     (ou deixe vazio para ignorar / tratar como produto-fantasma)")
    print("  3. Rode novamente com --aplicar (precisa de credenciais Supabase)")
    return 0


def aplicar() -> int:
    if not PROPOSTAS_CSV.exists():
        print(f"ERRO: {PROPOSTAS_CSV} nao existe. Rode sem --aplicar primeiro.", file=sys.stderr)
        return 1

    from _db import get_client  # import local para nao exigir .env no modo propor
    db = get_client()

    produtos_db = db.select_all("lj_produtos", "id, sku")
    sku_to_id = {p["sku"]: p["id"] for p in produtos_db}

    inseridos = 0
    pulados = 0
    erros: list[str] = []
    with PROPOSTAS_CSV.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            escolhido = (row.get("escolhido") or "").strip()
            codigo = (row.get("codigo") or "").strip()
            if not escolhido:
                pulados += 1
                continue
            produto_id = sku_to_id.get(escolhido)
            if not produto_id:
                erros.append(f"{codigo}: SKU '{escolhido}' nao existe em produtos")
                continue
            try:
                db.insert("lj_sku_aliases", {
                    "produto_id": produto_id,
                    "codigo_alias": codigo,
                    "origem": "pdv_legado",
                }, returning=False)
                inseridos += 1
            except Exception as e:
                erros.append(f"{codigo}: {e}")

    print(f"Inseridos:  {inseridos}")
    print(f"Pulados:    {pulados} (escolhido vazio)")
    if erros:
        print(f"Erros:      {len(erros)}")
        for e in erros[:10]:
            print(f"  {e}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true",
                    help="Le aliases_propostos.csv e insere em sku_aliases")
    args = ap.parse_args()
    return aplicar() if args.aplicar else gerar_propostas()


if __name__ == "__main__":
    sys.exit(main())
