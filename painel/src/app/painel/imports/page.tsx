import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { ApagarImportBotao } from "./ApagarImportBotao";

export const dynamic = "force-dynamic";

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const statusLabel: Record<string, { label: string; tone: "ok" | "pending" | "warn" | "err" }> = {
  processando: { label: "Processando", tone: "pending" },
  aguardando_resolucao: { label: "Aguardando órfãos", tone: "warn" },
  concluido: { label: "Concluído", tone: "ok" },
  erro: { label: "Erro", tone: "err" },
};

export default async function ImportsPage() {
  const scope = await getLojaScope();
  const sb = getSupabase();
  let query = sb
    .from("lj_imports_vendas")
    .select(`
      id, status, periodo_inicio, periodo_fim, importado_em,
      total_linhas, total_vendas, total_trocas, total_skus_nao_encontrados,
      arquivo_nome,
      loja:lj_lojas(codigo, nome)
    `)
    .order("importado_em", { ascending: false });
  if (scope.tipo === "loja") {
    query = query.eq("loja_id", scope.loja_id);
  }
  const { data: imports } = await query;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="caption-uppercase text-muted mb-3">Importações</p>
          <h1 className="display-lg text-ink">Vendas do PDV</h1>
        </div>
        <Link
          href="/painel/imports/novo"
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors"
        >
          Novo import
        </Link>
      </div>

      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-6 py-3">Loja</th>
              <th className="text-left px-6 py-3">Período</th>
              <th className="text-right px-6 py-3">Vendas</th>
              <th className="text-right px-6 py-3">Trocas</th>
              <th className="text-right px-6 py-3">Órfãos</th>
              <th className="text-left px-6 py-3">Status</th>
              <th className="text-right px-6 py-3">Importado em</th>
              <th className="px-3"></th>
              {scope.tipo === "admin" && <th className="px-3"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {(imports ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={scope.tipo === "admin" ? 9 : 8}
                  className="px-6 py-16 text-center text-muted"
                >
                  Nenhum import ainda. Clique em &quot;Novo import&quot; para começar.
                </td>
              </tr>
            )}
            {(imports ?? []).map((i) => {
              const loja = i.loja as unknown as { codigo: string; nome: string } | null;
              const st = statusLabel[i.status as string] ?? { label: i.status as string, tone: "pending" as const };
              return (
                <tr key={i.id as string} className="hover:bg-canvas-soft">
                  <td className="px-6 py-4">
                    <div className="text-[14px] text-ink font-medium">{loja?.codigo ?? "—"}</div>
                    <div className="text-[12px] text-muted">{loja?.nome ?? ""}</div>
                  </td>
                  <td className="px-6 py-4 text-[14px] text-body">
                    {dataBR.format(new Date(i.periodo_inicio as string))}
                    {" → "}
                    {dataBR.format(new Date(i.periodo_fim as string))}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-ink">
                    {(i.total_vendas as number ?? 0).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-body">
                    {(i.total_trocas as number ?? 0).toLocaleString("pt-BR")}
                  </td>
                  <td
                    className={`px-6 py-4 text-right text-[14px] font-medium ${(i.total_skus_nao_encontrados as number) > 0 ? "text-error" : "text-muted"}`}
                  >
                    {(i.total_skus_nao_encontrados as number ?? 0).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill tone={st.tone} label={st.label} />
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted">
                    {dataBR.format(new Date(i.importado_em as string))}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <Link
                      href={`/painel/imports/${i.id as string}`}
                      className="text-[14px] text-ink hover:underline"
                    >
                      Detalhes →
                    </Link>
                  </td>
                  {scope.tipo === "admin" && (
                    <td className="px-3 py-4 text-right relative">
                      <ApagarImportBotao
                        import_id={i.id as string}
                        loja_codigo={loja?.codigo ?? "—"}
                        periodo_label={`${dataBR.format(new Date(i.periodo_inicio as string))} → ${dataBR.format(new Date(i.periodo_fim as string))}`}
                        total_vendas={(i.total_vendas as number) ?? 0}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "pending" | "warn" | "err"; label: string }) {
  const styles = {
    ok: "bg-surface-strong text-ink",
    pending: "bg-surface-strong text-muted",
    warn: "bg-[#fef3c7] text-[#92400e]",
    err: "bg-[#fee2e2] text-error",
  }[tone];
  return (
    <span className={`inline-block caption-uppercase px-2.5 py-1 rounded-pill ${styles}`}>
      {label}
    </span>
  );
}
