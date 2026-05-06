"use server";

import { revalidatePath } from "next/cache";
import { getSupabase } from "@/lib/supabase";

type Result = { ok: true } | { ok: false; error: string };

async function setStatusSessao(
  sessao_id: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<Result> {
  const sb = getSupabase();
  const { error } = await sb
    .from("lj_sessoes_contagem")
    .update({ status, ...extra })
    .eq("id", sessao_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/painel/contagens/${sessao_id}`);
  revalidatePath("/painel/contagens");
  return { ok: true };
}

export async function iniciarContagemAction(sessao_id: string): Promise<Result> {
  return setStatusSessao(sessao_id, "em_contagem", {
    iniciada_em: new Date().toISOString(),
  });
}

export async function encerrarContagemAction(sessao_id: string): Promise<Result> {
  return setStatusSessao(sessao_id, "em_revisao");
}

export async function reabrirContagemAction(sessao_id: string): Promise<Result> {
  return setStatusSessao(sessao_id, "em_contagem");
}

export async function cancelarContagemAction(sessao_id: string): Promise<Result> {
  return setStatusSessao(sessao_id, "cancelada", {
    finalizada_em: new Date().toISOString(),
  });
}

export async function salvarQuantidadesAction(
  sessao_id: string,
  quantidades: { produto_id: string; qtd_contada: number }[],
): Promise<Result> {
  const sb = getSupabase();
  // Upserts em batches
  const BATCH = 100;
  for (let i = 0; i < quantidades.length; i += BATCH) {
    const chunk = quantidades.slice(i, i + BATCH);
    for (const q of chunk) {
      const { error } = await sb
        .from("lj_sessoes_itens")
        .update({ qtd_contada: q.qtd_contada })
        .eq("sessao_id", sessao_id)
        .eq("produto_id", q.produto_id);
      if (error) return { ok: false, error: error.message };
    }
  }
  revalidatePath(`/painel/contagens/${sessao_id}`);
  return { ok: true };
}

export async function definirStatusItemAction(
  sessao_id: string,
  produto_id: string,
  status: "pendente" | "aprovada" | "rejeitada" | "recontar",
): Promise<Result> {
  const sb = getSupabase();
  const patch: Record<string, unknown> = { status };
  if (status === "aprovada" || status === "rejeitada") {
    patch.aprovado_em = new Date().toISOString();
  } else {
    patch.aprovado_em = null;
  }
  const { error } = await sb
    .from("lj_sessoes_itens")
    .update(patch)
    .eq("sessao_id", sessao_id)
    .eq("produto_id", produto_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/painel/contagens/${sessao_id}`);
  return { ok: true };
}

export async function aprovarTodosAction(sessao_id: string): Promise<Result> {
  const sb = getSupabase();
  // Aprova somente itens efetivamente contados (qtd_contada > 0).
  // SKUs do escopo nao bipados ficam pendentes — nao geram movimento.
  const { error } = await sb
    .from("lj_sessoes_itens")
    .update({ status: "aprovada", aprovado_em: new Date().toISOString() })
    .eq("sessao_id", sessao_id)
    .neq("status", "rejeitada")
    .gt("qtd_contada", 0);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/painel/contagens/${sessao_id}`);
  return { ok: true };
}

export type BipResult =
  | {
      ok: true;
      produto_id: string;
      sku: string;
      nome: string;
      qtd_contada: number;
    }
  | { ok: false; error: string };

/**
 * Bipa um codigo no modo contagem. Resolve por EAN -> SKU -> alias.
 * Incrementa qtd_contada em qtd_a_adicionar (default 1) na sessao.
 * Falha se: codigo nao encontrado, produto fora do escopo, sessao nao em_contagem.
 */
export async function biparAction(
  sessao_id: string,
  codigo: string,
  qtd_a_adicionar: number = 1,
): Promise<BipResult> {
  // SKUs e aliases sao gravados em caixa alta no cadastro; normalizamos
  // a entrada pra que digitacao manual em minuscula tambem funcione.
  // Numeros e EANs nao sao afetados por toUpperCase().
  const codigoLimpo = codigo.trim().toUpperCase();
  if (!codigoLimpo) return { ok: false, error: "Código vazio." };
  if (qtd_a_adicionar <= 0) return { ok: false, error: "Quantidade deve ser positiva." };

  const sb = getSupabase();

  // Verifica status da sessao
  const { data: sess } = await sb
    .from("lj_sessoes_contagem")
    .select("status")
    .eq("id", sessao_id)
    .maybeSingle();
  if (!sess) return { ok: false, error: "Sessão não encontrada." };
  if (sess.status !== "em_contagem") {
    return { ok: false, error: "Sessão não está em contagem." };
  }

  // Resolve produto: EAN -> SKU -> alias
  type ProdutoLite = { id: string; sku: string; nome: string };
  let produto: ProdutoLite | null = null;

  const { data: byEan } = await sb
    .from("lj_produtos")
    .select("id, sku, nome")
    .eq("ean", codigoLimpo)
    .maybeSingle();
  if (byEan) {
    produto = byEan as unknown as ProdutoLite;
  } else {
    const { data: bySku } = await sb
      .from("lj_produtos")
      .select("id, sku, nome")
      .eq("sku", codigoLimpo)
      .maybeSingle();
    if (bySku) {
      produto = bySku as unknown as ProdutoLite;
    } else {
      const { data: byAlias } = await sb
        .from("lj_sku_aliases")
        .select("produto_id, lj_produtos(id, sku, nome)")
        .eq("codigo_alias", codigoLimpo)
        .maybeSingle();
      if (byAlias) {
        const p = byAlias.lj_produtos as unknown as ProdutoLite | null;
        if (p) produto = p;
      }
    }
  }
  const produto_id = produto?.id ?? null;

  if (!produto || !produto_id) {
    return { ok: false, error: `Código "${codigoLimpo}" não encontrado.` };
  }

  // Verifica escopo (produto está em lj_sessoes_itens)
  const { data: item } = await sb
    .from("lj_sessoes_itens")
    .select("qtd_contada")
    .eq("sessao_id", sessao_id)
    .eq("produto_id", produto_id)
    .maybeSingle();
  if (!item) {
    return {
      ok: false,
      error: `${produto.sku} (${produto.nome}) está fora do escopo desta sessão.`,
    };
  }

  const novaQtd = Number(item.qtd_contada) + qtd_a_adicionar;
  const { error: upErr } = await sb
    .from("lj_sessoes_itens")
    .update({ qtd_contada: novaQtd })
    .eq("sessao_id", sessao_id)
    .eq("produto_id", produto_id);
  if (upErr) return { ok: false, error: upErr.message };

  revalidatePath(`/painel/contagens/${sessao_id}`);
  revalidatePath(`/painel/contagens/${sessao_id}/contar`);

  return {
    ok: true,
    produto_id,
    sku: produto.sku,
    nome: produto.nome,
    qtd_contada: novaQtd,
  };
}

/**
 * Edita a qtd_contada de uma linha. Usado no modo contagem para corrigir
 * erro de leitura ou remover (qtd=0).
 */
export async function editarQuantidadeAction(
  sessao_id: string,
  produto_id: string,
  qtd_contada: number,
): Promise<Result> {
  if (qtd_contada < 0) return { ok: false, error: "Quantidade não pode ser negativa." };
  const sb = getSupabase();
  const { error } = await sb
    .from("lj_sessoes_itens")
    .update({ qtd_contada })
    .eq("sessao_id", sessao_id)
    .eq("produto_id", produto_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/painel/contagens/${sessao_id}/contar`);
  revalidatePath(`/painel/contagens/${sessao_id}`);
  return { ok: true };
}

export async function finalizarContagemAction(
  sessao_id: string,
): Promise<{ ok: true; movimentos: number } | { ok: false; error: string }> {
  const sb = getSupabase();
  // Verifica pendencias somente entre os itens efetivamente contados.
  // SKUs nao bipados nao precisam ser aprovados/rejeitados.
  const { count } = await sb
    .from("lj_sessoes_itens")
    .select("*", { count: "exact", head: true })
    .eq("sessao_id", sessao_id)
    .in("status", ["pendente", "recontar"])
    .gt("qtd_contada", 0);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Existem ${count} item(ns) contado(s) ainda pendentes ou marcados pra recontagem. Aprove ou rejeite todos antes de finalizar.`,
    };
  }
  const { data, error } = await sb.rpc("aplicar_contagem_validada", {
    p_sessao_id: sessao_id,
  });
  if (error) return { ok: false, error: error.message };
  await sb.rpc("refresh_estoque_atual");
  revalidatePath(`/painel/contagens/${sessao_id}`);
  revalidatePath("/painel/contagens");
  revalidatePath("/painel/estoque", "layout");
  return { ok: true, movimentos: Number(data) || 0 };
}
