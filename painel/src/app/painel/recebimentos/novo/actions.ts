"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseRecebimentoPDF } from "@/lib/parser-recebimento-pdf";
import { resolverSku, criarRecebimento, type ProdutoMatch } from "@/lib/recebimentos";
import { getLojaScope } from "@/lib/scope";

export type LinhaPreview = {
  sku_pdv: string;
  descricao: string;
  qtd: number;
  match: ProdutoMatch | null;
  candidatos: ProdutoMatch[];
};

export type PreviewResult =
  | {
      ok: true;
      numero_pedido: string | null;
      cliente: string | null;
      linhas: LinhaPreview[];
      total_unidades: number;
    }
  | { ok: false; error: string };

export async function previewPDFAction(
  _prev: PreviewResult | null,
  formData: FormData,
): Promise<PreviewResult> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode criar recebimentos." };
  }

  const file = formData.get("arquivo") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "Selecione um PDF." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseRecebimentoPDF(buffer);
  } catch (e) {
    return { ok: false, error: `Erro lendo PDF: ${(e as Error).message}` };
  }

  if (parsed.itens.length === 0) {
    return {
      ok: false,
      error:
        "Nenhum item detectado no PDF. Verifique se é um pedido de venda do Bling com formato esperado.",
    };
  }

  const linhas: LinhaPreview[] = await Promise.all(
    parsed.itens.map(async (item) => {
      const r = await resolverSku(item.sku_pdv, 5);
      return {
        sku_pdv: item.sku_pdv,
        descricao: item.descricao,
        qtd: item.qtd,
        match: r.match,
        candidatos: r.candidatos,
      };
    }),
  );

  return {
    ok: true,
    numero_pedido: parsed.numero_pedido,
    cliente: parsed.cliente,
    linhas,
    total_unidades: parsed.total_unidades,
  };
}

export type ConfirmarPayload = {
  loja_codigo: string;
  fornecedor: string | null;
  nf_numero: string | null;
  observacao: string | null;
  itens: { produto_id: string; qtd: number; custo_unitario: number }[];
};

export async function confirmarRecebimentoAction(
  payload: ConfirmarPayload,
): Promise<{ ok: true; recebimento_id: string } | { ok: false; error: string }> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode criar recebimentos." };
  }

  const r = await criarRecebimento(payload);
  if (!r.ok) return r;

  revalidatePath("/painel/recebimentos");
  revalidatePath("/painel/estoque", "layout");
  redirect(`/painel/recebimentos/${r.recebimento_id}`);
}

export async function buscarProdutos(
  query: string,
): Promise<{ id: string; sku: string; nome: string; custo: number | null }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") return [];

  const sb = (await import("@/lib/supabase")).getSupabase();

  const [bySku, byName] = await Promise.all([
    sb
      .from("lj_produtos")
      .select("id, sku, nome, custo")
      .eq("ativo", true)
      .ilike("sku", `${q}%`)
      .limit(8),
    sb
      .from("lj_produtos")
      .select("id, sku, nome, custo")
      .eq("ativo", true)
      .ilike("nome", `%${q}%`)
      .limit(8),
  ]);

  type Row = { id: string; sku: string; nome: string; custo: number | null };
  const merged = new Map<string, Row>();
  for (const p of (bySku.data ?? []) as Row[]) merged.set(p.id, p);
  for (const p of (byName.data ?? []) as Row[]) {
    if (!merged.has(p.id)) merged.set(p.id, p);
  }
  return Array.from(merged.values()).slice(0, 12);
}
