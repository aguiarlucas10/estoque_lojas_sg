"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ajustarEstoqueAction } from "./actions";

export function AjustarBotao({
  loja_id,
  produto_id,
  sku,
  nome,
  qtd_atual,
}: {
  loja_id: string;
  produto_id: string;
  sku: string;
  nome: string;
  qtd_atual: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [novaQtd, setNovaQtd] = useState<number>(qtd_atual);
  const [motivo, setMotivo] = useState("");
  const router = useRouter();

  function abrir() {
    setErro(null);
    setNovaQtd(qtd_atual);
    setMotivo("");
    dialogRef.current?.showModal();
  }

  function fechar() {
    dialogRef.current?.close();
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const r = await ajustarEstoqueAction({
        loja_id,
        produto_id,
        nova_qtd: novaQtd,
        motivo,
      });
      if (!r.ok) {
        setErro(r.error);
      } else {
        fechar();
        router.refresh();
      }
    });
  }

  const delta = novaQtd - qtd_atual;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="text-[12px] text-body hover:text-ink"
      >
        Ajustar
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-xl p-0 max-w-[480px] w-full backdrop:bg-black/50"
      >
        <div className="bg-surface-card p-6">
          <p className="caption-uppercase text-muted mb-2">Ajuste manual de estoque</p>
          <h2 className="display-lg text-ink mb-1" style={{ fontSize: 20 }}>
            {sku}
          </h2>
          <p className="text-[13px] text-body mb-5 truncate" title={nome}>
            {nome}
          </p>

          <div className="space-y-4 mb-5">
            <Field label="Saldo atual">
              <div className="bg-canvas-soft border border-hairline rounded-md px-4 py-2.5 text-[15px] text-body">
                {qtd_atual}
              </div>
            </Field>

            <Field label="Nova quantidade">
              <input
                type="number"
                value={novaQtd}
                onChange={(e) => setNovaQtd(Number(e.target.value) || 0)}
                disabled={pending}
                autoFocus
                className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[15px] text-ink focus:border-ink focus:outline-none"
              />
              {delta !== 0 && (
                <p
                  className={`mt-1.5 text-[12px] font-medium ${
                    delta > 0 ? "text-[#15803d]" : "text-error"
                  }`}
                >
                  Movimento gerado: {delta > 0 ? "+" : ""}
                  {delta} (tipo ajuste_manual)
                </p>
              )}
            </Field>

            <Field label="Motivo (opcional)">
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={pending}
                placeholder="ex: contagem fora de sessão, divergência apurada..."
                className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
              />
            </Field>
          </div>

          {erro && (
            <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-3 py-2 text-[13px] text-error mb-4">
              {erro}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={fechar}
              disabled={pending}
              className="text-[14px] text-body hover:text-ink"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={pending || delta === 0}
              className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[14px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? "Salvando…" : delta === 0 ? "Sem mudança" : "Salvar ajuste"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caption-uppercase text-muted block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
