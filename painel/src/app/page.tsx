import Link from "next/link";
import { redirect } from "next/navigation";
import { GradientOrb } from "@/components/GradientOrb";
import { TopNav } from "@/components/TopNav";
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
    .select("codigo, nome")
    .eq("ativa", true)
    .order("codigo");

  return (
    <>
      <TopNav />
      <main className="flex-1 relative overflow-hidden">
        <GradientOrb tone="mint" size={520} className="-top-32 -left-24" />
        <GradientOrb tone="peach" size={480} className="top-40 right-0 translate-x-1/3" />

        <section className="relative mx-auto max-w-[1200px] px-6 pt-24 pb-32">
          <p className="caption-uppercase text-muted mb-6">Saint Germain — Estoque</p>
          <h1 className="display-xl text-ink max-w-[720px]">
            Fonte de verdade do estoque físico de cada quiosque.
          </h1>
          <p className="mt-6 max-w-[560px] text-body text-[16px] leading-[1.5]">
            Contagens periódicas, importação semanal do PDV, recebimentos e perdas em um
            ledger imutável. Selecione uma loja para ver o estoque atual.
          </p>

          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(lojas ?? []).map((l) => (
              <Link
                key={l.codigo}
                href={`/painel/estoque/${l.codigo}`}
                className="group bg-surface-card border border-hairline rounded-[16px] p-6 transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]"
              >
                <span className="caption-uppercase text-muted">{l.codigo}</span>
                <h3 className="mt-3 text-[20px] font-medium text-ink">{l.nome}</h3>
                <span className="mt-4 inline-block text-[14px] text-body group-hover:text-ink">
                  Ver estoque →
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
