"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  iniciarContagemAction,
  encerrarContagemAction,
  reabrirContagemAction,
  cancelarContagemAction,
  definirStatusItemAction,
  aprovarTodosAction,
  finalizarContagemAction,
} from "./actions";

export type ItemSessao = {
  produto_id: string;
  sku: string;
  nome: string;
  categoria: string | null;
  custo: number | null;
  qtd_teorica: number;
  qtd_contada: number;
  diferenca: number;
  valor_diferenca: number | null;
  status: "pendente" | "aprovada" | "rejeitada" | "recontar";
};

type Props = {
  sessao_id: string;
  status: "aberta" | "em_contagem" | "em_revisao" | "finalizada" | "cancelada";
  itens: ItemSessao[];
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function SessaoUI({ sessao_id, status, itens }: Props) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const router = useRouter();

  function withAction<T>(fn: () => Promise<{ ok: true } | { ok: false; error: string } | T>) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = (await fn()) as { ok: boolean; error?: string; movimentos?: number };
      if (r.ok === false) {
        setErro(r.error ?? "Erro");
      } else if ("movimentos" in r) {
        setAviso(`Sessão finalizada — ${r.movimentos} movimento(s) gerado(s).`);
        router.refresh();
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <ActionsBar
        status={status}
        pending={pending}
        onIniciar={() => withAction(() => iniciarContagemAction(sessao_id))}
        onEncerrar={() => withAction(() => encerrarContagemAction(sessao_id))}
        onReabrir={() => withAction(() => reabrirContagemAction(sessao_id))}
        onCancelar={() => withAction(() => cancelarContagemAction(sessao_id))}
        onAprovarTodos={() => withAction(() => aprovarTodosAction(sessao_id))}
        onFinalizar={() => withAction(() => finalizarContagemAction(sessao_id))}
      />

      {erro && (
        <div className="mt-4 bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 text-[14px] text-error">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="mt-4 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-4 py-3 text-[14px] text-[#15803d]">
          {aviso}
        </div>
      )}

      <div className="mt-6">
        {status === "aberta" && <AbertaPanel itens={itens} />}
        {status === "em_contagem" && <EmContagemPanel sessao_id={sessao_id} itens={itens} />}
        {(status === "em_revisao" || status === "finalizada" || status === "cancelada") && (
          <RevisaoTable
            sessao_id={sessao_id}
            itens={itens}
            podeAprovar={status === "em_revisao"}
            pending={pending}
            setErro={setErro}
          />
        )}
      </div>
    </div>
  );
}

function AbertaPanel({ itens }: { itens: ItemSessao[] }) {
  const totalTeorica = itens.reduce((acc, i) => acc + i.qtd_teorica, 0);
  const positivos = itens.filter((i) => i.qtd_teorica > 0).length;
  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-6">
      <h2 className="text-[15px] font-medium text-ink mb-3">Escopo congelado</h2>
      <p className="text-[14px] text-body mb-4 leading-[1.5]">
        {itens.length.toLocaleString("pt-BR")} SKUs no escopo · {positivos.toLocaleString("pt-BR")}{" "}
        com saldo positivo · soma teórica {totalTeorica.toLocaleString("pt-BR")} unidades.
      </p>
      <p className="text-[13px] text-muted">
        Quando iniciar, a tela de bipagem fica disponível para o contador.
      </p>
    </div>
  );
}

function EmContagemPanel({
  sessao_id,
  itens,
}: {
  sessao_id: string;
  itens: ItemSessao[];
}) {
  const totalSkus = itens.length;
  const skusBipados = itens.filter((i) => i.qtd_contada > 0).length;
  const totalUnidades = itens.reduce((acc, i) => acc + i.qtd_contada, 0);
  const pct = totalSkus > 0 ? Math.round((skusBipados / totalSkus) * 100) : 0;
  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-6">
      <div className="flex items-start justify-between gap-6 mb-5">
        <div>
          <h2 className="text-[15px] font-medium text-ink mb-1">Em andamento</h2>
          <p className="text-[13px] text-muted">
            Os contadores não veem a quantidade teórica — apenas o que já bipou.
          </p>
        </div>
        <Link
          href={`/painel/contagens/${sessao_id}/contar`}
          className="inline-flex items-center justify-center bg-ink text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors whitespace-nowrap"
        >
          Abrir modo contagem →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <Counter label="SKUs bipados" value={skusBipados} />
        <Counter label="No escopo" value={totalSkus} />
        <Counter label="Unidades contadas" value={totalUnidades} tone="ok" />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-surface-strong rounded-pill overflow-hidden">
          <div className="h-full bg-ink rounded-pill transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[13px] text-muted whitespace-nowrap">{pct}%</span>
      </div>
    </div>
  );
}

