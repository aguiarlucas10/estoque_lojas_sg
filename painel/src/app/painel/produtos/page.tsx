import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { ProdutosTabela } from "./ProdutosTabela";
import type { ProdutoExistente } from "./ProdutoFormDialog";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    redirect("/");
  }

  const sb = getSupabase();
  const { data } = await sb
    .from("lj_produtos")
    .select("id, sku, ean, nome, categoria, subcategoria, custo, preco_venda, ativo")
    .order("sku", { ascending: true });

  const produtos: ProdutoExistente[] = (data ?? []).map((p) => ({
    id: p.id as string,
    sku: p.sku as string,
    ean: (p.ean as string | null) ?? null,
    nome: p.nome as string,
    categoria: (p.categoria as string | null) ?? null,
    subcategoria: (p.subcategoria as string | null) ?? null,
    custo: p.custo != null ? Number(p.custo) : null,
    preco_venda: p.preco_venda != null ? Number(p.preco_venda) : null,
    ativo: Boolean(p.ativo),
  }));

  const total = produtos.length;
  const ativos = produtos.filter((p) => p.ativo).length;
  const semEan = produtos.filter((p) => p.ativo && !p.ean).length;
  const semCusto = produtos.filter((p) => p.ativo && p.custo == null).length;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="mb-10">
        <p className="caption-uppercase text-muted mb-3">Catálogo</p>
        <h1 className="display-lg text-ink">Produtos cadastrados</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="Total cadastrados" value={total.toLocaleString("pt-BR")} />
        <Stat
          label="Ativos"
          value={ativos.toLocaleString("pt-BR")}
          hint={
            total - ativos > 0
              ? `${(total - ativos).toLocaleString("pt-BR")} inativos`
              : undefined
          }
        />
        <Stat
          label="Sem EAN"
          value={semEan.toLocaleString("pt-BR")}
          hint={semEan > 0 ? "não podem ser bipados" : "todos bipáveis"}
          tone={semEan > 0 ? "warn" : undefined}
        />
        <Stat
          label="Sem custo"
          value={semCusto.toLocaleString("pt-BR")}
          hint={
            semCusto > 0
              ? "não entram no valor de estoque"
              : "valor de estoque íntegro"
          }
          tone={semCusto > 0 ? "warn" : undefined}
        />
      </div>

      <ProdutosTabela produtos={produtos} />
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
        className={`mt-3 text-[28px] font-light tracking-tight ${
          tone === "warn" ? "text-error" : "text-ink"
        }`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}
