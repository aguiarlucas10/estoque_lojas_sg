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
  fazerBalancoAction,
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
  totalEscopo: number;
  isAdmin: boolean;
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function SessaoUI({ sessao_id, status, itens, totalEscopo, isAdmin }: Props) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const router = useRouter();

  function withAction<T>(fn: () => Promise<{ ok: true } | { ok: false; error: string } | T>) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = (await fn()) as { ok: boolean; error?: string; movimentos?: number; aprovados?: number };
      if (r.ok === false) {
        setErro(r.error ?? "Erro");
      } else if ("movimentos" in r) {
        const aprov = r.aprovados ?? 0;
        const movs = r.movimentos ?? 0;
        setAviso(
          `Balanço aplicado — ${aprov} item(ns) aprovado(s), ${movs} movimento(s) gerado(s) no estoque.`,
        );
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
        isAdmin={isAdmin}
        onIniciar={() => withAction(() => iniciarContagemAction(sessao_id))}
        onEncerrar={() => withAction(() => encerrarContagemAction(sessao_id))}
        onReabrir={() => withAction(() => reabrirContagemAction(sessao_id))}
        onCancelar={() => withAction(() => cancelarContagemAction(sessao_id))}
        onFazerBalanco={() => withAction(() => fazerBalancoAction(sessao_id))}
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
        {status === "aberta" && <AbertaPanel totalEscopo={totalEscopo} />}
        {status === "em_contagem" && (
          <EmContagemPanel
            sessao_id={sessao_id}
            itens={itens}
            totalEscopo={totalEscopo}
          />
        )}
        {(status === "em_revisao" || status === "finalizada" || status === "cancelada") && (
          <RevisaoTable
            sessao_id={sessao_id}
            itens={itens}
            podeAprovar={status === "em_revisao" && isAdmin}
            isAdmin={isAdmin}
            pending={pending}
            setErro={setErro}
          />
        )}
      </div>
    </div>
  );
}

function AbertaPanel({ totalEscopo }: { totalEscopo: number }) {
  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-6">
      <h2 className="text-[15px] font-medium text-ink mb-3">Escopo congelado</h2>
      <p className="text-[14px] text-body mb-4 leading-[1.5]">
        {totalEscopo.toLocaleString("pt-BR")} SKUs no escopo. Ao iniciar, a tela de
        bipagem fica disponível para o contador.
      </p>
      <p className="text-[13px] text-muted">
        A contagem não altera o estoque — só o admin pode aplicar via &quot;Fazer
        balanço&quot; no fim.
      </p>
    </div>
  );
}

function EmContagemPanel({
  sessao_id,
  itens,
  totalEscopo,
}: {
  sessao_id: string;
  itens: ItemSessao[];
  totalEscopo: number;
}) {
  const skusBipados = itens.length; // a query já trouxe só os bipados
  const totalUnidades = itens.reduce((acc, i) => acc + i.qtd_contada, 0);
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

      <div className="grid grid-cols-3 gap-4">
        <Counter label="SKUs bipados" value={skusBipados} />
        <Counter label="No escopo" value={totalEscopo} />
        <Counter label="Unidades contadas" value={totalUnidades} tone="ok" />
      </div>
    </div>
  );
}

function ActionsBar({
  status,
  pending,
  isAdmin,
  onIniciar,
  onEncerrar,
  onReabrir,
  onCancelar,
  onFazerBalanco,
}: {
  status: Props["status"];
  pending: boolean;
  isAdmin: boolean;
  onIniciar: () => void;
  onEncerrar: () => void;
  onReabrir: () => void;
  onCancelar: () => void;
  onFazerBalanco: () => void;
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
      {status === "em_revisao" && isAdmin && (
        <>
          <PrimaryBtn onClick={onFazerBalanco} disabled={pending}>
            Fazer balanço — aplicar no estoque
          </PrimaryBtn>
          <SecondaryBtn onClick={onReabrir} disabled={pending}>
            Voltar para contagem
          </SecondaryBtn>
        </>
      )}
      {status === "em_revisao" && !isAdmin && (
        <>
          <Link
            href="/painel/contagens"
            className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors"
          >
            Finalizar contagem
          </Link>
          <SecondaryBtn onClick={onReabrir} disabled={pending}>
            Voltar para contagem
          </SecondaryBtn>
          <p className="text-[13px] text-muted ml-2">
            O admin vai revisar e aplicar o balanço no estoque.
          </p>
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
  isAdmin,
  pending,
  setErro,
}: {
  sessao_id: string;
  itens: ItemSessao[];
  podeAprovar: boolean;
  isAdmin: boolean;
  pending: boolean;
  setErro: (e: string | null) => void;
}) {
  const router = useRouter();
  const [actingOn, setActingOn] = useState<string | null>(null);

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

  if (!isAdmin) {
    // Visão da loja: cega — sem teórica, sem diferença, sem valor, sem ação por linha.
    return (
      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-5 py-3">SKU</th>
              <th className="text-left px-5 py-3">Produto</th>
              <th className="text-right px-5 py-3">Contada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {itens.map((i) => (
              <tr key={i.produto_id} className="hover:bg-canvas-soft">
                <td className="px-5 py-3 font-mono text-[13px] text-body-strong">{i.sku}</td>
                <td className="px-5 py-3 text-[13px] text-ink">
                  <div className="truncate max-w-[600px]" title={i.nome}>{i.nome}</div>
                  {i.categoria && (
                    <div className="text-[11px] text-muted">{i.categoria}</div>
                  )}
                </td>
                <td className="px-5 py-3 text-right text-[13px] text-ink font-medium">
                  {i.qtd_contada}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Visão do admin: tudo (teórica, diferença, valor, ações por linha)
  const aprovados = itens.filter((i) => i.status === "aprovada").length;
  const rejeitados = itens.filter((i) => i.status === "rejeitada").length;
  const recontar = itens.filter((i) => i.status === "recontar").length;
  const pendentes = itens.filter((i) => i.status === "pendente").length;

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