function ActionsBar({
  status,
  pending,
  onIniciar,
  onEncerrar,
  onReabrir,
  onCancelar,
  onAprovarTodos,
  onFinalizar,
}: {
  status: Props["status"];
  pending: boolean;
  onIniciar: () => void;
  onEncerrar: () => void;
  onReabrir: () => void;
  onCancelar: () => void;
  onAprovarTodos: () => void;
  onFinalizar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "aberta" && (
        <>
          <PrimaryBtn onClick={onIniciar} disabled={pending}>Iniciar contagem</PrimaryBtn>
          <SecondaryBtn onClick={onCancelar} disabled={pending}>Cancelar sessão</SecondaryBtn>
        </>
      )}
      {status === "em_contagem" && (
        <>
          <PrimaryBtn onClick={onEncerrar} disabled={pending}>Encerrar contagem</PrimaryBtn>
          <SecondaryBtn onClick={onCancelar} disabled={pending}>Cancelar sessão</SecondaryBtn>
        </>
      )}
      {status === "em_revisao" && (
        <>
          <PrimaryBtn onClick={onFinalizar} disabled={pending}>Finalizar e aplicar</PrimaryBtn>
          <SecondaryBtn onClick={onAprovarTodos} disabled={pending}>Aprovar todos</SecondaryBtn>
          <SecondaryBtn onClick={onReabrir} disabled={pending}>Voltar para contagem</SecondaryBtn>
        </>
      )}
      {(status === "finalizada" || status === "cancelada") && (
        <p className="text-[13px] text-muted">Sessão {status === "finalizada" ? "finalizada" : "cancelada"} — readonly.</p>
      )}
    </div>
  );
}

