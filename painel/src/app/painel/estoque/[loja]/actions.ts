"use server";

import { revalidatePath } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";

export type AjusteResult =
  | { ok: true; delta: number; novo_saldo: number }
  | { ok: false; error: string };

/**
 * Ajusta o saldo de um produto numa loja para o valor informado, gerando
 * um movimento `ajuste_manual` com o delta. Preserva auditoria — nao
 * sobrescreve historico.
 *
 * Apenas admin pode chamar. Se nova_qtd === saldo atual, no-op.
 */
export async function ajustarEstoqueAction(input: {
  loja_id: string;
  produto_id: string;
  nova_qtd: number;
  motivo?: string;
}): Promise<AjusteResult> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode ajustar o estoque." };
  }

  if (!Number.isFinite(input.nova_qtd)) {
    return { ok: false, error: "Quantidade inválida." };
  }

  const sb = getSupabase();

  // Saldo atual = sum(qtd) de todos os movimentos da loja+produto
  const { data: movs, error: movErr } = await sb
    .from("lj_movimentos_estoque")
    .select("qtd")
    .eq("loja_id", input.loja_id)
    .eq("produto_id", input.produto_id);
  if (movErr) return { ok: false, error: `Erro lendo saldo: ${movErr.message}` };

  const saldoAtual = (movs ?? []).reduce((acc, m) => acc + Number(m.qtd), 0);
  const delta = input.nova_qtd - saldoAtual;

  if (delta === 0) {
    return { ok: true, delta: 0, novo_saldo: saldoAtual };
  }

  // Pega custo atual do produto pra valorizar o ajuste
  const { data: prod } = await sb
    .from("lj_produtos")
    .select("custo")
    .eq("id", input.produto_id)
    .maybeSingle();
  const custo = prod?.custo != null ? Number(prod.custo) : null;

  const observacao = input.motivo?.trim() || "Ajuste manual via painel";

  const { error: insErr } = await sb.from("lj_movimentos_estoque").insert({
    loja_id: input.loja_id,
    produto_id: input.produto_id,
    tipo: "ajuste_manual",
    qtd: delta,
    custo_unitario: custo,
    data_evento: new Date().toISOString().slice(0, 10),
    origem_tipo: "manual",
    origem_id: null,
    observacao,
  });
  if (insErr) return { ok: false, error: insErr.message };

  await sb.rpc("refresh_estoque_atual");
  revalidatePath(`/painel/estoque/`, "layout");

  return { ok: true, delta, novo_saldo: input.nova_qtd };
}

export type BipagensResult =
  | {
      ok: true;
      sessao: { id: string; finalizada_em: string | null } | null;
      bipagens: { qtd: number; bipado_em: string }[];
    }
  | { ok: false; error: string };

/**
 * Retorna as bipagens individuais de um produto na ultima sessao de contagem
 * finalizada da loja. Usado pelo popover de detalhe na tela de estoque.
 *
 * Pode retornar sessao=null (loja sem contagem finalizada) ou bipagens=[]
 * (produto fora do que foi bipado na ultima contagem). O cliente trata.
 */
export async function getBipagensProdutoAction(
  loja_id: string,
  produto_id: string,
): Promise<BipagensResult> {
  if (!loja_id || !produto_id) {
    return { ok: false, error: "Loja ou produto nao informado." };
  }
  const sb = getSupabase();

  const { data: sessao, error: sErr } = await sb
    .from("lj_sessoes_contagem")
    .select("id, finalizada_em")
    .eq("loja_id", loja_id)
    .eq("status", "finalizada")
    .order("finalizada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sErr) return { ok: false, error: sErr.message };
  if (!sessao) {
    return { ok: true, sessao: null, bipagens: [] };
  }

  const { data: bips, error: bErr } = await sb
    .from("lj_sessoes_bipagens")
    .select("qtd, bipado_em")
    .eq("sessao_id", sessao.id as string)
    .eq("produto_id", produto_id)
    .order("bipado_em", { ascending: true });
  if (bErr) return { ok: false, error: bErr.message };

  return {
    ok: true,
    sessao: {
      id: sessao.id as string,
      finalizada_em: (sessao.finalizada_em as string | null) ?? null,
    },
    bipagens: (bips ?? []).map((b) => ({
      qtd: Number(b.qtd),
      bipado_em: b.bipado_em as string,
    })),
  };
}
