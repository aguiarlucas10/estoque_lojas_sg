"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apagarImportAction } from "./actions";

export function ApagarImportBotao({
  import_id,
  loja_codigo,
  periodo_label,
  total_vendas,
}: {
  import_id: string;
  loja_codigo: string;
  periodo_label: string;
  total_vendas: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function confirmar() {
    setErro(null);
    const msg = `Apagar import ${loja_codigo} (${periodo_label})?\n\nIsso vai remover ${total_vendas} movimento(s) de venda do ledger e atualizar o estoque atual. Aliases criados manualmente para resolver órfãos serão preservados.\n\nEsta ação não pode ser desfeita.`;
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      const r = await apagarImportAction(import_id);
      if (!r.ok) {
        setErro(r.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={confirmar}
        disabled={pending}
        className="text-[13px] text-muted hover:text-error disabled:opacity-50 whitespace-nowrap"
        title="Apagar este import e seus movimentos"
      >
        {pending ? "Apagando…" : "Apagar"}
      </button>
      {erro && (
        <div className="absolute right-0 mt-1 bg-[#fef2f2] border border-[#fecaca] rounded px-2 py-1 text-[11px] text-error whitespace-nowrap">
          {erro}
        </div>
      )}
    </>
  );
}
