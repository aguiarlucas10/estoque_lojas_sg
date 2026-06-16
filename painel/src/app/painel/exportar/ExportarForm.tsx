"use client";

import { useState } from "react";

export type LojaOpcao = { codigo: string; nome: string };

export function ExportarForm({
  lojas,
  travado,
}: {
  lojas: LojaOpcao[];
  travado: boolean;
}) {
  // Comeca com todas selecionadas
  const [sel, setSel] = useState<Set<string>>(
    () => new Set(lojas.map((l) => l.codigo)),
  );

  function toggle(codigo: string) {
    if (travado) return;
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  }

  function todas(marcar: boolean) {
    if (travado) return;
    setSel(marcar ? new Set(lojas.map((l) => l.codigo)) : new Set());
  }

  const codigos = lojas.filter((l) => sel.has(l.codigo)).map((l) => l.codigo);
  const nenhuma = codigos.length === 0;

  function baixar(tipo: "estoque" | "contagens") {
    if (nenhuma) return;
    const qs = encodeURIComponent(codigos.join(","));
    // Resposta vem como attachment (Content-Disposition): o browser baixa
    // o arquivo e nao navega pra fora da pagina.
    window.location.href = `/painel/exportar/${tipo}?lojas=${qs}`;
  }

  const todasMarcadas = sel.size === lojas.length && lojas.length > 0;

  return (
    <div className="space-y-8">
      <section className="bg-surface-card border border-hairline rounded-[16px] p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="caption-uppercase text-muted">Lojas</p>
          {!travado && lojas.length > 1 && (
            <button
              type="button"
              onClick={() => todas(!todasMarcadas)}
              className="text-[13px] text-ink hover:underline"
            >
              {todasMarcadas ? "Desmarcar todas" : "Marcar todas"}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {lojas.map((l) => {
            const marcada = sel.has(l.codigo);
            return (
              <label
                key={l.codigo}
                className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 transition-colors ${
                  travado ? "cursor-default" : "cursor-pointer"
                } ${
                  marcada
                    ? "border-ink bg-canvas-soft"
                    : "border-hairline hover:border-body"
                }`}
              >
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={() => toggle(l.codigo)}
                  disabled={travado}
                  className="h-4 w-4 accent-[#0c0a09]"
                />
                <span>
                  <span className="text-[14px] font-medium text-ink">{l.codigo}</span>
                  <span className="text-[13px] text-muted"> · {l.nome}</span>
                </span>
              </label>
            );
          })}
        </div>
        {travado && (
          <p className="mt-3 text-[12px] text-muted">
            Você só pode exportar dados da sua loja.
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ExportCard
          titulo="Estoque atual"
          descricao="Saldo por SKU, custo, valor e datas de última contagem, recebimento e venda."
          disabled={nenhuma}
          onClick={() => baixar("estoque")}
        />
        <ExportCard
          titulo="Contagens"
          descricao="Sessões item a item: qtd teórica, contada, diferença e status."
          disabled={nenhuma}
          onClick={() => baixar("contagens")}
        />
      </section>

      {nenhuma && (
        <p className="text-[13px] text-error">Selecione ao menos uma loja para exportar.</p>
      )}
    </div>
  );
}

function ExportCard({
  titulo,
  descricao,
  disabled,
  onClick,
}: {
  titulo: string;
  descricao: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="bg-surface-card border border-hairline rounded-[16px] p-6 flex flex-col">
      <h2 className="text-[17px] font-medium text-ink">{titulo}</h2>
      <p className="mt-2 text-[13px] text-muted flex-1">{descricao}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="mt-5 inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Baixar CSV
      </button>
    </div>
  );
}
