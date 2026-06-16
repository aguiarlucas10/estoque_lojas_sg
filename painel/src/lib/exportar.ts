import "server-only";
import { getSupabase, fetchAll } from "@/lib/supabase";

// ============================================================
// Serializacao CSV (pt-BR / Excel)
// Separador ';' + decimal com virgula + BOM UTF-8: abre limpo no
// Excel em portugues sem precisar de "importar dados".
// ============================================================
type Cell = string | number | null | undefined;

function fmtCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(v).replace(".", ",");
  }
  return v;
}

function escapeCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCSV(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(escapeCell).join(";")];
  for (const r of rows) {
    lines.push(r.map((c) => escapeCell(fmtCell(c))).join(";"));
  }
  const BOM = String.fromCharCode(0xfeff); // Excel pt-BR reconhece UTF-8 pelo BOM
  return BOM + lines.join("\r\n");
}

/** "2026-06-10" -> "10/06/2026" (sem mexer em timezone). */
function dataBR(s: string | null | undefined): string {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

/** timestamptz -> "DD/MM/AAAA HH:MM" em America/Sao_Paulo. */
const dataHoraFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
function dataHoraBR(s: string | null | undefined): string {
  if (!s) return "";
  return dataHoraFmt.format(new Date(s));
}

// ============================================================
// Lojas
// ============================================================
export type LojaInfo = { id: string; codigo: string; nome: string };

/**
 * Resolve codigos (BAL, MOO, ...) em LojaInfo, preservando a ordem do
 * cadastro. Codigos invalidos sao ignorados. Vazio => nenhuma loja.
 */
export async function resolverLojas(codigos: string[]): Promise<LojaInfo[]> {
  const set = new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean));
  if (set.size === 0) return [];
  const sb = getSupabase();
  const { data } = await sb
    .from("lj_lojas")
    .select("id, codigo, nome")
    .eq("ativa", true)
    .order("codigo");
  return ((data ?? []) as LojaInfo[]).filter((l) => set.has(l.codigo.toUpperCase()));
}

// ============================================================
// Export: Estoque atual
// ============================================================
type ProdutoRow = {
  id: string;
  sku: string;
  nome: string;
  categoria: string | null;
  custo: number | string | null;
};
type EstoqueRow = {
  produto_id: string;
  quantidade: number | string;
  ultima_contagem_em: string | null;
  ultimo_recebimento_em: string | null;
  ultima_venda_em: string | null;
};

export async function exportarEstoqueCSV(lojas: LojaInfo[]): Promise<string> {
  const headers = [
    "Loja",
    "SKU",
    "Produto",
    "Categoria",
    "Quantidade",
    "Custo un.",
    "Valor",
    "Ult. contagem",
    "Ult. recebimento",
    "Ult. venda",
  ];
  if (lojas.length === 0) return toCSV(headers, []);

  const produtos = await fetchAll<ProdutoRow>((sb) =>
    sb.from("lj_produtos").select("id, sku, nome, categoria, custo").eq("ativo", true),
  );
  const prodById = new Map(produtos.map((p) => [p.id, p]));

  const rows: Cell[][] = [];
  for (const loja of lojas) {
    const estoque = await fetchAll<EstoqueRow>((sb) =>
      sb
        .from("lj_estoque_atual")
        .select(
          "produto_id, quantidade, ultima_contagem_em, ultimo_recebimento_em, ultima_venda_em",
        )
        .eq("loja_id", loja.id),
    );
    // Ordena por SKU para um CSV estavel
    estoque.sort((a, b) => {
      const sa = prodById.get(a.produto_id)?.sku ?? "";
      const sb_ = prodById.get(b.produto_id)?.sku ?? "";
      return sa.localeCompare(sb_, "pt-BR");
    });
    for (const e of estoque) {
      const p = prodById.get(e.produto_id);
      if (!p) continue; // produto inativo/removido — fora do export
      const qtd = Number(e.quantidade);
      const custo = p.custo != null ? Number(p.custo) : null;
      const valor = custo != null ? Math.round(custo * qtd * 100) / 100 : null;
      rows.push([
        loja.codigo,
        p.sku,
        p.nome,
        p.categoria ?? "",
        qtd,
        custo,
        valor,
        dataBR(e.ultima_contagem_em),
        dataBR(e.ultimo_recebimento_em),
        dataBR(e.ultima_venda_em),
      ]);
    }
  }
  return toCSV(headers, rows);
}

