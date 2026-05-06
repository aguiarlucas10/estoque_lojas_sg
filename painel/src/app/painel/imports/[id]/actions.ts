"use server";

import { revalidatePath } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { resolverOrfao as resolverLib, ignorarOrfao as ignorarLib } from "@/lib/import-vendas";

export type ActionState = {
  ok: boolean;
  message?: string;
  codigoResolvido?: string;
};

export async function resolverOrfaoAction(input: {
  import_id: string;
  loja_id: string;
  codigo_origem: string;
  produto_id: string;
}): Promise<ActionState> {
  const r = await resolverLib(input);
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath(`/painel/imports/${input.import_id}`);
  revalidatePath("/painel/imports");
  return {
    ok: true,
    message: `${input.codigo_origem}: ${r.aplicadas} linhas resolvidas, ${r.movimentos} movimentos`,
    codigoResolvido: input.codigo_origem,
  };
}

export async function ignorarOrfaoAction(input: {
  import_id: string;
  codigo_origem: string;
}): Promise<ActionState> {
  const r = await ignorarLib(input);
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath(`/painel/imports/${input.import_id}`);
  revalidatePath("/painel/imports");
  return {
    ok: true,
    message: `${input.codigo_origem}: ${r.ignoradas} linhas marcadas como ignoradas`,
    codigoResolvido: input.codigo_origem,
  };
}

export async function buscarProdutos(query: string): Promise<{ id: string; sku: string; nome: string }[]> {
  if (!query || query.trim().length < 2) return [];
  const sb = getSupabase();
  // Busca por SKU (prefix) OU por nome (similaridade trigram via RPC).
  // Para SKU (case-insensitive), o supabase-js suporta `ilike`.
  const q = query.trim();

  const [bySku, byName] = await Promise.all([
    sb
      .from("lj_produtos")
      .select("id, sku, nome")
      .eq("ativo", true)
      .ilike("sku", `${q}%`)
      .limit(5),
    sb.rpc("sugerir_produtos_por_nome", { texto: q, limite: 5 }),
  ]);

  type ProdRow = { id: string; sku: string; nome: string };
  const merged = new Map<string, ProdRow>();
  for (const p of (bySku.data ?? []) as ProdRow[]) {
    merged.set(p.id, p);
  }
  type SugestaoRow = { produto_id: string; sku: string; nome: string; score: number };
  for (const p of (byName.data ?? []) as SugestaoRow[]) {
    if (!merged.has(p.produto_id)) {
      merged.set(p.produto_id, { id: p.produto_id, sku: p.sku, nome: p.nome });
    }
  }
  return Array.from(merged.values()).slice(0, 8);
}
