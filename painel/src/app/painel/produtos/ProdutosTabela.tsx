"use client";

import { useMemo, useRef, useState } from "react";
import { CATEGORIAS_VALIDAS } from "./actions";
import {
  ProdutoFormDialog,
  type ProdutoFormDialogHandle,
  type ProdutoExistente,
} from "./ProdutoFormDialog";

type Filtro = "todas" | (typeof CATEGORIAS_VALIDAS)[number] | "sem_categoria";

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function ProdutosTabela({ produtos }: { produtos: ProdutoExistente[] }) {
  const dialogRef = useRef<ProdutoFormDialogHandle>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const buscaNorm = busca.trim().toLowerCase();

  const filtrados = useMemo(() => {
    return produtos.filter((p) => {
      if (!mostrarInativos && !p.ativo) return false;
      if (filtro === "sem_categoria" && p.categoria) return false;
      if (
        filtro !== "todas" &&
        filtro !== "sem_categoria" &&
        p.categoria !== filtro
      ) {
        return false;
      }
      if (!buscaNorm) return true;
      return (
        p.sku.toLowerCase().includes(buscaNorm) ||
        p.nome.toLowerCase().includes(buscaNorm) ||
        (p.ean ?? "").toLowerCase().includes(buscaNorm)
      );
    });
  }, [produtos, buscaNorm, filtro, mostrarInativos]);

  function chip(label: string, value: Filtro, count: number) {
    const ativo = filtro === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setFiltro(value)}
        className={`inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-[13px] transition-colors ${
          ativo
            ? "bg-ink text-canvas"
            : "bg-surface-card border border-hairline text-body hover:border-hairline-strong hover:text-ink"
        }`}
      >
        <span>{label}</span>
        <span
          className={`text-[11px] tabular-nums ${
            ativo ? "text-canvas/70" : "text-muted"
          }`}
        >
          {count}
        </span>
      </button>
    );
  }

  const contagens = useMemo(() => {
    const base = mostrarInativos ? produtos : produtos.filter((p) => p.ativo);
    const porCat: Record<string, number> = { sem_categoria: 0, todas: base.length };
    for (const c of CATEGORIAS_VALIDAS) porCat[c] = 0;
    for (const p of base) {
      if (!p.categoria) porCat.sem_categoria++;
      else if (p.categoria in porCat) porCat[p.categoria]++;
    }
    return porCat;
  }, [produtos, mostrarInativos]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[280px]">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por SKU, nome ou EAN…"
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-[13px] text-body cursor-pointer select-none">
          <input
            type="checkbox"
            checked={mostrarInativos}
            onChange={(e) => setMostrarInativos(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-ink)]"
          />
          Mostrar inativos
        </label>
        <button
          type="button"
          onClick={() => dialogRef.current?.abrirNovo()}
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[14px] font-medium hover:bg-primary-active transition-colors"
        >
          Novo produto
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {chip("Todas", "todas", contagens.todas ?? 0)}
        {CATEGORIAS_VALIDAS.map((c) => chip(c, c, contagens[c] ?? 0))}
        {chip("Sem categoria", "sem_categoria", contagens.sem_categoria ?? 0)}
      </div>

      <div className="bg-surface-card border border-hairline rounded-[16px] overflow-hidden">
        <div className="max-h-[68vh] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="bg-surface-strong border-b border-hairline sticky top-0 z-10">
              <tr className="caption-uppercase text-muted">
                <th className="text-left px-6 py-3 whitespace-nowrap">SKU</th>
                <th className="text-left px-6 py-3 whitespace-nowrap">Nome</th>
                <th className="text-left px-6 py-3 whitespace-nowrap">EAN</th>
                <th className="text-left px-6 py-3 whitespace-nowrap">Categoria</th>
                <th className="text-right px-6 py-3 whitespace-nowrap">Custo</th>
                <th className="text-right px-6 py-3 whitespace-nowrap">Preço venda</th>
                <th className="text-left px-6 py-3 whitespace-nowrap">Status</th>
                <th className="text-right px-6 py-3 w-24 whitespace-nowrap">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-soft">
              {filtrados.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-16 text-center text-muted"
                  >
                    {produtos.length === 0
                      ? "Nenhum produto cadastrado ainda. Clique em “Novo produto” para começar."
                      : "Nenhum produto bate com os filtros."}
                  </td>
                </tr>
              )}
              {filtrados.map((p) => (
                <tr
                  key={p.id}
                  className={`hover:bg-canvas-soft ${!p.ativo ? "opacity-60" : ""}`}
                >
                  <td className="px-6 py-3.5 font-mono text-[14px] text-body-strong">
                    {p.sku}
                  </td>
                  <td className="px-6 py-3.5 text-[14px] text-ink">
                    <div
                      className="truncate max-w-[320px]"
                      title={p.nome}
                    >
                      {p.nome}
                    </div>
                    {p.subcategoria && (
                      <div className="text-[12px] text-muted truncate max-w-[320px]">
                        {p.subcategoria}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3.5 font-mono text-[13px] text-muted">
                    {p.ean ?? "—"}
                  </td>
                  <td className="px-6 py-3.5 text-[13px] text-body">
                    {p.categoria ?? <span className="text-muted">—</span>}
                  </td>
                  <td className="px-6 py-3.5 text-right text-[14px] text-body">
                    {p.custo != null ? (
                      moedaBR.format(p.custo)
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-right text-[14px] text-body">
                    {p.preco_venda != null ? (
                      moedaBR.format(p.preco_venda)
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-[12px]">
                    {p.ativo ? (
                      <span className="text-body">Ativo</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-pill bg-canvas-soft text-muted caption-uppercase">
                        Inativo
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => dialogRef.current?.abrirEdicao(p)}
                      className="text-[13px] text-body hover:text-ink"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-muted">
        {filtrados.length.toLocaleString("pt-BR")} de{" "}
        {produtos.length.toLocaleString("pt-BR")} produtos
      </p>

      <ProdutoFormDialog ref={dialogRef} />
    </>
  );
}
