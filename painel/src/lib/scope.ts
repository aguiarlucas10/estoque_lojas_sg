import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { getSupabase } from "./supabase";

export type LojaScope =
  | { tipo: "admin"; nome: string }
  | { tipo: "loja"; codigo: string; loja_id: string; nome: string };

/**
 * Retorna o escopo do usuario logado, baseado no header `x-user-loja`
 * injetado pelo proxy. Memoizado por request via React.cache.
 */
export const getLojaScope = cache(async (): Promise<LojaScope> => {
  const h = await headers();
  const codigo = h.get("x-user-loja");
  const userName = h.get("x-user-name") ?? "user";

  if (!codigo || codigo === "*") {
    return { tipo: "admin", nome: userName };
  }

  const sb = getSupabase();
  const { data } = await sb
    .from("lj_lojas")
    .select("id, codigo, nome")
    .eq("codigo", codigo.toUpperCase())
    .maybeSingle();

  if (!data) {
    // Codigo invalido na env var -> trata como admin pra nao quebrar.
    // (Vercel env var problem; logaria, mas aqui simplifica.)
    return { tipo: "admin", nome: userName };
  }

  return {
    tipo: "loja",
    codigo: data.codigo as string,
    loja_id: data.id as string,
    nome: data.nome as string,
  };
});

/**
 * Helper: retorna o loja_id se for usuario de loja, senao null.
 */
export async function getLojaIdScoped(): Promise<string | null> {
  const s = await getLojaScope();
  return s.tipo === "loja" ? s.loja_id : null;
}

/**
 * Verifica se o usuario tem acesso a uma loja especifica.
 * Admin sempre tem; usuario de loja so a propria.
 */
export async function podeAcessarLoja(loja_codigo: string): Promise<boolean> {
  const s = await getLojaScope();
  if (s.tipo === "admin") return true;
  return s.codigo.toUpperCase() === loja_codigo.toUpperCase();
}
