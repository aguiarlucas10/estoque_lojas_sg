import "server-only";
import { getSupabase } from "@/lib/supabase";
import { parseCSVPDV, type ParsedRow } from "@/lib/parser-pdv";

export type ImportInput = {
  loja_codigo: string;     // BAL, MOO, GAR, NEU
  inicio: string;          // YYYY-MM-DD
  fim: string;             // YYYY-MM-DD
  arquivo_nome: string;
  registros: ParsedRow[];  // resultado de parseCSVPDV
};

export type ImportResult = {
  ok: true;
  import_id: string;
  loja_id: string;
  aplicados: number;
  orfaos: number;
  ignoradas: number;
  duplicados: number;
  movimentos: number;
  status: "concluido" | "aguardando_resolucao";
} | {
  ok: false;
  error: string;
  duplicados?: { id: string; status: string; importado_em: string }[];
};

const BATCH_INSERT = 200;

/**
 * Recalcula contadores e status de um import a partir das linhas reais.
 * Chamado depois de criar/resolver/ignorar para manter consistencia.
 */
async function recalcularImport(import_id: string): Promise<void> {
  const sb = getSupabase();
  const { data: linhas } = await sb
    .from("lj_imports_vendas_linhas")
    .select("codigo_origem, status")
    .eq("import_id", import_id);
  const orfaosUnicos = new Set<string>();
  for (const l of linhas ?? []) {
    if ((l.status as string) === "orfao") {
      orfaosUnicos.add(l.codigo_origem as string);
    }
  }
  const novoTotal = orfaosUnicos.size;
  const novoStatus = novoTotal === 0 ? "concluido" : "aguardando_resolucao";
  await sb
    .from("lj_imports_vendas")
    .update({ total_skus_nao_encontrados: novoTotal, status: novoStatus })
    .eq("id", import_id);
}

