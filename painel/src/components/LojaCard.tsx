import Link from "next/link";
import { PieChart, type PieSlice } from "./PieChart";

export type CategoriaBreakdown = {
  categoria: string | null;
  produtos: number; // contagem de SKUs distintos com saldo > 0
  unidades: number; // soma das quantidades
};

const CATEGORIA_TONE: Record<string, string> = {
  Relógio: "var(--color-gradient-mint)",
  "Óculos de Sol": "var(--color-gradient-peach)",
  "Óculos de Grau": "var(--color-gradient-lavender)",
  Semijoias: "var(--color-gradient-sky)",
  Embalagem: "var(--color-gradient-rose)",
};
const COR_PADRAO = "var(--color-muted-soft)";

export function LojaCard({
  codigo,
  nome,
  breakdown,
}: {
  codigo: string;
  nome: string;
  breakdown: CategoriaBreakdown[];
}) {
  const totalProdutos = breakdown.reduce((acc, b) => acc + b.produtos, 0);
  const slices: PieSlice[] = breakdown.map((b) => ({
    label: b.categoria ?? "Sem categoria",
    value: b.produtos,
    color: b.categoria ? (CATEGORIA_TONE[b.categoria] ?? COR_PADRAO) : COR_PADRAO,
  }));

  return (
    <Link
      href={`/painel/estoque/${codigo}`}
      className="group bg-surface-card border border-hairline rounded-[16px] p-6 transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex flex-col"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="caption-uppercase text-muted">{codigo}</span>
          <h3 className="mt-2 text-[18px] font-medium text-ink leading-tight">{nome}</h3>
        </div>
      </div>

      {totalProdutos > 0 ? (
        <div className="flex items-center gap-4">
          <PieChart slices={slices} size={88} />
          <div className="flex-1 min-w-0 space-y-1.5">
            {breakdown
              .slice()
              .sort((a, b) => b.produtos - a.produtos)
              .slice(0, 5)
              .map((b) => (
                <LegendItem
                  key={b.categoria ?? "sem"}
                  cor={
                    b.categoria
                      ? (CATEGORIA_TONE[b.categoria] ?? COR_PADRAO)
                      : COR_PADRAO
                  }
                  label={b.categoria ?? "Sem categoria"}
                  valor={b.produtos}
                />
              ))}
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-muted py-3 leading-snug">
          Sem estoque registrado.
          <br />
          A primeira contagem geral estabelece o saldo.
        </div>
      )}

      <span className="mt-4 inline-block text-[13px] text-body group-hover:text-ink">
        {totalProdutos > 0
          ? `${totalProdutos.toLocaleString("pt-BR")} SKUs com saldo →`
          : "Ver estoque →"}
      </span>
    </Link>
  );
}

function LegendItem({
  cor,
  label,
  valor,
}: {
  cor: string;
  label: string;
  valor: number;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] leading-tight">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: cor }}
      />
      <span className="text-body truncate flex-1">{label}</span>
      <span className="text-ink font-medium tabular-nums">{valor}</span>
    </div>
  );
}
