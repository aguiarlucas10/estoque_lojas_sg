import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { dataBR, dataHoraBR } from "@/lib/format-date";

export const dynamic = "force-dynamic";

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function RecebimentoDetalhesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    redirect("/");
  }
  const sb = getSupabase();
  const { data: r } = await sb
    .from("lj_recebimentos")
    .select(`
      id, fornecedor, nf_numero, data_recebimento, total_itens, total_valor,
      observacao, criado_em,
      loja:lj_lojas(codigo, nome)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const loja = r.loja as unknown as { codigo: string; nome: string } | null;

  const { data: itens } = await sb
    .from("lj_recebimentos_itens")
    .select("id, qtd, custo_unitario, produto_id")
    .eq("recebimento_id", id);

  const ids = (itens ?? []).map((i) => i.produto_id as string);
  let prodMap = new Map<string, { sku: string; nome: string }>();
  if (ids.length > 0) {
    const { data: prods } = await sb
      .from("lj_produtos")
      .select("id, sku, nome")
      .in("id", ids);
    prodMap = new Map(
      (prods ?? []).map((p) => [
        p.id as string,
        { sku: p.sku as string, nome: p.nome as string },
      ]),
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-12">
      <Link
        href="/painel/recebimentos"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para recebimentos
      </Link>

      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <p className="caption-uppercase text-muted mb-3">
            {loja?.codigo ?? "—"} · {loja?.nome ?? ""}
          </p>
          <h1 className="display-lg text-ink mb-1">
            {r.nf_numero ? `Pedido ${r.nf_numero}` : "Recebimento"}
          </h1>
          <p className="text-[14px] text-muted">
            {(r.fornecedor as string) ?? "—"} · recebido em{" "}
            {dataBR.format(new Date(r.data_recebimento as string))}
            {r.criado_em && (
              <>
                {" "}
                · lançado em {dataHoraBR.format(new Date(r.criado_em as string))}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <Stat label="Total de itens" value={String(r.total_itens ?? 0)} />
        <Stat
          label="Valor total"
          value={moedaBR.format(Number(r.total_valor ?? 0))}
        />
        <Stat
          label="Soma de unidades"
          value={String((itens ?? []).reduce((acc, i) => acc + Number(i.qtd), 0))}
        />
      </div>

      {r.observacao && (
        <div className="bg-canvas-soft border border-hairline rounded-lg px-4 py-3 mb-8 text-[13px] text-body">
          <strong className="text-ink">Observação:</strong> {r.observacao as string}
        </div>
      )}

      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-5 py-3">SKU</th>
              <th className="text-left px-5 py-3">Produto</th>
              <th className="text-right px-5 py-3">Qtd</th>
              <th className="text-right px-5 py-3">Custo un.</th>
              <th className="text-right px-5 py-3">Subtotal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {(itens ?? []).map((i) => {
              const p = prodMap.get(i.produto_id as string);
              const qtd = Number(i.qtd);
              const custo = Number(i.custo_unitario);
              return (
                <tr key={i.id as string} className="hover:bg-canvas-soft">
                  <td className="px-5 py-3 font-mono text-[13px] text-body-strong">
                    {p?.sku ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink">
                    <div className="truncate max-w-[440px]">{p?.nome ?? "—"}</div>
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] text-ink font-medium">
                    {qtd}
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] text-body">
                    {moedaBR.format(custo)}
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] text-body">
                    {moedaBR.format(qtd * custo)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-5">
      <p className="caption-uppercase text-muted">{label}</p>
      <p
        className="mt-2 text-[22px] font-light text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
    </div>
  );
}
