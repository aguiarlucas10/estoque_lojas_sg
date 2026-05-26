import { notFound, redirect } from "next/navigation";
import { getSupabase, fetchAll } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { EstoqueTabela, type EstoqueLinha } from "./EstoqueTabela";

export const dynamic = "force-dynamic";

type EstoqueRow = {
  produto_id: string;
  quantidade: number | string;
  ultima_contagem_em: string | null;
  ultimo_recebimento_em: string | null;
  ultima_venda_em: string | null;
};

type ProdutoRow = {
  id: string;
  sku: string;
  nome: string;
  categoria: string | null;
  custo: number | string | null;
  ativo: boolean;
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
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
  const loja_id = lojaRow.id as string;

  // Carrega TODOS os produtos ativos + toda a matview da loja.
  // Joina client-side pra que a busca encontre SKUs zerados tambem.
  const [produtos, estoque] = await Promise.all([
    fetchAll<ProdutoRow>((sb) =>
      sb
        .from("lj_produtos")
        .select("id, sku, nome, categoria, custo, ativo")
        .eq("ativo", true),
    ),
    fetchAll<EstoqueRow>((sb) =>
      sb
        .from("lj_estoque_atual")
        .select(
          "produto_id, quantidade, ultima_contagem_em, ultimo_recebimento_em, ultima_venda_em",
        )
        .eq("loja_id", loja_id),
    ),
  ]);

  const estoquePorProduto = new Map(estoque.map((e) => [e.produto_id, e]));

  const itens: EstoqueLinha[] = produtos.map((p) => {
    const e = estoquePorProduto.get(p.id);
    return {
      produto_id: p.id,
      sku: p.sku,
      nome: p.nome,
      categoria: p.categoria,
      custo: p.custo != null ? Number(p.custo) : null,
      quantidade: e ? Number(e.quantidade) : 0,
      ultima_contagem_em: e?.ultima_contagem_em ?? null,
      ultimo_recebimento_em: e?.ultimo_recebimento_em ?? null,
      ultima_venda_em: e?.ultima_venda_em ?? null,
    };
  });

  // Stats: contam apenas SKUs com saldo != 0
  const comSaldo = itens.filter((i) => i.quantidade !== 0);
  const skusComSaldo = comSaldo.length;
  const qtdTotal = comSaldo.reduce((acc, i) => acc + i.quantidade, 0);
  const negativos = comSaldo.filter((i) => i.quantidade < 0).length;
  const valorTotal = comSaldo.reduce(
    (acc, i) => acc + (i.custo != null ? i.custo * i.quantidade : 0),
    0,
  );

  return (
    <div className="px-6 py-12">
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
        <Stat
          label="Valor estimado"
          value={moedaBR.format(valorTotal)}
          hint="custo do último recebimento"
        />
        <Stat
          label="SKUs negativos"
          value={negativos.toLocaleString("pt-BR")}
          hint={negativos > 0 ? "vendidos sem recebimento prévio" : undefined}
          tone={negativos > 0 ? "warn" : undefined}
        />
      </div>

      <EstoqueTabela
        loja_id={loja_id}
        itens={itens}
        isAdmin={scope.tipo === "admin"}
      />
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
