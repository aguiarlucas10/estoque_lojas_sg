/**
 * Parser do relatorio PDV analitico (formato impresso, UTF-8, separador `,`).
 *
 * Cada linha CSV (apos juntar quebras dentro de aspas) corresponde a 1
 * registro de venda ou troca. Localiza campos por marcadores em vez de
 * posicao absoluta (mais robusto contra mudanca de layout).
 */
import { parse } from "csv-parse/sync";

export type ParsedRow = {
  loja_pdv: string;
  vendedor: string | null;
  doc: string | null;
  data: string | null;          // YYYY-MM-DD
  hora: string | null;          // HH:MM
  codigo_origem: string;
  descricao_origem: string | null;
  preco_praticado: number | null;
  preco_tabela: number | null;
  operacao: "Venda" | "Troca";
  qtd: number | null;
};

const DATA_RE = /^\d{2}\/\d{2}\/\d{2}$/;
const HORA_RE = /^\d{1,2}:\d{2}$/;

function parseDataDDMMAA(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!DATA_RE.test(t)) return null;
  const [dd, mm, aa] = t.split("/");
  const year = 2000 + parseInt(aa, 10);
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseNumBR(s: string | undefined | null): number | null {
  if (s === null || s === undefined || s === "") return null;
  const cleaned = String(s).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function findAfter(row: string[], marker: string): string | null {
  for (let i = 0; i < row.length - 1; i++) {
    if (row[i] === marker) return row[i + 1];
  }
  return null;
}

function findIndex(row: string[], marker: string): number {
  return row.indexOf(marker);
}

function parseRow(row: string[]): ParsedRow | null {
  if (!row || row[0] !== "Relatório de vendas/vendedor") return null;

  const loja = findAfter(row, "Loja :");
  const vendedor = findAfter(row, "Vendedor  :") ?? findAfter(row, "Vendedor :");
  const codigo = findAfter(row, "Ítens :");
  const operacao = findAfter(row, "Operação :");
  const precoPraticadoRaw = findAfter(row, "P. Praticado :");
  const precoTabelaRaw = findAfter(row, "P. Tabela :");

  if (!loja || !codigo || !operacao) return null;
  if (operacao !== "Venda" && operacao !== "Troca") return null;

  // Apos "Desconto": [doc, data, "", hora]
  const descIdx = findIndex(row, "Desconto");
  let doc: string | null = null;
  let dataStr: string | null = null;
  let horaStr: string | null = null;
  if (descIdx >= 0) {
    doc = row[descIdx + 1] ?? null;
    dataStr = row[descIdx + 2] ?? null;
    horaStr = row[descIdx + 4] ?? null;
  }

  const qtdIdx = findIndex(row, "Qtd.:");
  let qtd: number | null = null;
  if (qtdIdx >= 0 && qtdIdx + 1 < row.length) {
    const raw = row[qtdIdx + 1];
    const n = parseInt(raw, 10);
    qtd = Number.isFinite(n) ? n : parseNumBR(raw);
  }

  // Descricao: campo logo apos `"Ítens :", codigo`
  let descricao: string | null = null;
  const itensIdx = findIndex(row, "Ítens :");
  if (itensIdx >= 0 && itensIdx + 2 < row.length) {
    descricao = row[itensIdx + 2] ?? null;
  }

  return {
    loja_pdv: loja,
    vendedor: vendedor ?? null,
    doc: doc ?? null,
    data: parseDataDDMMAA(dataStr),
    hora: horaStr && HORA_RE.test(horaStr) ? horaStr : null,
    codigo_origem: codigo,
    descricao_origem: descricao,
    preco_praticado: parseNumBR(precoPraticadoRaw),
    preco_tabela: parseNumBR(precoTabelaRaw),
    operacao,
    qtd,
  };
}

const PERIODO_RE = /^Período de (\d{2})\/(\d{2})\/(\d{4}) Até (\d{2})\/(\d{2})\/(\d{4})$/;

function extrairPeriodo(rows: string[][]): { inicio: string; fim: string } | null {
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const m = PERIODO_RE.exec(row[1] ?? "");
    if (m) {
      const [, dd1, mm1, yyyy1, dd2, mm2, yyyy2] = m;
      return {
        inicio: `${yyyy1}-${mm1}-${dd1}`,
        fim: `${yyyy2}-${mm2}-${dd2}`,
      };
    }
  }
  return null;
}

export function parseCSVPDV(content: string | Buffer): {
  registros: ParsedRow[];
  periodo: { inicio: string; fim: string } | null;
  descartadas: number;
} {
  const text = typeof content === "string" ? content : content.toString("utf-8");

  // csv-parse junta quebras de linha dentro de aspas automaticamente
  const rows: string[][] = parse(text, {
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    quote: '"',
  });

  const registros: ParsedRow[] = [];
  let descartadas = 0;
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const parsed = parseRow(row);
    if (parsed) registros.push(parsed);
    else descartadas++;
  }

  let periodo = extrairPeriodo(rows);
  // Fallback: usa min/max das datas dos registros parseados
  if (!periodo && registros.length > 0) {
    const datas = registros.map((r) => r.data).filter((d): d is string => !!d).sort();
    if (datas.length > 0) {
      periodo = { inicio: datas[0], fim: datas[datas.length - 1] };
    }
  }

  return { registros, periodo, descartadas };
}