export async function importVendas(input: ImportInput): Promise<ImportResult> {
  const sb = getSupabase();

  const { data: lojaRow, error: lojaErr } = await sb
    .from("lj_lojas")
    .select("id, nome_pdv")
    .eq("codigo", input.loja_codigo.toUpperCase())
    .maybeSingle();
  if (lojaErr) return { ok: false, error: `Erro buscando loja: ${lojaErr.message}` };
  if (!lojaRow) return { ok: false, error: `Loja '${input.loja_codigo}' nao encontrada` };

  const loja_id = lojaRow.id as string;
  const nome_pdv = lojaRow.nome_pdv as string;

  // Filtra por loja + periodo
  const inicio = input.inicio;
  const fim = input.fim;
  const vendas = input.registros.filter(
    (r) => r.loja_pdv === nome_pdv && r.data && r.data >= inicio && r.data <= fim,
  );

  // Dedup contra reimport
  const { data: previos } = await sb
    .from("lj_imports_vendas")
    .select("id, status, importado_em")
    .eq("loja_id", loja_id)
    .eq("periodo_inicio", inicio)
    .eq("periodo_fim", fim);
  if (previos && previos.length > 0) {
    return {
      ok: false,
      error: `Ja existe import para essa loja/periodo. Apague antes de re-importar.`,
      duplicados: previos.map((p) => ({
        id: p.id as string,
        status: p.status as string,
        importado_em: p.importado_em as string,
      })),
    };
  }

  // Carrega lookups
  const { data: produtos } = await sb.from("lj_produtos").select("id, sku, ean");
  const sku_to_id = new Map<string, string>();
  const ean_to_id = new Map<string, string>();
  for (const p of produtos ?? []) {
    sku_to_id.set(p.sku as string, p.id as string);
    if (p.ean) ean_to_id.set(p.ean as string, p.id as string);
  }
  const { data: aliases } = await sb.from("lj_sku_aliases").select("codigo_alias, produto_id");
  const alias_to_id = new Map<string, string>();
  for (const a of aliases ?? []) {
    alias_to_id.set(a.codigo_alias as string, a.produto_id as string);
  }

  // Docs ja aplicados em imports anteriores desta loja (dedup por doc)
  const { data: docsRows, error: docsErr } = await sb.rpc("docs_aplicados_da_loja", {
    p_loja_id: loja_id,
  });
  if (docsErr) return { ok: false, error: `Erro carregando docs aplicados: ${docsErr.message}` };
  const docsJaAplicados = new Set<string>(
    (docsRows ?? []).map((r: { doc_pdv: string }) => r.doc_pdv),
  );

  // Cria registro de import
  const n_vendas = vendas.filter((v) => v.operacao === "Venda").length;
  const n_trocas = vendas.filter((v) => v.operacao === "Troca").length;
  const { data: importInsert, error: importErr } = await sb
    .from("lj_imports_vendas")
    .insert({
      loja_id,
      fonte: "pdv_analitico",
      periodo_inicio: inicio,
      periodo_fim: fim,
      arquivo_nome: input.arquivo_nome,
      total_linhas: vendas.length,
      total_vendas: n_vendas,
      total_trocas: n_trocas,
      total_skus_nao_encontrados: 0,
      status: "processando",
    })
    .select("id")
    .single();
  if (importErr || !importInsert) {
    return { ok: false, error: `Erro criando import: ${importErr?.message}` };
  }
  const import_id = importInsert.id as string;

  // Classifica linhas: aplicado / orfao / ignorado
  type LinhaParaInserir = {
    import_id: string;
    codigo_origem: string;
    descricao_origem: string | null;
    produto_id: string | null;
    doc_pdv: string | null;
    data_venda: string;
    hora_venda: string | null;
    vendedor: string | null;
    qtd: number;
    operacao: "Venda" | "Troca";
    preco_praticado: number | null;
    preco_tabela: number | null;
    status: "aplicado" | "orfao" | "ignorado" | "duplicado_doc";
  };

  const linhas: LinhaParaInserir[] = [];
  let aplicados = 0;
  let orfaos = 0;
  let ignoradas = 0;
  let duplicados = 0;
  for (const v of vendas) {
    const cod = v.codigo_origem;
    const produto_id = sku_to_id.get(cod) ?? ean_to_id.get(cod) ?? alias_to_id.get(cod) ?? null;
    const isVenda = v.operacao === "Venda" && (v.qtd ?? 0) > 0;
    let status: "aplicado" | "orfao" | "ignorado" | "duplicado_doc";
    if (v.doc && docsJaAplicados.has(v.doc)) {
      // Doc ja existente nesta loja: duplicacao integral. Nao gera movimento.
      status = "duplicado_doc";
      duplicados++;
    } else if (produto_id === null) {
      status = "orfao";
      orfaos++;
    } else if (!isVenda) {
      status = "ignorado";
      ignoradas++;
    } else {
      status = "aplicado";
      aplicados++;
    }
    linhas.push({
      import_id,
      codigo_origem: cod,
      descricao_origem: v.descricao_origem,
      produto_id,
      doc_pdv: v.doc,
      data_venda: v.data!,
      hora_venda: v.hora,
      vendedor: v.vendedor,
      qtd: v.qtd ?? 0,
      operacao: v.operacao,
      preco_praticado: v.preco_praticado,
      preco_tabela: v.preco_tabela,
      status,
    });
  }

  // Insere linhas em batches (capturando IDs para gerar movimentos)
  const linhasInseridas: { id: string; produto_id: string | null; data_venda: string; qtd: number; status: string; operacao: string }[] = [];
  for (let i = 0; i < linhas.length; i += BATCH_INSERT) {
    const chunk = linhas.slice(i, i + BATCH_INSERT);
    const { data, error } = await sb
      .from("lj_imports_vendas_linhas")
      .insert(chunk)
      .select("id, produto_id, data_venda, qtd, status, operacao");
    if (error) {
      return { ok: false, error: `Erro inserindo linhas: ${error.message}` };
    }
    for (const r of data ?? []) {
      linhasInseridas.push({
        id: r.id as string,
        produto_id: r.produto_id as string | null,
        data_venda: r.data_venda as string,
        qtd: Number(r.qtd),
        status: r.status as string,
        operacao: r.operacao as string,
      });
    }
  }

  // Gera movimentos para vendas aplicadas
  const movimentos = linhasInseridas
    .filter((l) => l.status === "aplicado" && l.operacao === "Venda" && l.qtd > 0 && l.produto_id)
    .map((l) => ({
      loja_id,
      produto_id: l.produto_id!,
      tipo: "venda",
      qtd: -l.qtd,
      custo_unitario: null,
      data_evento: l.data_venda,
      origem_tipo: "import_vendas",
      origem_id: l.id,
    }));
  for (let i = 0; i < movimentos.length; i += BATCH_INSERT) {
    const chunk = movimentos.slice(i, i + BATCH_INSERT);
    const { error } = await sb.from("lj_movimentos_estoque").insert(chunk);
    if (error) {
      return { ok: false, error: `Erro inserindo movimentos: ${error.message}` };
    }
  }

  await recalcularImport(import_id);
  const { data: impFinal } = await sb
    .from("lj_imports_vendas")
    .select("status")
    .eq("id", import_id)
    .single();
  const status_final = (impFinal?.status as "concluido" | "aguardando_resolucao") ??
    (orfaos === 0 ? "concluido" : "aguardando_resolucao");

  await sb.rpc("refresh_estoque_atual");

  return {
    ok: true,
    import_id,
    loja_id,
    aplicados,
    orfaos,
    ignoradas,
    duplicados,
    movimentos: movimentos.length,
    status: status_final,
  };
}

