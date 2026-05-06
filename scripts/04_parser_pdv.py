"""Parser standalone do PDV analítico → JSON.

Não toca no banco. Lê o CSV, extrai vendas/trocas, valida cobertura.
Meta: 1.862 registros do CSV de abril (1.823 vendas + 39 trocas).

Uso:
    python scripts/04_parser_pdv.py
    python scripts/04_parser_pdv.py --input "outro.csv" --output data/x.json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "pdv analitico_.csv"
DEFAULT_OUTPUT = ROOT / "data" / "vendas_parseadas.json"

DATA_RE = re.compile(r"^\d{2}/\d{2}/\d{2}$")
HORA_RE = re.compile(r"^\d{1,2}:\d{2}$")


def parse_data_ddmmaa(s: str) -> date | None:
    """`09/04/26` -> date(2026, 4, 9). Ano de 2 dígitos sempre vira 20xx."""
    if not s or not DATA_RE.match(s.strip()):
        return None
    dd, mm, aa = s.strip().split("/")
    return date(2000 + int(aa), int(mm), int(dd))


def parse_num_br(s: str | None) -> float | None:
    """`1.234,56` -> 1234.56. `0,00` -> 0.0."""
    if s is None or s == "":
        return None
    s = s.strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def find_after(row: list[str], marker: str) -> str | None:
    """Retorna o campo imediatamente após o marcador (ou None)."""
    for i, v in enumerate(row):
        if v == marker and i + 1 < len(row):
            return row[i + 1]
    return None


def find_index(row: list[str], marker: str) -> int | None:
    for i, v in enumerate(row):
        if v == marker:
            return i
    return None


def parse_row(row: list[str]) -> dict | None:
    """Extrai 1 registro de venda/troca de uma linha CSV.

    Retorna None se a linha não for um registro válido.
    """
    if not row or row[0] != "Relatório de vendas/vendedor":
        return None

    loja = find_after(row, "Loja :")
    vendedor = find_after(row, "Vendedor  :") or find_after(row, "Vendedor :")
    codigo = find_after(row, "Ítens :")
    operacao = find_after(row, "Operação :")
    preco_praticado_raw = find_after(row, "P. Praticado :")
    preco_tabela_raw = find_after(row, "P. Tabela :")

    if not (loja and codigo and operacao):
        return None

    # Após "Desconto": [doc, data, "", hora, ...]
    desc_idx = find_index(row, "Desconto")
    doc = data_str = hora_str = None
    if desc_idx is not None:
        if desc_idx + 1 < len(row):
            doc = row[desc_idx + 1]
        if desc_idx + 2 < len(row):
            data_str = row[desc_idx + 2]
        if desc_idx + 4 < len(row):
            hora_str = row[desc_idx + 4]

    data_evento = parse_data_ddmmaa(data_str or "")

    # Após "Operação :" vem a operação; o próximo marcador é "Qtd.:" e o
    # campo seguinte é a qtd. Em "Troca", qtd vem 0.
    qtd_idx = find_index(row, "Qtd.:")
    qtd = None
    if qtd_idx is not None and qtd_idx + 1 < len(row):
        try:
            qtd = int(row[qtd_idx + 1])
        except (ValueError, TypeError):
            qtd = parse_num_br(row[qtd_idx + 1])

    # Descrição é o campo logo após o código.
    descricao = None
    itens_idx = find_index(row, "Ítens :")
    if itens_idx is not None and itens_idx + 2 < len(row):
        descricao = row[itens_idx + 2]

    return {
        "loja_pdv": loja,
        "vendedor": vendedor,
        "doc": doc,
        "data": data_evento.isoformat() if data_evento else None,
        "hora": hora_str if hora_str and HORA_RE.match(hora_str) else None,
        "codigo_origem": codigo,
        "descricao_origem": descricao,
        "preco_praticado": parse_num_br(preco_praticado_raw),
        "preco_tabela": parse_num_br(preco_tabela_raw),
        "operacao": operacao,
        "qtd": qtd,
    }


def parse_file(path: Path) -> tuple[list[dict], list[int]]:
    """Retorna (registros_validos, linhas_csv_descartadas)."""
    registros: list[dict] = []
    descartadas: list[int] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, quotechar='"')
        for line_no, row in enumerate(reader, start=1):
            if not row or all(c == "" for c in row):
                continue
            parsed = parse_row(row)
            if parsed is None:
                descartadas.append(line_no)
            else:
                registros.append(parsed)
    return registros, descartadas


def imprime_resumo(registros: list[dict], descartadas: list[int]) -> None:
    print(f"Registros válidos:   {len(registros)}")
    print(f"Linhas descartadas:  {len(descartadas)}")
    if descartadas[:5]:
        print(f"  primeiras descartadas (linha CSV): {descartadas[:5]}")

    op_counter = Counter(r["operacao"] for r in registros)
    print("\nPor operação:")
    for op, n in op_counter.most_common():
        print(f"  {op:10s} {n}")

    loja_counter = Counter(r["loja_pdv"] for r in registros)
    print("\nPor loja:")
    for loja, n in loja_counter.most_common():
        print(f"  {n:5d}  {loja}")

    nulls = {
        "loja_pdv": sum(1 for r in registros if not r["loja_pdv"]),
        "doc": sum(1 for r in registros if not r["doc"]),
        "data": sum(1 for r in registros if not r["data"]),
        "codigo_origem": sum(1 for r in registros if not r["codigo_origem"]),
        "descricao_origem": sum(1 for r in registros if not r["descricao_origem"]),
        "operacao": sum(1 for r in registros if not r["operacao"]),
        "qtd": sum(1 for r in registros if r["qtd"] is None),
    }
    nulos = {k: v for k, v in nulls.items() if v}
    if nulos:
        print(f"\nCampos faltantes: {nulos}")

    codigos = {r["codigo_origem"] for r in registros}
    numericos = {c for c in codigos if c and c.isdigit()}
    print(f"\nCódigos únicos:      {len(codigos)}")
    print(f"  alfanuméricos:     {len(codigos) - len(numericos)}")
    print(f"  numéricos (20xxx): {len(numericos)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = ap.parse_args()

    if not args.input.exists():
        print(f"ERRO: arquivo não encontrado: {args.input}", file=sys.stderr)
        return 1

    print(f"Lendo {args.input.name} ({args.input.stat().st_size:,} bytes)\n")
    registros, descartadas = parse_file(args.input)
    imprime_resumo(registros, descartadas)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(registros, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n-> {args.output} ({len(registros)} registros)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
