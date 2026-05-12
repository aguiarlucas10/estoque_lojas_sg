"use client";

import { useState } from "react";
import { NovoRecebimentoUI } from "./NovoRecebimento";
import { LancamentoManual } from "./LancamentoManual";

type Loja = { codigo: string; nome: string };

export function TabsNovoRecebimento({ lojas }: { lojas: Loja[] }) {
  const [tab, setTab] = useState<"pdf" | "manual">("pdf");

  return (
    <div>
      <div className="inline-flex bg-surface-card border border-hairline rounded-pill p-1 mb-6">
        <TabBtn ativo={tab === "pdf"} onClick={() => setTab("pdf")}>
          A partir de PDF
        </TabBtn>
        <TabBtn ativo={tab === "manual"} onClick={() => setTab("manual")}>
          Lançamento manual
        </TabBtn>
      </div>

      {tab === "pdf" && <NovoRecebimentoUI lojas={lojas} />}
      {tab === "manual" && <LancamentoManual lojas={lojas} />}
    </div>
  );
}

function TabBtn({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-pill text-[14px] font-medium transition-colors ${
        ativo
          ? "bg-primary text-on-primary"
          : "text-body hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