/**
 * Recebe so o conteudo do CSV. Detecta periodo e lojas presentes
 * automaticamente, e cria 1 import por loja existente no cadastro.
 */
export type LojaImportEntry = {
  loja_codigo: string;
  loja_nome: string;
  result: ImportResult;
};

export type ImportCSVResult =
  | {
      ok: true;
      periodo: { inicio: string; fim: string };
      total_registros: number;
      imports: LojaImportEntry[];
      lojas_nao_mapeadas: string[]; // nome_pdv presentes no CSV mas sem cadastro
    }
  | { ok: false; error: string };

export async function importCSVCompleto(input: {
  arquivo_nome: string;
  content: Buffer | string;
  /** Se setado, restringe import as lojas com esse codigo (usuario de loja). */
  loja_codigo?: string | null;
}): Promise<ImportCSVResult> {
  let registros: ParsedRow[];
  let periodo: { inicio: string; fim: string } | null;
  try {
    const parsed = parseCSVPDV(input.content);
    registros = parsed.registros;
    periodo = parsed.periodo;
  } catch (e) {
    return { ok: false, error: `Erro parseando CSV: ${(e as Error).message}` };
  }
  if (registros.length === 0) {
    return { ok: false, error: "Nenhum registro encontrado no CSV — formato inesperado?" };
  }
  if (!periodo) {
    return { ok: false, error: "Nao foi possivel determinar o periodo do CSV." };
  }

  const sb = getSupabase();
  const { data: lojas, error: lojasErr } = await sb
    .from("lj_lojas")
    .select("codigo, nome, nome_pdv")
    .eq("ativa", true);
  if (lojasErr) return { ok: false, error: `Erro carregando lojas: ${lojasErr.message}` };

  // Mapeia nome_pdv → loja
  const pdvToLoja = new Map<string, { codigo: string; nome: string }>();
  for (const l of lojas ?? []) {
    if (l.nome_pdv) pdvToLoja.set(l.nome_pdv as string, {
      codigo: l.codigo as string,
      nome: l.nome as string,
    });
  }

  // Detecta lojas presentes no CSV
  const lojasNoCSV = new Set(registros.map((r) => r.loja_pdv));
  const lojasMapeadas: { codigo: string; nome: string }[] = [];
  const lojasNaoMapeadas: string[] = [];
  const restrictTo = input.loja_codigo?.toUpperCase() ?? null;
  for (const nomePdv of lojasNoCSV) {
    const m = pdvToLoja.get(nomePdv);
    if (m) {
      if (!restrictTo || m.codigo.toUpperCase() === restrictTo) {
        lojasMapeadas.push(m);
      }
      // se restritro e nao bate: ignora silenciosamente (loja fora do escopo do user)
    } else {
      lojasNaoMapeadas.push(nomePdv);
    }
  }

  // Faz 1 import por loja mapeada
  const imports: LojaImportEntry[] = [];
  for (const l of lojasMapeadas) {
    const result = await importVendas({
      loja_codigo: l.codigo,
      inicio: periodo.inicio,
      fim: periodo.fim,
      arquivo_nome: input.arquivo_nome,
      registros,
    });
    imports.push({ loja_codigo: l.codigo, loja_nome: l.nome, result });
  }

  return {
    ok: true,
    periodo,
    total_registros: registros.length,
    imports,
    lojas_nao_mapeadas: lojasNaoMapeadas,
  };
}

