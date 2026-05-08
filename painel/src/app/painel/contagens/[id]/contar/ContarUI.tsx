"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  biparAction,
  editarQuantidadeAction,
  type BipResult,
} from "../actions";

export type ItemContado = {
  produto_id: string;
  sku: string;
  nome: string;
  qtd_contada: number;
};

export function ContarUI({
  sessao_id,
  itensContados,
}: {
  sessao_id: string;
  itensContados: ItemContado[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { tipo: "ok"; sku: string; nome: string; qtd: number }
    | { tipo: "erro"; msg: string }
    | null
  >(null);
  const [editando, setEditando] = useState<string | null>(null);
  // Por padrao, aceita apenas EAN (dígitos). Quando ativado, aceita SKU
  // tambem — útil pra produtos cuja etiqueta nao bipou ou nao tem EAN
  // cadastrado. Estado de sessao da bipagem (nao persiste).
  const [permitirSku, setPermitirSku] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mantem o foco no input sempre que possivel (apos refresh, apos bipagem, etc.)
  // Nao rouba foco enquanto estiver editando uma linha.
  useEffect(() => {
    if (editando) return;
    const i = inputRef.current;
    if (!i) return;
    if (document.activeElement === i) return;
    // Se o foco esta em algum input/button (ex: usuario clicou em algo), respeita
    const ae = document.activeElement;
    if (ae && ae !== document.body && (ae.tagName === "INPUT" || ae.tagName === "BUTTON" || ae.tagName === "TEXTAREA")) {
      return;
    }
    i.focus();
  });

  function bipar(codigo: string) {
    const limpo = codigo.trim();
    if (!limpo) return;
    // Por padrao so aceita EAN (digitos) — toggle "Aceitar SKU" libera
    // entrada alfanumerica para casos onde o produto nao tem EAN cadastrado
    // ou a etiqueta nao funcionou. Edicao de quantidade continua na lista.
    if (!permitirSku && !/^\d+$/.test(limpo)) {
      setFeedback({
        tipo: "erro",
        msg: "Use o leitor de código de barras (EAN) — ou ative \"Aceitar SKU\" no canto direito.",
      });
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    startTransition(async () => {
      const r: BipResult = await biparAction(sessao_id, limpo);
      if (r.ok) {
        setFeedback({ tipo: "ok", sku: r.sku, nome: r.nome, qtd: r.qtd_contada });
      } else {
        setFeedback({ tipo: "erro", msg: r.error });
      }
      router.refresh();
      // Volta o foco pra continuar bipando
      setTimeout(() => inputRef.current?.focus(), 0);
    });
  }

  function editar(produto_id: string, qtd_nova: number) {
    setEditando(produto_id);
    void (async () => {
      const r = await editarQuantidadeAction(sessao_id, produto_id, qtd_nova);
      if (!r.ok) setFeedback({ tipo: "erro", msg: r.error });
      router.refresh();
      setEditando(null);
      // Volta o foco para o input principal apos editar
      setTimeout(() => inputRef.current?.focus(), 0);
    })();
  }

  return (
    <div className="space-y-6">
      <BipForm
        onSubmit={bipar}
        pending={pending}
        inputRef={inputRef}
        permitirSku={permitirSku}
        onTogglePermitirSku={(v) => setPermitirSku(v)}
      />

      {feedback && (
        <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <ListaContados
        itens={itensContados}
        editando={editando}
        onEditar={editar}
      />
    </div>
  );
}

function BipForm({
  onSubmit,
  pending,
  inputRef,
  permitirSku,
  onTogglePermitirSku,
}: {
  onSubmit: (codigo: string) => void;
  pending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  permitirSku: boolean;
  onTogglePermitirSku: (v: boolean) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const codigo = fd.get("codigo") as string;
        onSubmit(codigo);
        e.currentTarget.reset();
      }}
      className="bg-surface-card border border-hairline rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-3 gap-3">
        <label htmlFor="codigo" className="caption-uppercase text-muted">
          {permitirSku ? "Bipar código ou SKU" : "Bipar código de barras (EAN)"}
        </label>
        <label className="inline-flex items-center gap-2 text-[12px] text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={permitirSku}
            onChange={(e) => onTogglePermitirSku(e.target.checked)}
            className="accent-ink h-3.5 w-3.5"
          />
          Aceitar SKU
        </label>
      </div>
      <div className="flex gap-3">
        <input
          ref={inputRef}
          id="codigo"
          name="codigo"
          type="text"
          autoFocus
          autoComplete="off"
          inputMode={permitirSku ? "text" : "numeric"}
          pattern={permitirSku ? undefined : "[0-9]*"}
          placeholder={
            permitirSku
              ? "Bipa, digita SKU ou EAN…"
              : "Use o leitor de código de barras…"
          }
          disabled={pending}
          className="flex-1 bg-canvas-soft border border-hairline-strong rounded-md px-4 py-3 text-[16px] text-ink placeholder:text-muted focus:border-ink focus:bg-surface-card focus:outline-none font-mono"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-12 px-6 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60"
        >
          {pending ? "…" : "+1"}
        </button>
      </div>
      <p className="mt-3 text-[12px] text-muted">
        {permitirSku
          ? "Aceita EAN ou SKU. Cada bipagem soma +1 unidade."
          : "Apenas EAN é aceito — bipe com leitor USB. Cada bipagem soma +1 unidade."}
      </p>
    </form>
  );
}

function FeedbackBanner({
  feedback,
  onDismiss,
}: {
  feedback:
    | { tipo: "ok"; sku: string; nome: string; qtd: number }
    | { tipo: "erro"; msg: string };
  onDismiss: () => void;
}) {
  if (feedback.tipo === "erro") {
    return (
      <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 flex items-start justify-between gap-3">
        <p className="text-[14px] text-error">
          <strong className="font-semibold">Erro:</strong> {feedback.msg}
        </p>
        <button onClick={onDismiss} className="text-error/60 hover:text-error text-[18px] leading-none">
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-0.5">
          <span className="font-mono text-[14px] text-[#15803d] font-semibold">
            {feedback.sku}
          </span>
          <span className="caption-uppercase text-[#15803d]">qtd: {feedback.qtd}</span>
        </div>
        <p className="text-[13px] text-[#166534] truncate">{feedback.nome}</p>
      </div>
      <button onClick={onDismiss} className="text-[#15803d]/60 hover:text-[#15803d] text-[18px] leading-none">
        ×
      </button>
    </div>
  );
}

function ListaContados({
  itens,
  editando,
  onEditar,
}: {
  itens: ItemContado[];
  editando: string | null;
  onEditar: (produto_id: string, qtd: number) => void;
}) {
  if (itens.length === 0) {
    return (
      <div className="bg-surface-card border border-hairline rounded-xl p-12 text-center">
        <p className="text-muted text-[14px]">
          Nenhum item contado ainda. Bipe o primeiro código acima.
        </p>
      </div>
    );
  }

  const totalUnidades = itens.reduce((acc, i) => acc + i.qtd_contada, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="caption-uppercase text-muted">Contados</h2>
        <p className="text-[13px] text-body">
          <strong className="text-ink">{itens.length}</strong> SKUs ·{" "}
          <strong className="text-ink">{totalUnidades}</strong> unidades
        </p>
      </div>
      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-32" />
            <col />
            <col className="w-24" />
            <col className="w-36" />
          </colgroup>
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-5 py-3">SKU</th>
              <th className="text-left px-5 py-3">Produto</th>
              <th className="text-right px-5 py-3">Qtd</th>
              <th className="text-right px-5 py-3">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {itens.map((i) => (
              <Linha
                key={i.produto_id}
                item={i}
                pending={editando === i.produto_id}
                onEditar={(qtd) => onEditar(i.produto_id, qtd)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Linha({
  item,
  pending,
  onEditar,
}: {
  item: ItemContado;
  pending: boolean;
  onEditar: (qtd: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [valor, setValor] = useState(item.qtd_contada);

  if (editing) {
    return (
      <tr className="bg-canvas-soft">
        <td className="px-5 py-3 font-mono text-[13px] text-body-strong truncate">{item.sku}</td>
        <td className="px-5 py-3 text-[13px] text-ink">
          <div className="truncate">{item.nome}</div>
        </td>
        <td className="px-5 py-3 text-right">
          <input
            type="number"
            min={0}
            value={valor}
            onChange={(e) => setValor(Math.max(0, Number(e.target.value) || 0))}
            autoFocus
            disabled={pending}
            className="w-24 text-right bg-surface-card border border-ink rounded-md px-2 py-1.5 text-[13px] text-ink focus:outline-none"
          />
        </td>
        <td className="px-5 py-3 text-right">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onEditar(valor);
                setEditing(false);
              }}
              disabled={pending}
              className="text-[12px] text-ink hover:underline"
            >
              Salvar
            </button>
            <span className="text-muted">·</span>
            <button
              type="button"
              onClick={() => {
                setValor(item.qtd_contada);
                setEditing(false);
              }}
              className="text-[12px] text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-canvas-soft">
      <td className="px-5 py-3 font-mono text-[13px] text-body-strong truncate">{item.sku}</td>
      <td className="px-5 py-3 text-[13px] text-ink" title={item.nome}>
        <div className="truncate">{item.nome}</div>
      </td>
      <td className="px-5 py-3 text-right text-[13px] text-ink font-medium">
        {item.qtd_contada}
      </td>
      <td className="px-5 py-3 text-right">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[12px] text-body hover:text-ink"
        >
          Editar
        </button>
      </td>
    </tr>
  );
}
