"use server";

import { revalidatePath } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";

export const CATEGORIAS_VALIDAS = [
  "Relógio",
  "Óculos de Sol",
  "Óculos de Grau",
  "Semijoias",
  "Embalagem",
] as const;

export type CategoriaProduto = (typeof CATEGORIAS_VALIDAS)[number];

export type ProdutoInput = {
  sku: string;
  ean: string | null;
  nome: string;
  categoria: string | null;
  subcategoria: string | null;
  custo: number | null;
  preco_venda: number | null;
  ativo: boolean;
};

export type ProdutoActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function normalize(input: ProdutoInput) {
  const sku = input.sku.trim();
  const nome = input.nome.trim();
  const ean = input.ean?.trim() || null;
  const categoria = input.categoria?.trim() || null;
  const subcategoria = input.subcategoria?.trim() || null;
  return { sku, nome, ean, categoria, subcategoria };
}

function validar(input: ProdutoInput): string | null {
  const { sku, nome } = normalize(input);
  if (!sku) return "SKU é obrigatório.";
  if (sku.length > 64) return "SKU muito longo (máx. 64 caracteres).";
  if (!nome) return "Nome é obrigatório.";
  if (nome.length > 240) return "Nome muito longo (máx. 240 caracteres).";
  if (input.custo != null && (!Number.isFinite(input.custo) || input.custo < 0)) {
    return "Custo inválido.";
  }
  if (
    input.preco_venda != null &&
    (!Number.isFinite(input.preco_venda) || input.preco_venda < 0)
  ) {
    return "Preço de venda inválido.";
  }
  if (
    input.categoria &&
    !(CATEGORIAS_VALIDAS as readonly string[]).includes(input.categoria)
  ) {
    return "Categoria inválida.";
  }
  return null;
}

export async function criarProdutoAction(
  input: ProdutoInput,
): Promise<ProdutoActionResult> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode cadastrar produtos." };
  }

  const erro = validar(input);
  if (erro) return { ok: false, error: erro };

  const { sku, nome, ean, categoria, subcategoria } = normalize(input);
  const sb = getSupabase();

  const { data: existente } = await sb
    .from("lj_produtos")
    .select("id, sku")
    .eq("sku", sku)
    .maybeSingle();
  if (existente) {
    return { ok: false, error: `SKU "${sku}" já está cadastrado.` };
  }

  const { data, error } = await sb
    .from("lj_produtos")
    .insert({
      sku,
      nome,
      ean,
      categoria,
      subcategoria,
      custo: input.custo,
      preco_venda: input.preco_venda,
      ativo: input.ativo,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Falha ao salvar produto." };
  }

  revalidatePath("/painel/produtos");
  return { ok: true, id: data.id as string };
}

export async function editarProdutoAction(
  produto_id: string,
  input: ProdutoInput,
): Promise<ProdutoActionResult> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode editar produtos." };
  }
  if (!produto_id) return { ok: false, error: "Produto não informado." };

  const erro = validar(input);
  if (erro) return { ok: false, error: erro };

  const { sku, nome, ean, categoria, subcategoria } = normalize(input);
  const sb = getSupabase();

  const { data: conflito } = await sb
    .from("lj_produtos")
    .select("id")
    .eq("sku", sku)
    .neq("id", produto_id)
    .maybeSingle();
  if (conflito) {
    return { ok: false, error: `SKU "${sku}" já pertence a outro produto.` };
  }

  const { error } = await sb
    .from("lj_produtos")
    .update({
      sku,
      nome,
      ean,
      categoria,
      subcategoria,
      custo: input.custo,
      preco_venda: input.preco_venda,
      ativo: input.ativo,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", produto_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/painel/produtos");
  return { ok: true, id: produto_id };
}
