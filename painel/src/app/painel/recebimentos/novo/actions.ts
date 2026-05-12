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
    // Mostra preview do texto extraído pra ajudar a diagnosticar formato inesperado
    const preview = parsed.texto_bruto.slice(0, 800).replace(/\s+/g, " ").trim();
    return {
      ok: false,
      error:
        `Nenhum item detectado no PDF. Texto extraído (preview): "${preview}${parsed.texto_bruto.length > 800 ? "…" : ""}"`,
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

export type ResolverProdutoResult =
  | {
      ok: true;
      // null quando não houve match único; candidatos vem populado com até 5
      produto: { id: string; sku: string; nome: string; custo: number | null } | null;
      candidatos: { id: string; sku: string; nome: string; custo: number | null }[];
    }
  | { ok: false; error: string };

/**
 * Resolve um código (SKU/EAN/alias) e retorna o produto correspondente.
 * Usado no lançamento manual de recebimento — admin bipa um EAN ou digita
 * SKU e o sistema busca em lj_produtos / lj_sku_aliases.
 */
export async function resolverProdutoAction(codigo: string): Promise<ResolverProdutoResult> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode criar recebimentos." };
  }
  if (!codigo.trim()) return { ok: false, error: "Código vazio." };

  const sb = (await import("@/lib/supabase")).getSupabase();
  const cod = codigo.trim().toUpperCase();

  // 1. SKU exato
  const { data: bySku } = await sb
    .from("lj_produtos")
    .select("id, sku, nome, custo")
    .eq("sku", cod)
    .eq("ativo", true)
    .limit(1);
  if (bySku && bySku.length > 0) {
    return { ok: true, produto: bySku[0] as ResolverProdutoResult extends { ok: true; produto: infer P } ? P : never, candidatos: bySku as { id: string; sku: string; nome: string; custo: number | null }[] };
  }

  // 2. EAN exato
  const { data: byEan } = await sb
    .from("lj_produtos")
    .select("id, sku, nome, custo")
    .eq("ean", codigo.trim())
    .eq("ativo", true)
    .limit(1);
  if (byEan && byEan.length > 0) {
    const p = byEan[0] as { id: string; sku: string; nome: string; custo: number | null };
    return { ok: true, produto: p, candidatos: [p] };
  }

  // 3. Alias
  const { data: byAlias } = await sb
    .from("lj_sku_aliases")
    .select("produto_id, lj_produtos(id, sku, nome, custo, ativo)")
    .eq("codigo_alias", cod)
    .limit(1);
  if (byAlias && byAlias.length > 0) {
    const p = byAlias[0].lj_produtos as unknown as
      | { id: string; sku: string; nome: string; custo: number | null; ativo: boolean }
      | null;
    if (p && p.ativo) {
      const r = { id: p.id, sku: p.sku, nome: p.nome, custo: p.custo };
      return { ok: true, produto: r, candidatos: [r] };
    }
  }

  // 4. Prefix match em SKU (Bling trunca SKUs longos)
  const { data: prefix } = await sb
    .from("lj_produtos")
    .select("id, sku, nome, custo")
    .ilike("sku", `${cod}%`)
    .eq("ativo", true)
    .order("sku")
    .limit(5);
  const candidatos = (prefix ?? []) as { id: string; sku: string; nome: string; custo: number | null }[];
  return {
    ok: true,
    produto: candidatos.length === 1 ? candidatos[0] : null,
    candidatos,
  };
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