function RevisaoTable({
  sessao_id,
  itens,
  podeAprovar,
  pending,
  setErro,
}: {
  sessao_id: string;
  itens: ItemSessao[];
  podeAprovar: boolean;
  pending: boolean;
  setErro: (e: string | null) => void;
}) {
  const router = useRouter();
  const [actingOn, setActingOn] = useState<string | null>(null);
  const aprovados = itens.filter((i) => i.status === "aprovada").length;
  const rejeitados = itens.filter((i) => i.status === "rejeitada").length;
  const recontar = itens.filter((i) => i.status === "recontar").length;
  const pendentes = itens.filter((i) => i.status === "pendente").length;

  function setStatus(produto_id: string, status: ItemSessao["status"]) {
    setErro(null);
    setActingOn(produto_id);
    void (async () => {
      const r = await definirStatusItemAction(sessao_id, produto_id, status);
      if (!r.ok) setErro(r.error);
      router.refresh();
      setActingOn(null);
    })();
  }

  return (
    <div>
      {podeAprovar && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Counter label="Pendente" value={pendentes} />
          <Counter label="Aprovado" value={aprovados} tone="ok" />
          <Counter label="Recontar" value={recontar} tone="warn" />
          <Counter label="Rejeitado" value={rejeitados} tone="muted" />
        </div>
      )}

      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-5 py-3">SKU</th>
              <th className="text-left px-5 py-3">Produto</th>
              <th className="text-right px-5 py-3">Teórica</th>
              <th className="text-right px-5 py-3">Contada</th>
              <th className="text-right px-5 py-3">Diferença</th>
              <th className="text-right px-5 py-3">Valor</th>
              {podeAprovar && <th className="text-right px-5 py-3">Ação</th>}
              {!podeAprovar && <th className="text-right px-5 py-3">Status</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {itens.map((i) => {
              const diffColor =
                i.diferenca < 0 ? "text-error" : i.diferenca > 0 ? "text-[#15803d]" : "text-muted";
              return (
                <tr key={i.produto_id} className="hover:bg-canvas-soft">
                  <td className="px-5 py-3 font-mono text-[13px] text-body-strong">{i.sku}</td>
                  <td className="px-5 py-3 text-[13px] text-ink">
                    <div className="truncate max-w-[420px]">{i.nome}</div>
                    {i.categoria && (
                      <div className="text-[11px] text-muted">{i.categoria}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] text-body">
                    {i.qtd_teorica}
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] text-ink font-medium">
                    {i.qtd_contada}
                  </td>
                  <td className={`px-5 py-3 text-right text-[13px] font-medium ${diffColor}`}>
                    {i.diferenca > 0 ? "+" : ""}{i.diferenca}
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] text-body">
                    {i.valor_diferenca != null
                      ? moedaBR.format(i.valor_diferenca)
                      : i.custo != null
                        ? moedaBR.format(i.diferenca * i.custo)
                        : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {podeAprovar ? (
                      <ItemActions
                        status={i.status}
                        disabled={pending || actingOn === i.produto_id}
                        onAprovar={() => setStatus(i.produto_id, "aprovada")}
                        onRecontar={() => setStatus(i.produto_id, "recontar")}
                        onRejeitar={() => setStatus(i.produto_id, "rejeitada")}
                      />
                    ) : (
                      <StatusBadge status={i.status} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemActions({
  status,
  disabled,
  onAprovar,
  onRecontar,
  onRejeitar,
}: {
  status: ItemSessao["status"];
  disabled: boolean;
  onAprovar: () => void;
  onRecontar: () => void;
  onRejeitar: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <ActionBtn
        active={status === "aprovada"}
        tone="ok"
        disabled={disabled}
        onClick={onAprovar}
        label="Aprovar"
      >
        ✓
      </ActionBtn>
      <ActionBtn
        active={status === "recontar"}
        tone="warn"
        disabled={disabled}
        onClick={onRecontar}
        label="Recontar"
      >
        ↻
      </ActionBtn>
      <ActionBtn
        active={status === "rejeitada"}
        tone="muted"
        disabled={disabled}
        onClick={onRejeitar}
        label="Rejeitar"
      >
        ✗
      </ActionBtn>
    </div>
  );
}

function ActionBtn({
  active,
  tone,
  disabled,
  onClick,
  label,
  children,
}: {
  active: boolean;
  tone: "ok" | "warn" | "muted";
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const styles = active
    ? {
        ok: "bg-[#dcfce7] text-[#15803d] border-[#15803d]",
        warn: "bg-[#fef3c7] text-[#92400e] border-[#92400e]",
        muted: "bg-surface-strong text-ink border-ink",
      }[tone]
    : "bg-surface-card text-muted border-hairline hover:border-ink hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md border text-[14px] transition-colors disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: ItemSessao["status"] }) {
  const map = {
    pendente: { label: "Pendente", tone: "bg-surface-strong text-muted" },
    aprovada: { label: "Aprovada", tone: "bg-[#dcfce7] text-[#15803d]" },
    rejeitada: { label: "Rejeitada", tone: "bg-surface-strong text-muted" },
    recontar: { label: "Recontar", tone: "bg-[#fef3c7] text-[#92400e]" },
  };
  const { label, tone } = map[status];
  return (
    <span className={`caption-uppercase rounded-pill px-2 py-0.5 ${tone}`}>{label}</span>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "muted";
}) {
  const valueColor =
    tone === "ok" ? "text-[#15803d]" : tone === "warn" ? "text-[#92400e]" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="bg-surface-card border border-hairline rounded-lg px-4 py-3">
      <div className="caption-uppercase text-muted">{label}</div>
      <div className={`mt-1 text-[20px] font-medium ${valueColor}`}>{value}</div>
    </div>
  );
}

function PrimaryBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function SecondaryBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center bg-surface-card border border-hairline-strong text-ink rounded-pill h-10 px-5 text-[15px] font-medium hover:border-ink transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