// ============================================================
// Export: Contagens (item a item)
// ============================================================
type SessaoRow = {
  id: string;
  loja_id: string;
  tipo: string;
  status: string;
  criado_em: string;
  finalizada_em: string | null;
};
type SessaoItemRow = {
  sessao_id: string;
  produto_id: string;
  qtd_teorica: number | string;
  qtd_contada: number | string;
  diferenca: number | string;
  valor_diferenca: number | string | null;
  status: string;
};

const STATUS_SESSAO: Record<string, string> = {
  aberta: "Aberta",
  em_contagem: "Em contagem",
  em_revisao: "Em revisao",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};
const STATUS_ITEM: Record<string, string> = {
  pendente: "Pendente",
  aprovada: "Aprovada",
  rejeitada: "Rejeitada",
  recontar: "Recontar",
};
const TIPO_SESSAO: Record<string, string> = {
  geral: "Geral",
  amostragem: "Amostragem",
};

export async function exportarContagensCSV(lojas: LojaInfo[]): Promise<string> {
  const headers = [
    "Loja",
    "Sessao",
    "Criada em",
    "Finalizada em",
    "Tipo",
    "Status sessao",
    "SKU",
    "Produto",
    "Qtd teorica",
    "Qtd contada",
    "Diferenca",
    "Valor diferenca",
    "Status item",
  ];
  if (lojas.length === 0) return toCSV(headers, []);

  const lojaById = new Map(lojas.map((l) => [l.id, l]));
  const sb = getSupabase();
  const { data: sessoesData } = await sb
    .from("lj_sessoes_contagem")
    .select("id, loja_id, tipo, status, criado_em, finalizada_em")
    .in("loja_id", lojas.map((l) => l.id))
    .order("criado_em", { ascending: false });
  const sessoes = (sessoesData ?? []) as SessaoRow[];
  if (sessoes.length === 0) return toCSV(headers, []);

  const sessaoById = new Map(sessoes.map((s) => [s.id, s]));
  const sessaoIds = sessoes.map((s) => s.id);

  const itens = await fetchAll<SessaoItemRow>((sb) =>
    sb
      .from("lj_sessoes_itens")
      .select(
        "sessao_id, produto_id, qtd_teorica, qtd_contada, diferenca, valor_diferenca, status",
      )
      .in("sessao_id", sessaoIds),
  );

  const produtos = await fetchAll<{ id: string; sku: string; nome: string }>((sb) =>
    sb.from("lj_produtos").select("id, sku, nome"),
  );
  const prodById = new Map(produtos.map((p) => [p.id, p]));

  // Ordena: sessao mais recente primeiro, depois por SKU
  itens.sort((a, b) => {
    const sa = sessaoById.get(a.sessao_id)?.criado_em ?? "";
    const sb_ = sessaoById.get(b.sessao_id)?.criado_em ?? "";
    if (sa !== sb_) return sb_.localeCompare(sa);
    const ka = prodById.get(a.produto_id)?.sku ?? "";
    const kb = prodById.get(b.produto_id)?.sku ?? "";
    return ka.localeCompare(kb, "pt-BR");
  });

  const rows: Cell[][] = [];
  for (const it of itens) {
    const s = sessaoById.get(it.sessao_id);
    if (!s) continue;
    const loja = lojaById.get(s.loja_id);
    const p = prodById.get(it.produto_id);
    rows.push([
      loja?.codigo ?? "",
      s.id.slice(0, 8),
      dataHoraBR(s.criado_em),
      dataHoraBR(s.finalizada_em),
      TIPO_SESSAO[s.tipo] ?? s.tipo,
      STATUS_SESSAO[s.status] ?? s.status,
      p?.sku ?? "",
      p?.nome ?? "",
      Number(it.qtd_teorica),
      Number(it.qtd_contada),
      Number(it.diferenca),
      it.valor_diferenca != null ? Number(it.valor_diferenca) : null,
      STATUS_ITEM[it.status] ?? it.status,
    ]);
  }
  return toCSV(headers, rows);
}
