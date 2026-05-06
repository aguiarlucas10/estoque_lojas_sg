import { redirect } from "next/navigation";
import { GradientOrb } from "@/components/GradientOrb";
import { TopNav } from "@/components/TopNav";
import { LojaCard, type CategoriaBreakdown } from "@/components/LojaCard";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export default async function Home() {
  const scope = await getLojaScope();
  // Usuario de loja: vai direto pro estoque da loja dele
  if (scope.tipo === "loja") {
    redirect(`/painel/estoque/${scope.codigo}`);
  }

  const supabase = getSupabase();
  const { data: lojas } = await supabase
    .from("lj_lojas")
    .select("id, codigo, nome")
    .eq("ativa", true)
    .order("codigo");

  // Breakdown por categoria pra cada loja: SKUs com saldo > 0 agrupados.
  // Apos zeragem o estoque vai estar vazio em todas; popula conforme as
  // contagens forem aplicadas.
  const { data: estoque } = await supabase
    .from("lj_estoque_atual")
    .select("loja_id, produto_id, quantidade")
    .gt("quantidade", 0);

  const produtoIds = Array.from(
    new Set((estoque ?? []).map((e) => e.produto_id as string)),
  );
  let produtosMap = new Map<string, { categoria: string | null }>();
  if (produtoIds.length > 0) {
    const { data: produtos } = await supabase
      .from("lj_produtos")
      .select("id, categoria")
      .in("id", produtoIds);
    produtosMap = new Map(
      (produtos ?? []).map((p) => [
        p.id as string,
        { categoria: (p.categoria as string | null) ?? null },
      ]),
    );
  }

  const lojaIdToCodigo = new Map(
    (lojas ?? []).map((l) => [l.id as string, l.codigo as string]),
  );
  const categoriasPorLoja = new Map<string, CategoriaBreakdown[]>();
  const tmpAgg = new Map<string, Map<string, { produtos: number; unidades: number }>>();
  for (const e of estoque ?? []) {
    const codigo = lojaIdToCodigo.get(e.loja_id as string);
    if (!codigo) continue;
    const cat = produtosMap.get(e.produto_id as string)?.categoria ?? null;
    const catKey = cat ?? "__sem__";
    if (!tmpAgg.has(codigo)) tmpAgg.set(codigo, new Map());
    const m = tmpAgg.get(codigo)!;
    const cur = m.get(catKey) ?? { produtos: 0, unidades: 0 };
    cur.produtos += 1;
    cur.unidades += Number(e.quantidade);
    m.set(catKey, cur);
  }
  for (const [codigo, m] of tmpAgg.entries()) {
    const arr: CategoriaBreakdown[] = [];
    for (const [catKey, vals] of m.entries()) {
      arr.push({
        categoria: catKey === "__sem__" ? null : catKey,
        produtos: vals.produtos,
        unidades: vals.unidades,
      });
    }
    categoriasPorLoja.set(codigo, arr);
  }

  return (
    <>
      <TopNav />
      <main className="flex-1 relative overflow-hidden">
        <GradientOrb tone="mint" size={520} className="-top-32 -left-24" />
        <GradientOrb tone="peach" size={480} className="top-40 right-0 translate-x-1/3" />

        <section className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-32">
          <p className="caption-uppercase text-muted mb-6">Saint Germain — Estoque</p>
          <p className="max-w-[640px] text-body text-[16px] leading-[1.5]">
            Contagens periódicas, importação semanal do PDV, recebimentos e perdas em um
            único lugar. Selecione uma loja para ver o estoque atual.
          </p>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(lojas ?? []).map((l) => (
              <LojaCard
                key={l.codigo}
                codigo={l.codigo as string}
                nome={l.nome as string}
                breakdown={categoriasPorLoja.get(l.codigo as string) ?? []}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
