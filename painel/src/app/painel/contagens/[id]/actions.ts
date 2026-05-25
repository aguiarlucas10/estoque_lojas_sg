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

/**
 * Faz balanço da sessão: aprova todos os itens contados (exceto rejeitados
 * pelo admin) e aplica como movimentos no ledger. Único ponto que altera
 * o estoque a partir de uma contagem.
 */
export async function fazerBalancoAction(
  sessao_id: string,
): Promise<{ ok: true; aprovados: number; movimentos: number } | { ok: false; error: string }> {
  const sb = getSupabase();

  // 1. Aprova todos com qtd_contada > 0 e que não foram rejeitados pelo admin
  const { data: aprovadosData, error: aprErr } = await sb
    .from("lj_sessoes_itens")
    .update({ status: "aprovada", aprovado_em: new Date().toISOString() })
    .eq("sessao_id", sessao_id)
    .neq("status", "rejeitada")
    .gt("qtd_contada", 0)
    .select("produto_id");
  if (aprErr) return { ok: false, error: `Erro aprovando itens: ${aprErr.message}` };
  const aprovados = aprovadosData?.length ?? 0;

  // 2. Aplica como movimentos contagem_validada
  const { data, error } = await sb.rpc("aplicar_contagem_validada", {
    p_sessao_id: sessao_id,
  });
  if (error) return { ok: false, error: error.message };

  await sb.rpc("refresh_estoque_atual");
  revalidatePath(`/painel/contagens/${sessao_id}`);
  revalidatePath("/painel/contagens");
  revalidatePath("/painel/estoque", "layout");
  return { ok: true, aprovados, movimentos: Number(data) || 0 };
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

  // Resolve produto: EAN -> SKU -> alias.
  // Filtra ativo=true e usa limit(1) em vez de maybeSingle() pra ser robusto
  // contra duplicação de EAN/SKU no cadastro (que aconteceu por causa de
  // variantes -P15, -SHOPEE, etc. que compartilham o mesmo EAN).
  type ProdutoLite = { id: string; sku: string; nome: string };
  let produto: ProdutoLite | null = null;

  const { data: byEan } = await sb
    .from("lj_produtos")
    .select("id, sku, nome")
    .eq("ean", codigoLimpo)
    .eq("ativo", true)
    .limit(1);
  if (byEan && byEan.length > 0) {
    produto = byEan[0] as unknown as ProdutoLite;
  } else {
    const { data: bySku } = await sb
      .from("lj_produtos")
      .select("id, sku, nome")
      .eq("sku", codigoLimpo)
      .eq("ativo", true)
      .limit(1);
    if (bySku && bySku.length > 0) {
      produto = bySku[0] as unknown as ProdutoLite;
    } else {
      const { data: byAlias } = await sb
        .from("lj_sku_aliases")
        .select("produto_id, lj_produtos(id, sku, nome, ativo)")
        .eq("codigo_alias", codigoLimpo)
        .limit(5);
      if (byAlias && byAlias.length > 0) {
        // Pega o primeiro alias cujo produto está ativo
        for (const a of byAlias) {
          const p = a.lj_produtos as unknown as { id: string; sku: string; nome: string; ativo: boolean } | null;
          if (p && p.ativo) {
            produto = { id: p.id, sku: p.sku, nome: p.nome };
            break;
          }
        }
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

  // Ledger de bipagens: 1 linha por bip individual (bipado_em = now()).
  // Usado depois pelo cruzamento com vendas do PDV (cruzar_vendas_pos_bipagem).
  // Falha de insert nao bloqueia o bip — qtd_contada ja foi atualizado e
  // o ledger eh auditoria; mas registramos no console pra investigar.
  const { error: bipErr } = await sb
    .from("lj_sessoes_bipagens")
    .insert({ sessao_id, produto_id, qtd: qtd_a_adicionar });
  if (bipErr) console.error("falha gravando ledger de bipagem:", bipErr.message);

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

// finalizarContagemAction foi substituída por fazerBalancoAction (acima).
// O comportamento é equivalente: aprovar todos os contados não-rejeitados
// e aplicar como movimentos. fazerBalancoAction não trava mais com itens
// pendentes — assume aprovação implícita do admin ao clicar.
