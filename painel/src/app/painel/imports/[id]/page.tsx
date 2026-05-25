import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { OrfaoResolver, type Orfao } from "./OrfaoResolver";
import { dataBR } from "@/lib/format-date";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  processando: "Processando",
  aguardando_resolucao: "Aguardando órfãos",
  concluido: "Concluído",
  erro: "Erro",
};

export default async function ImportDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = getSupabase();

  const { data: imp } = await sb
    .from("lj_imports_vendas")
    .select(`
      id, status, periodo_inicio, periodo_fim, importado_em,
      total_linhas, total_vendas, total_trocas, total_skus_nao_encontrados,
      arquivo_nome,
      loja:lj_lojas(id, codigo, nome)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!imp) notFound();

  const loja = imp.loja as unknown as { id: string; codigo: string; nome: string } | null;
  const scope = await getLojaScope();
  if (scope.tipo === "loja" && loja?.id !== scope.loja_id) notFound();

  const { data: linhas } = await sb
    .from("lj_imports_vendas_linhas")
    .select("status, qtd, operacao")
    .eq("import_id", id);
  const breakdownStatus = (linhas ?? []).reduce<Record<string, number>>((acc, l) => {
    const s = l.status as string;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  // Carrega órfãos agrupados por codigo_origem
  const { data: orfaosLinhas } = await sb
    .from("lj_imports_vendas_linhas")
    .select("codigo_origem, descricao_origem, qtd")
    .eq("import_id", id)
    .eq("status", "orfao");

  type Agg = { descricao_origem: string | null; qtd_aparicoes: number; qtd_total: number };
  const grupos = new Map<string, Agg>();
  for (const l of orfaosLinhas ?? []) {
    const cod = l.codigo_origem as string;
    const desc = l.descricao_origem as string | null;
    const qtd = Number(l.qtd) || 0;
    const cur = grupos.get(cod);
    if (cur) {
      cur.qtd_aparicoes += 1;
      cur.qtd_total += qtd;
      if (!cur.descricao_origem && desc) cur.descricao_origem = desc;
    } else {
      grupos.set(cod, { descricao_origem: desc, qtd_aparicoes: 1, qtd_total: qtd });
    }
  }

  // Para cada órfão, busca top-3 sugestões via RPC (em paralelo)
  const orfaos: Orfao[] = await Promise.all(
    Array.from(grupos.entries()).map(async ([cod, agg]) => {
      const { data: sug } = await sb.rpc("sugerir_produtos_por_nome", {
        texto: agg.descricao_origem ?? cod,
        limite: 3,
      });
      type SugRow = { produto_id: string; sku: string; nome: string; score: number };
      return {
        codigo_origem: cod,
        descricao_origem: agg.descricao_origem,
        qtd_aparicoes: agg.qtd_aparicoes,
        qtd_total: agg.qtd_total,
        sugestoes: ((sug ?? []) as SugRow[]).map((s) => ({
          produto_id: s.produto_id,
          sku: s.sku,
          nome: s.nome,
          score: Number(s.score),
        })),
      };
    }),
  );
  // Ordena por qtd_total desc (mais impacto primeiro)
  orfaos.sort((a, b) => b.qtd_total - a.qtd_total);

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-12">
      <Link
        href="/painel/imports"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para imports
      </Link>

      <div className="flex items-start justify-between gap-6 mb-10">
        <div>
          <p className="caption-uppercase text-muted mb-3">
            {loja?.codigo ?? "—"} · {loja?.nome ?? ""}
          </p>
          <h1 className="display-lg text-ink mb-2">
            Import {dataBR.format(new Date(imp.periodo_inicio as string))} →{" "}
            {dataBR.format(new Date(imp.periodo_fim as string))}
          </h1>
          <p className="text-[14px] text-muted">
            {imp.arquivo_nome as string} · importado em{" "}
            {new Date(imp.importado_em as string).toLocaleString("pt-BR")}
          </p>
        </div>
        <StatusBadge status={imp.status as string} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-10">
        <Stat label="Total linhas" value={(imp.total_linhas as number) ?? 0} />
        <Stat label="Vendas" value={(imp.total_vendas as number) ?? 0} />
        <Stat label="Trocas" value={(imp.total_trocas as number) ?? 0} />
        <Stat
          label="Duplicados"
          value={breakdownStatus["duplicado_doc"] ?? 0}
          hint={(breakdownStatus["duplicado_doc"] ?? 0) > 0 ? "doc já existia" : undefined}
        />
        <Stat
          label="Órfãos"
          value={(imp.total_skus_nao_encontrados as number) ?? 0}
          tone={(imp.total_skus_nao_encontrados as number) > 0 ? "warn" : undefined}
        />
      </div>

      {orfaos.length > 0 && (
        <>
          <h2 className="display-lg text-ink mb-3" style={{ fontSize: 24 }}>
            Resolver órfãos ({orfaos.length})
          </h2>
          <p className="text-[14px] text-body mb-6">
            Códigos do PDV que não bateram com nenhum SKU/EAN do cadastro nem com aliases
            existentes. Aceitar uma sugestão cria um <code>sku_alias</code> permanente, então
            futuros imports vão resolver automaticamente.
          </p>
          <OrfaoResolver
            import_id={id}
            loja_id={loja?.id ?? ""}
            orfaos={orfaos}
          />
        </>
      )}

      {orfaos.length === 0 && (
        <div className="bg-surface-card border border-hairline rounded-xl p-6">
          <h2 className="text-[18px] font-medium text-ink mb-2">Nenhum órfão pendente</h2>
          <p className="text-[14px] text-body">
            Todas as linhas foram resolvidas. Breakdown por status:
          </p>
          <ul className="mt-3 space-y-1 text-[13px] text-body">
            {Object.entries(breakdownStatus).map(([s, n]) => (
              <li key={s}>
                <span className="caption-uppercase text-muted">{s}:</span> {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-5">
      <p className="caption-uppercase text-muted">{label}</p>
      <p
        className={`mt-2 text-[24px] font-light ${tone === "warn" ? "text-error" : "text-ink"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value.toLocaleString("pt-BR")}
      </p>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const tone =
    status === "concluido"
      ? "bg-[#dcfce7] text-[#15803d]"
      : status === "aguardando_resolucao"
        ? "bg-[#fef3c7] text-[#92400e]"
        : status === "erro"
          ? "bg-[#fee2e2] text-error"
          : "bg-surface-strong text-muted";
  return (
    <span className={`caption-uppercase rounded-pill px-3 py-1.5 whitespace-nowrap ${tone}`}>
      {label}
    </span>
  );
}
