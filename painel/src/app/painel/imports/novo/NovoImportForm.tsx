"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { criarImport, type NovoImportState } from "./actions";

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function NovoImportForm() {
  const [state, formAction] = useActionState<NovoImportState, FormData>(
    criarImport,
    null,
  );

  if (state && state.ok) {
    return <ResultadoImport state={state} />;
  }

  return (
    <form action={formAction} className="space-y-6">
      <Field
        label="Arquivo CSV do PDV analítico"
        hint="Loja e período são detectados automaticamente do cabeçalho do CSV. Se houver mais de uma loja, é criado 1 import por loja."
      >
        <input
          type="file"
          name="arquivo"
          accept=".csv,text/csv"
          required
          className="block w-full text-[14px] text-body file:mr-4 file:py-2 file:px-4 file:rounded-pill file:border-0 file:text-[14px] file:font-medium file:bg-surface-strong file:text-ink hover:file:bg-hairline cursor-pointer"
        />
      </Field>

      {state && !state.ok && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 text-[14px] text-error">
          <strong className="font-semibold">Erro:</strong> {state.error}
        </div>
      )}

      <div className="flex items-center gap-4 pt-4">
        <SubmitButton />
        <Link href="/painel/imports" className="text-[15px] text-body hover:text-ink">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function ResultadoImport({ state }: { state: Extract<NovoImportState, { ok: true }> }) {
  const totalImports = state.imports.length;
  const sucessos = state.imports.filter((i) => i.result.ok);
  const falhas = state.imports.filter((i) => !i.result.ok);

  return (
    <div className="space-y-6">
      <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl px-5 py-4">
        <p className="text-[15px] text-[#166534]">
          <strong>{state.total_registros.toLocaleString("pt-BR")}</strong> registros
          parseados · período <strong>{dataBR.format(new Date(state.periodo.inicio))}</strong>
          {" "}→ <strong>{dataBR.format(new Date(state.periodo.fim))}</strong> · {totalImports}{" "}
          import{totalImports > 1 ? "s" : ""} criado{totalImports > 1 ? "s" : ""}.
        </p>
      </div>

      {state.lojas_nao_mapeadas.length > 0 && (
        <div className="bg-[#fef3c7] border border-[#fde68a] rounded-lg px-4 py-3 text-[14px] text-[#92400e]">
          <strong>Atenção:</strong> {state.lojas_nao_mapeadas.length} loja(s) presente(s) no
          CSV não estão cadastradas e foram ignoradas:
          <ul className="mt-2 ml-4 list-disc">
            {state.lojas_nao_mapeadas.map((n) => (
              <li key={n} className="font-mono text-[13px]">{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {state.imports.map((entry) => (
          <ResultadoLoja key={entry.loja_codigo} entry={entry} />
        ))}
      </div>

      <div className="flex items-center gap-4 pt-4">
        <Link
          href="/painel/imports"
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors"
        >
          Ver lista de imports
        </Link>
        {sucessos.length > 0 && falhas.length === 0 && (
          <Link href="/painel/imports/novo" className="text-[15px] text-body hover:text-ink">
            Importar outro CSV
          </Link>
        )}
      </div>
    </div>
  );
}

function ResultadoLoja({ entry }: { entry: { loja_codigo: string; loja_nome: string; result: import("@/lib/import-vendas").ImportResult } }) {
  const { result } = entry;
  if (!result.ok) {
    return (
      <div className="bg-surface-card border border-[#fecaca] rounded-xl px-5 py-4">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="font-mono text-[14px] text-ink font-medium">
            {entry.loja_codigo}
          </span>
          <span className="text-[13px] text-muted">{entry.loja_nome}</span>
        </div>
        <p className="text-[13px] text-error">Erro: {result.error}</p>
        {result.duplicados && result.duplicados.length > 0 && (
          <ul className="mt-2 ml-4 list-disc text-[12px] text-error">
            {result.duplicados.map((d) => (
              <li key={d.id}>
                <Link href={`/painel/imports/${d.id}`} className="underline">
                  Import {d.id.slice(0, 8)}…
                </Link>{" "}
                ({d.status})
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <Link
      href={`/painel/imports/${result.import_id}`}
      className="block bg-surface-card border border-hairline rounded-xl px-5 py-4 hover:border-ink transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[14px] text-ink font-medium">
            {entry.loja_codigo}
          </span>
          <span className="text-[13px] text-muted">{entry.loja_nome}</span>
        </div>
        <StatusBadge status={result.status} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-[13px]">
        <Stat label="Aplicados" value={result.aplicados} tone="ok" />
        <Stat label="Trocas/qtd 0" value={result.ignoradas} />
        <Stat label="Duplicados" value={result.duplicados} />
        <Stat
          label="Órfãos"
          value={result.orfaos}
          tone={result.orfaos > 0 ? "warn" : undefined}
        />
        <Stat label="Movimentos" value={result.movimentos} />
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "ok" ? "text-[#15803d]" : tone === "warn" ? "text-error" : "text-ink";
  return (
    <div>
      <div className="caption-uppercase text-muted">{label}</div>
      <div className={`mt-0.5 text-[15px] font-medium ${color}`}>
        {value.toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "concluido" | "aguardando_resolucao" }) {
  const map = {
    concluido: { label: "Concluído", tone: "bg-[#dcfce7] text-[#15803d]" },
    aguardando_resolucao: { label: "Aguardando órfãos", tone: "bg-[#fef3c7] text-[#92400e]" },
  };
  const { label, tone } = map[status];
  return (
    <span className={`caption-uppercase rounded-pill px-2 py-0.5 ${tone}`}>{label}</span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="caption-uppercase text-muted block mb-2">{label}</span>
      {children}
      {hint && <span className="block mt-1.5 text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-6 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Processando…" : "Importar"}
    </button>
  );
}
