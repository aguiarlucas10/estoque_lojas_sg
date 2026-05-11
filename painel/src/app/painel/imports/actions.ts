"use server";

import { revalidatePath } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";

export type ApagarResult =
  | { ok: true; movimentos_apagados: number }
  | { ok: false; error: string };

/**
 * Apaga um import e tudo relacionado:
 *  - movimentos em lj_movimentos_estoque com origem_tipo='import_vendas'
 *    apontando para qualquer linha desse import
 *  - as próprias linhas (cascade do import)
 *  - o registro de lj_imports_vendas
 *  - refresh da matview de estoque
 *
 * Aliases criados durante resolução manual de órfãos PERMANECEM, então
 * próximos imports continuam aproveitando o trabalho de resolução.
 */
export async function apagarImportAction(import_id: string): Promise<ApagarResult> {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    return { ok: false, error: "Apenas admin pode apagar imports." };
  }
  if (!import_id) return { ok: false, error: "ID inválido." };

  const sb = getSupabase();

  // Coleta ids das linhas desse import (até 10k em batches)
  const linhaIds: string[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("lj_imports_vendas_linhas")
      .select("id")
      .eq("import_id", import_id)
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: `Erro lendo linhas: ${error.message}` };
    if (!data || data.length === 0) break;
    for (const r of data) linhaIds.push(r.id as string);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Apaga movimentos por origem (em batches pra não estourar URL)
  let movsApagados = 0;
  const BATCH_IDS = 200;
  for (let i = 0; i < linhaIds.length; i += BATCH_IDS) {
    const chunk = linhaIds.slice(i, i + BATCH_IDS);
    const idsCsv = chunk.join(",");
    const { data: deletados, error } = await sb
      .from("lj_movimentos_estoque")
      .delete()
      .eq("origem_tipo", "import_vendas")
      .in("origem_id", chunk)
      .select("id");
    if (error) {
      return { ok: false, error: `Erro apagando movimentos: ${error.message}` };
    }
    movsApagados += deletados?.length ?? 0;
    void idsCsv; // keep var if needed later
  }

  // Apaga o import (cascade apaga lj_imports_vendas_linhas)
  const { error: delErr } = await sb
    .from("lj_imports_vendas")
    .delete()
    .eq("id", import_id);
  if (delErr) return { ok: false, error: `Erro apagando import: ${delErr.message}` };

  await sb.rpc("refresh_estoque_atual");

  revalidatePath("/painel/imports");
  revalidatePath("/painel/estoque", "layout");
  return { ok: true, movimentos_apagados: movsApagados };
}
