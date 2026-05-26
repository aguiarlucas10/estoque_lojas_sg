"use client";

import { useMemo, useState } from "react";
import { AjustarBotao } from "./AjustarBotao";
import { dataBR } from "@/lib/format-date";

export type EstoqueLinha = {
  produto_id: string;
  sku: string;
  nome: string;
  categoria: string | null;
  custo: number | null;
  quantidade: number;
  ultima_contagem_em: string | null;
  ultimo_recebimento_em: string | null;
  ultima_venda_em: string | null;
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function EstoqueTabela({
  loja_id,
  itens,
  isAdmin,
}: {
  loja_id: string;
  itens: EstoqueLinha[];
  isAdmin: boolean;
}) {
  const [busca, setBusca] = useState("");
  const buscaNorm = busca.trim().toLowerCase();

  const filtrados = useMemo(() => {
    // Sem busca: SKUs com saldo OU com historico de venda (esconde
    // o resto do catalogo que nunca teve movimento nesta loja).
    // Com busca: tudo que bate, inclusive zerados sem venda.
    const base = buscaNorm
      ? itens.filter(
          (i) =>
            i.sku.toLowerCase().includes(buscaNorm) ||
            i.nome.toLowerCase().includes(buscaNorm),
        )
      : itens.filter((i) => i.quantidade !== 0 || i.ultima_venda_em != null);
    return base.sort((a, b) => b.quantidade - a.quantidade);
  }, [itens, buscaNorm]);

  return (
    <>
      <div className="mb-5">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por SKU ou nome (inclui saldos zerados)…"
          className="w-full max-w-[480px] bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
        />
      </div>

      <div className="bg-surface-card border border-hairline rounded-[16px] max-h-[72vh] overflow-y-auto overflow-x-auto">
        <table className="w-full min-w-[1200px]">
          <thead className="bg-surface-strong border-b border-hairline sticky top-0 z-10">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-6 py-3 whitespace-nowrap">SKU</th>
              <th className="text-left px-6 py-3 whitespace-nowrap">Produto</th>
              <th className="text-left px-6 py-3 whitespace-nowrap">Categoria</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Quantidade</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Custo un.</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Valor</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Últ. contagem</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Últ. recebimento</th>
              <th className="text-right px-6 py-3 whitespace-nowrap">Últ. venda</th>
              {isAdmin && (
                <th className="text-right px-6 py-3 w-24 whitespace-nowrap">Ação</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {filtrados.length === 0 && (
              <tr>
                <td
                  colSpan={isAdmin ? 10 : 9}
                  className="px-6 py-12 text-center text-muted"
                >
                  {buscaNorm
                    ? "Nenhum SKU bate com a busca."
                    : "Nenhum SKU com saldo nesta loja ainda."}
                </td>
              </tr>
            )}
            {filtrados.map((i) => {
              const valor = i.custo != null ? i.custo * i.quantidade : null;
              const negativo = i.quantidade < 0;
              const zero = i.quantidade === 0;
              return (
                <tr key={i.produto_id} className="hover:bg-canvas-soft">
                  <td className="px-6 py-4 font-mono text-[14px] text-body-strong">
                    {i.sku}
                  </td>
                  <td className="px-6 py-4 text-[14px] text-ink">
                    <div className="truncate max-w-[420px]" title={i.nome}>
                      {i.nome}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[13px] text-muted">
                    {i.categoria ?? "—"}
                  </td>
                  <td
                    className={`px-6 py-4 text-right font-medium ${
                      negativo ? "text-error" : zero ? "text-muted" : "text-ink"
                    }`}
                  >
                    {i.quantidade.toLocaleString("pt-BR", {
                      maximumFractionDigits: 0,
                    })}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-body">
                    {i.custo != null ? moedaBR.format(i.custo) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-body">
                    {valor != null ? moedaBR.format(valor) : "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted whitespace-nowrap">
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
                  {isAdmin && (
                    <td className="px-6 py-4 text-right">
                      <AjustarBotao
                        loja_id={loja_id}
                        produto_id={i.produto_id}
                        sku={i.sku}
                        nome={i.nome}
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

      <p className="mt-3 text-[12px] text-muted">
        {filtrados.length.toLocaleString("pt-BR")}
        {buscaNorm
          ? ` resultado${filtrados.length === 1 ? "" : "s"}`
          : ` SKU${filtrados.length === 1 ? "" : "s"} com saldo ou venda registrada`}
      </p>
    </>
  );
}
