import "server-only";
import { getSupabase } from "@/lib/supabase";

export type ProdutoMatch = {
  id: string;
  sku: string;
  nome: string;
  custo: number | null;
};

/**
 * Resolve um código (SKU vindo do PDF) contra lj_produtos, tolerando
 * truncamento (PDF do Bling corta SKUs longos). Estratégia:
 *   1. SKU exato (e ativo)
 *   2. Aliases
 *   3. Prefix match (`SKU LIKE 'codigo%'`) entre ativos
 *
 * Retorna até N candidatos. Caller decide se aceita o primeiro ou pede revisão.
 */
export async function resolverSku(codigo: string, max: number = 3): Promise<{
  match: ProdutoMatch | null;
  candidatos: ProdutoMatch[];
}> {
  const sb = getSupabase();
  const cod = codigo.trim().toUpperCase();
  if (!cod) return { match: null, candidatos: [] };

  // 1. Match exato em lj_produtos
  const { data: exato } = await sb
    .from("lj_produtos")
    .select("id, sku, nome, custo")
    .eq("sku", cod)
    .eq("ativo", true)
    .limit(1);
  if (exato && exato.length > 0) {
    const p = exato[0] as ProdutoMatch;
    return { match: p, candidatos: [p] };
  }

  // 2. Match em sku_aliases
  const { data: byAlias } = await sb
    .from("lj_sku_aliases")
    .select("produto_id, lj_produtos(id, sku, nome, custo, ativo)")
    .eq("codigo_alias", cod)
    .limit(1);
  if (byAlias && byAlias.length > 0) {
    const p = byAlias[0].lj_produtos as unknown as
      | (ProdutoMatch & { ativo: boolean })
      | null;
    if (p && p.ativo) {
      const r = { id: p.id, sku: p.sku, nome: p.nome, custo: p.custo };
      return { match: r, candidatos: [r] };
    }
  }

  // 3. Prefix match (PDF Bling trunca SKUs longos)
  const { data: prefix } = await sb
    .from("lj_produtos")
    .select("id, sku, nome, custo")
    .ilike("sku", `${cod}%`)
    .eq("ativo", true)
    .order("sku")
    .limit(max);
  const candidatos = (prefix ?? []) as ProdutoMatch[];
  return {
    match: candidatos.length === 1 ? candidatos[0] : null,
    candidatos,
  };
}

export type CriarRecebimentoInput = {
  loja_codigo: string;
  fornecedor: string | null;
  nf_numero: string | null;
  observacao: string | null;
  itens: { produto_id: string; qtd: number; custo_unitario: number }[];
};

export type CriarRecebimentoResult =
  | { ok: true; recebimento_id: string; total_itens: number; total_valor: number }
  | { ok: false; error: string };

export async function criarRecebimento(
  input: CriarRecebimentoInput,
): Promise<CriarRecebimentoResult> {
  if (input.itens.length === 0) {
    return { ok: false, error: "Recebimento precisa ter pelo menos 1 item." };
  }
  for (const i of input.itens) {
    if (!Number.isFinite(i.qtd) || i.qtd <= 0) {
      return { ok: false, error: "Quantidade inválida em algum item." };
    }
    if (!Number.isFinite(i.custo_unitario) || i.custo_unitario < 0) {
      return { ok: false, error: "Custo unitário inválido em algum item." };
    }
  }

  const sb = getSupabase();
  const { data: lojaRow } = await sb
    .from("lj_lojas")
    .select("id")
    .eq("codigo", input.loja_codigo.toUpperCase())
    .maybeSingle();
  if (!lojaRow) return { ok: false, error: `Loja ${input.loja_codigo} não encontrada.` };

  const total_valor = input.itens.reduce(
    (acc, i) => acc + i.qtd * i.custo_unitario,
    0,
  );

  const { data: receb, error: recebErr } = await sb
    .from("lj_recebimentos")
    .insert({
      loja_id: lojaRow.id,
      fornecedor: input.fornecedor,
      nf_numero: input.nf_numero,
      data_recebimento: new Date().toISOString().slice(0, 10),
      total_itens: input.itens.length,
      total_valor: Math.round(total_valor * 100) / 100,
      observacao: input.observacao,
    })
    .select("id")
    .single();
  if (recebErr || !receb) {
    return { ok: false, error: `Erro criando recebimento: ${recebErr?.message}` };
  }
  const recebimento_id = receb.id as string;

  // Insere itens em batch — trigger gera os movimentos automaticamente
  const linhas = input.itens.map((i) => ({
    recebimento_id,
    produto_id: i.produto_id,
    qtd: i.qtd,
    custo_unitario: Math.round(i.custo_unitario * 100) / 100,
  }));
  const { error: itensErr } = await sb.from("lj_recebimentos_itens").insert(linhas);
  if (itensErr) {
    // Limpa recebimento órfão
    await sb.from("lj_recebimentos").delete().eq("id", recebimento_id);
    return { ok: false, error: `Erro inserindo itens: ${itensErr.message}` };
  }

  await sb.rpc("refresh_estoque_atual");
  return {
    ok: true,
    recebimento_id,
    total_itens: input.itens.length,
    total_valor,
  };
}
