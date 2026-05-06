"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";

export type NovaContagemState = { error: string } | null;

type ProdutoBasico = { id: string; categoria: string | null };

async function fetchProdutosAtivos(opts: {
  categoria?: string | null;
}): Promise<ProdutoBasico[]> {
  const sb = getSupabase();
  const out: ProdutoBasico[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    let q = sb.from("lj_produtos").select("id, categoria").eq("ativo", true);
    if (opts.categoria) q = q.eq("categoria", opts.categoria);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const p of data) {
      out.push({ id: p.id as string, categoria: (p.categoria as string | null) ?? null });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function fetchSaldosLoja(loja_id: string, produto_ids: string[]): Promise<Map<string, number>> {
  const sb = getSupabase();
  const saldos = new Map<string, number>();
  const CHUNK = 200;
  for (let i = 0; i < produto_ids.length; i += CHUNK) {
    const chunk = produto_ids.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("lj_estoque_atual")
      .select("produto_id, quantidade")
      .eq("loja_id", loja_id)
      .in("produto_id", chunk);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      saldos.set(r.produto_id as string, Number(r.quantidade));
    }
  }
  return saldos;
}

export async function criarContagem(
  _prev: NovaContagemState,
  formData: FormData,
): Promise<NovaContagemState> {
  const loja_codigo = formData.get("loja_codigo") as string | null;
  const tipo = formData.get("tipo") as string | null;
  const metodo = formData.get("metodo") as string | null;
  const categoria = formData.get("categoria") as string | null;
  const nRaw = formData.get("n") as string | null;

  if (!loja_codigo || !tipo) return { error: "Selecione a loja e o tipo." };
  if (tipo !== "geral" && tipo !== "amostragem") return { error: "Tipo inválido." };

  // Usuario de loja so cria pra propria
  const scope = await getLojaScope();
  if (scope.tipo === "loja" && scope.codigo.toUpperCase() !== loja_codigo.toUpperCase()) {
    return { error: "Você não tem permissão para essa loja." };
  }

  const sb = getSupabase();
  const { data: lojaRow } = await sb
    .from("lj_lojas")
    .select("id")
    .eq("codigo", loja_codigo.toUpperCase())
    .maybeSingle();
  if (!lojaRow) return { error: `Loja ${loja_codigo} não encontrada.` };
  const loja_id = lojaRow.id as string;

  // 1. Define escopo de produtos (sem filtro de saldo — a contagem deve sempre
  //    ser possivel, especialmente a 1a geral que estabelece o saldo inicial).
  let produtos: ProdutoBasico[];
  let escopo: Record<string, unknown>;

  try {
    if (tipo === "geral") {
      produtos = await fetchProdutosAtivos({});
      escopo = { metodo: "geral" };
    } else if (metodo === "categoria") {
      if (!categoria) return { error: "Escolha a categoria." };
      produtos = await fetchProdutosAtivos({ categoria });
      escopo = { metodo: "amostragem_categoria", categoria };
    } else if (metodo === "aleatorio") {
      const n = parseInt(nRaw ?? "0", 10) || 0;
      if (n <= 0) return { error: "Informe um número de SKUs maior que zero." };
      const todos = await fetchProdutosAtivos({});
      // Fisher-Yates parcial
      for (let i = todos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [todos[i], todos[j]] = [todos[j], todos[i]];
      }
      produtos = todos.slice(0, Math.min(n, todos.length));
      escopo = { metodo: "amostragem_aleatorio", n: produtos.length };
    } else {
      return { error: "Método de amostragem inválido." };
    }
  } catch (e) {
    return { error: `Erro carregando produtos: ${(e as Error).message}` };
  }

  if (produtos.length === 0) {
    return { error: "Nenhum produto ativo no escopo selecionado." };
  }

  // 2. Carrega saldos atuais da loja para esses produtos (default 0)
  let saldos: Map<string, number>;
  try {
    saldos = await fetchSaldosLoja(
      loja_id,
      produtos.map((p) => p.id),
    );
  } catch (e) {
    return { error: `Erro carregando saldos: ${(e as Error).message}` };
  }

  // 3. Cria sessão
  const { data: sessao, error: sErr } = await sb
    .from("lj_sessoes_contagem")
    .insert({ loja_id, tipo, status: "aberta", escopo })
    .select("id")
    .single();
  if (sErr || !sessao) return { error: `Erro criando sessão: ${sErr?.message}` };
  const sessao_id = sessao.id as string;

  // 4. Snapshot — qtd_teorica = saldo atual (default 0)
  const itens = produtos.map((p) => ({
    sessao_id,
    produto_id: p.id,
    qtd_teorica: saldos.get(p.id) ?? 0,
    qtd_contada: 0,
    status: "pendente",
  }));
  const BATCH = 500;
  for (let i = 0; i < itens.length; i += BATCH) {
    const { error: iErr } = await sb
      .from("lj_sessoes_itens")
      .insert(itens.slice(i, i + BATCH));
    if (iErr) {
      // limpa sessão em caso de erro pra não deixar lixo
      await sb.from("lj_sessoes_contagem").delete().eq("id", sessao_id);
      return { error: `Erro inserindo snapshot: ${iErr.message}` };
    }
  }

  revalidatePath("/painel/contagens");
  redirect(`/painel/contagens/${sessao_id}`);
}
