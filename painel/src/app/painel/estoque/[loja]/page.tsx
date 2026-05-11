import { notFound, redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { AjustarBotao } from "./AjustarBotao";

export const dynamic = "force-dynamic";

type EstoqueItem = {
  produto_id: string;
  quantidade: number;
  ultima_contagem_em: string | null;
  ultimo_recebimento_em: string | null;
  ultima_venda_em: string | null;
};

type Produto = {
  id: string;
  sku: string;
  nome: string;
  categoria: string | null;
  custo: number | null;
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function EstoqueLojaPage({
  params,
}: {
  params: Promise<{ loja: string }>;
}) {
  const { loja: codigo } = await params;
  const scope = await getLojaScope();
  // Usuario de loja so acessa a propria — redirect se URL diverge
  if (scope.tipo === "loja" && scope.codigo.toUpperCase() !== codigo.toUpperCase()) {
    redirect(`/painel/estoque/${scope.codigo}`);
  }
  const supabase = getSupabase();

  const { data: lojaRow } = await supabase
    .from("lj_lojas")
    .select("id, nome, codigo")
    .eq("codigo", codigo.toUpperCase())
    .maybeSingle();

  if (!lojaRow) notFound();

  const { data: estoque } = await supabase
    .from("lj_estoque_atual")
    .select(
      "produto_id, quantidade, ultima_contagem_em, ultimo_recebimento_em, ultima_venda_em",
    )
    .eq("loja_id", lojaRow.id)
    .neq("quantidade", 0)
    .order("quantidade", { ascending: false });

  const items: EstoqueItem[] = (estoque ?? []).map((r) => ({
    produto_id: r.produto_id as string,
    quantidade: Number(r.quantidade),
    ultima_contagem_em: r.ultima_contagem_em as string | null,
    ultimo_recebimento_em: r.ultimo_recebimento_em as string | null,
    ultima_venda_em: r.ultima_venda_em as string | null,
  }));

  let produtos: Record<string, Produto> = {};
  if (items.length > 0) {
    const ids = items.map((i) => i.produto_id);
    const { data: produtosData } = await supabase
      .from("lj_produtos")
      .select("id, sku, nome, categoria, custo")
      .in("id", ids);
    produtos = Object.fromEntries(
      (produtosData ?? []).map((p) => [p.id as string, p as Produto]),
    );
  }

  const skusComSaldo = items.length;
  const qtdTotal = items.reduce((acc, i) => acc + i.quantidade, 0);
  const negativos = items.filter((i) => i.quantidade < 0).length;
  const valorTotal = items.reduce((acc, i) => {
    const p = produtos[i.produto_id];
    return acc + (p?.custo != null ? p.custo * i.quantidade : 0);
  }, 0);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="mb-10">
        <p className="caption-uppercase text-muted mb-3">
          {lojaRow.codigo} · {lojaRow.nome}
        </p>
        <h1 className="display-lg text-ink">Estoque atual</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="SKUs com saldo" value={skusComSaldo.toLocaleString("pt-BR")} />
        <Stat
          label="Quantidade total"
          value={qtdTotal.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
        />
        <Stat label="Valor estimado" value={moedaBR.format(valorTotal)} hint="custo do último recebimento" />
        <Stat
          label="SKUs negativos"
          value={negativos.toLocaleString("pt-BR")}
          hint={negativos > 0 ? "vendidos sem recebimento prévio" : undefined}
          tone={negativos > 0 ? "warn" : undefined}
        />
      </div>

      <div className="bg-surface-card border border-hairline rounded-[16px] overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-6 py-3 whitespace-nowrap">SKU</th>
              <th className="text-left px-6 py-3 whitespace-nowrap">Produto</th>
              <th className="text-left px-6 py-3 whitespace-nowrap">Categoria</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Quantidade</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Custo un.</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Valor</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Última contagem</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Último recebimento</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Última venda</th>
              {scope.tipo === "admin" && <th className="text-right px-6 py-3 w-24 whitespace-nowrap">Ação</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {items.length === 0 && (
              <tr>
                <td colSpan={scope.tipo === "admin" ? 10 : 9} className="px-6 py-12 text-center text-muted">
                  Nenhum SKU com saldo nesta loja ainda.
                </td>
              </tr>
            )}
            {items.map((i) => {
              const p = produtos[i.produto_id];
              const valor = p?.custo != null ? p.custo * i.quantidade : null;
              const isNegativo = i.quantidade < 0;
              return (
                <tr key={i.produto_id} className="hover:bg-canvas-soft">
                  <td className="px-6 py-4 font-mono text-[14px] text-body-strong">
                    {p?.sku ?? "—"}
                  </td>
                  <td className="px-6 py-4 text-[14px] text-ink">
                    <div className="truncate max-w-[280px]" title={p?.nome ?? ""}>
                      {p?.nome ?? "—"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[13px] text-muted">{p?.categoria ?? "—"}</td>
                  <td
                    className={`px-6 py-4 text-right font-medium ${isNegativo ? "text-error" : "text-ink"}`}
                  >
                    {i.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-body">
                    {p?.custo != null ? moedaBR.format(p.custo) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-body">
                    {valor != null ? moedaBR.format(valor) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted">
                    {i.ultima_contagem_em
                      ? dataBR.format(new Date(i.ultima_contagem_em))
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted whitespace-nowrap">
                    {i.ultimo_recebimento_em
                      ? dataBR.format(new Date(i.ultimo_recebimento_em))
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted whitespace-nowrap">
                    {i.ultima_venda_em
                      ? dataBR.format(new Date(i.ultima_venda_em))
                      : "—"}
                  </td>
                  {scope.tipo === "admin" && (
                    <td className="px-6 py-4 text-right">
                      <AjustarBotao
                        loja_id={lojaRow.id as string}
                        produto_id={i.produto_id}
                        sku={p?.sku ?? "—"}
                        nome={p?.nome ?? "—"}
                        qtd_atual={i.quantidade}
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

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="bg-surface-card border border-hairline rounded-[16px] p-6">
      <p className="caption-uppercase text-muted">{label}</p>
      <p
        className={`mt-3 text-[28px] font-light tracking-tight ${tone === "warn" ? "text-error" : "text-ink"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}
