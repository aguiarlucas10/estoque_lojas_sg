import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function RecebimentosPage() {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    // Loja não vê esta página
    redirect("/");
  }
  const sb = getSupabase();
  const { data: recs } = await sb
    .from("lj_recebimentos")
    .select(`
      id, fornecedor, nf_numero, data_recebimento,
      total_itens, total_valor, criado_em,
      loja:lj_lojas(codigo, nome)
    `)
    .order("criado_em", { ascending: false });

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="caption-uppercase text-muted mb-3">Recebimentos</p>
          <h1 className="display-lg text-ink">Entradas de mercadoria</h1>
        </div>
        <Link
          href="/painel/recebimentos/novo"
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors"
        >
          Novo recebimento
        </Link>
      </div>

      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-6 py-3">Loja</th>
              <th className="text-left px-6 py-3">Pedido / NF</th>
              <th className="text-left px-6 py-3">Fornecedor</th>
              <th className="text-right px-6 py-3">Itens</th>
              <th className="text-right px-6 py-3">Valor</th>
              <th className="text-right px-6 py-3">Data</th>
              <th className="px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {(recs ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-muted">
                  Nenhum recebimento ainda. Clique em &quot;Novo recebimento&quot; para
                  começar.
                </td>
              </tr>
            )}
            {(recs ?? []).map((r) => {
              const loja = r.loja as unknown as { codigo: string; nome: string } | null;
              return (
                <tr key={r.id as string} className="hover:bg-canvas-soft">
                  <td className="px-6 py-4">
                    <div className="text-[14px] text-ink font-medium">
                      {loja?.codigo ?? "—"}
                    </div>
                    <div className="text-[12px] text-muted">{loja?.nome ?? ""}</div>
                  </td>
                  <td className="px-6 py-4 text-[14px] text-body font-mono">
                    {(r.nf_numero as string) ?? "—"}
                  </td>
                  <td className="px-6 py-4 text-[14px] text-body">
                    {(r.fornecedor as string) ?? "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-ink">
                    {(r.total_itens as number) ?? 0}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-body">
                    {r.total_valor != null
                      ? moedaBR.format(Number(r.total_valor))
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted">
                    {dataBR.format(new Date(r.data_recebimento as string))}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <Link
                      href={`/painel/recebimentos/${r.id as string}`}
                      className="text-[14px] text-ink hover:underline whitespace-nowrap"
                    >
                      Detalhes →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