/**
 * Resolve um codigo orfao (cria alias + atualiza linhas + gera movimentos).
 * Tambem incrementa o status do import se zerou os orfaos.
 */
export async function resolverOrfao(opts: {
  import_id: string;
  loja_id: string;
  codigo_origem: string;
  produto_id: string;
}): Promise<{ ok: true; aplicadas: number; movimentos: number } | { ok: false; error: string }> {
  const sb = getSupabase();

  // Cria alias (idempotente: ignore conflict)
  const { error: aliasErr } = await sb
    .from("lj_sku_aliases")
    .upsert({
      produto_id: opts.produto_id,
      codigo_alias: opts.codigo_origem,
      origem: "pdv_legado",
    }, { onConflict: "codigo_alias,origem", ignoreDuplicates: true });
  if (aliasErr) return { ok: false, error: `Erro criando alias: ${aliasErr.message}` };

  // Pega linhas orfas com esse codigo no import
  const { data: linhas, error: linhasErr } = await sb
    .from("lj_imports_vendas_linhas")
    .select("id, qtd, operacao, data_venda")
    .eq("import_id", opts.import_id)
    .eq("codigo_origem", opts.codigo_origem)
    .eq("status", "orfao");
  if (linhasErr) return { ok: false, error: linhasErr.message };

  if (!linhas || linhas.length === 0) {
    return { ok: true, aplicadas: 0, movimentos: 0 };
  }

  // Marca como resolvido e ja aponta o produto
  const ids = linhas.map((l) => l.id as string);
  const { error: updErr } = await sb
    .from("lj_imports_vendas_linhas")
    .update({ status: "resolvido_manualmente", produto_id: opts.produto_id })
    .in("id", ids);
  if (updErr) return { ok: false, error: updErr.message };

  // Gera movimentos para vendas reais
  const movs = linhas
    .filter((l) => l.operacao === "Venda" && Number(l.qtd) > 0)
    .map((l) => ({
      loja_id: opts.loja_id,
      produto_id: opts.produto_id,
      tipo: "venda",
      qtd: -Number(l.qtd),
      custo_unitario: null,
      data_evento: l.data_venda,
      origem_tipo: "import_vendas",
      origem_id: l.id,
    }));
  if (movs.length > 0) {
    const { error: movErr } = await sb.from("lj_movimentos_estoque").insert(movs);
    if (movErr) return { ok: false, error: movErr.message };
  }

  await recalcularImport(opts.import_id);
  await sb.rpc("refresh_estoque_atual");

  return { ok: true, aplicadas: linhas.length, movimentos: movs.length };
}

/**
 * Marca um codigo orfao como ignorado em todas as linhas do import.
 * Nao cria alias nem movimento.
 */
export async function ignorarOrfao(opts: {
  import_id: string;
  codigo_origem: string;
}): Promise<{ ok: true; ignoradas: number } | { ok: false; error: string }> {
  const sb = getSupabase();
  const { data: linhas, error } = await sb
    .from("lj_imports_vendas_linhas")
    .update({ status: "ignorado" })
    .eq("import_id", opts.import_id)
    .eq("codigo_origem", opts.codigo_origem)
    .eq("status", "orfao")
    .select("id");
  if (error) return { ok: false, error: error.message };

  await recalcularImport(opts.import_id);

  return { ok: true, ignoradas: linhas?.length ?? 0 };
}
