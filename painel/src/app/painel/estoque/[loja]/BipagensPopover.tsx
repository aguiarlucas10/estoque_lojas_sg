"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getBipagensProdutoAction, type BipagensResult } from "./actions";
import { dataHoraBR, dataBR } from "@/lib/format-date";

const horaBR = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "America/Sao_Paulo",
});

type Estado =
  | { fase: "idle" }
  | { fase: "loading" }
  | { fase: "ok"; data: Extract<BipagensResult, { ok: true }> }
  | { fase: "erro"; msg: string };

export function BipagensPopover({
  loja_id,
  produto_id,
  quantidade,
  className,
}: {
  loja_id: string;
  produto_id: string;
  quantidade: number;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: "idle" });
  const [, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  function abrir() {
    setAberto(true);
    if (estado.fase === "idle" || estado.fase === "erro") {
      setEstado({ fase: "loading" });
      startTransition(async () => {
        const r = await getBipagensProdutoAction(loja_id, produto_id);
        if (r.ok) setEstado({ fase: "ok", data: r });
        else setEstado({ fase: "erro", msg: r.error });
      });
    }
  }

  function fechar() {
    setAberto(false);
  }

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!aberto) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) fechar();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => (aberto ? fechar() : abrir())}
        className={`${className ?? ""} hover:underline decoration-dotted underline-offset-4 cursor-pointer`}
        title="Ver bipagens da última contagem"
      >
        {quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
      </button>

      {aberto && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-[320px] bg-surface-card border border-hairline-strong rounded-xl shadow-xl text-left"
          // Evita que click dentro feche o popover via document handler
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ConteudoPopover estado={estado} quantidade={quantidade} />
        </div>
      )}
    </div>
  );
}

function ConteudoPopover({
  estado,
  quantidade,
}: {
  estado: Estado;
  quantidade: number;
}) {
  if (estado.fase === "loading") {
    return (
      <div className="px-5 py-4 text-[13px] text-muted">Carregando…</div>
    );
  }
  if (estado.fase === "erro") {
    return (
      <div className="px-5 py-4 text-[13px] text-error">
        Erro: {estado.msg}
      </div>
    );
  }
  if (estado.fase === "idle") return null;

  const { sessao, bipagens } = estado.data;
  const totalBipado = bipagens.reduce((acc, b) => acc + b.qtd, 0);

  return (
    <>
      <div className="px-5 pt-4 pb-3 border-b border-hairline">
        <p className="caption-uppercase text-muted">Bipagens</p>
        <p className="text-[13px] text-body mt-1">
          {sessao
            ? `Última contagem: ${
                sessao.finalizada_em
                  ? dataBR.format(new Date(sessao.finalizada_em))
                  : "—"
              }`
            : "Nenhuma contagem finalizada nesta loja"}
        </p>
      </div>

      {sessao && bipagens.length === 0 && (
        <div className="px-5 py-4 text-[13px] text-muted">
          Produto não foi bipado nesta contagem. Saldo atual ({quantidade})
          veio de movimentos posteriores (recebimento, venda, ajuste).
        </div>
      )}

      {bipagens.length > 0 && (
        <ul className="divide-y divide-hairline-soft max-h-[360px] overflow-y-auto">
          {bipagens.map((b, i) => (
            <li
              key={`${b.bipado_em}-${i}`}
              className="flex items-center justify-between gap-3 px-5 py-2.5"
            >
              <span className="text-[13px] text-body">
                {horaBR.format(new Date(b.bipado_em))}
              </span>
              <span className="text-[13px] text-ink font-medium tabular-nums">
                +{b.qtd}
              </span>
            </li>
          ))}
        </ul>
      )}

      {bipagens.length > 0 && (
        <div className="px-5 py-3 border-t border-hairline flex items-center justify-between text-[12px]">
          <span className="caption-uppercase text-muted">Total bipado</span>
          <span className="text-ink font-medium tabular-nums">
            {totalBipado.toLocaleString("pt-BR")}
            {totalBipado !== quantidade && (
              <span className="text-muted ml-1">
                (saldo atual: {quantidade})
              </span>
            )}
          </span>
        </div>
      )}

      {bipagens.length > 0 && bipagens[0] && (
        <div className="px-5 pb-3 text-[11px] text-muted">
          1ª bipagem: {dataHoraBR.format(new Date(bipagens[0].bipado_em))} ·
          última: {dataHoraBR.format(new Date(bipagens[bipagens.length - 1].bipado_em))}
        </div>
      )}
    </>
  );
}
