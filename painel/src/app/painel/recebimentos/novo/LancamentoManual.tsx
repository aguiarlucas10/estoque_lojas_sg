"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  resolverProdutoAction,
  buscarProdutos,
  confirmarRecebimentoAction,
} from "./actions";

type Loja = { codigo: string; nome: string };
type Produto = { id: string; sku: string; nome: string; custo: number | null };

type LinhaManual = {
  produto_id: string;
  sku: string;
  nome: string;
  qtd: number;
  custo_unitario: number;
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function LancamentoManual({ lojas }: { lojas: Loja[] }) {
  const [itens, setItens] = useState<LinhaManual[]>([]);
  const [codigo, setCodigo] = useState("");
  const [feedback, setFeedback] = useState<
    | { tipo: "ok"; msg: string }
    | { tipo: "erro"; msg: string }
    | { tipo: "ambiguo"; candidatos: Produto[]; codigo: string }
    | null
  >(null);
  const [pendingBip, startBip] = useTransition();
  const [lojaCodigo, setLojaCodigo] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [nfNumero, setNfNumero] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erroFinal, setErroFinal] = useState<string | null>(null);
  const [pendingConfirm, startConfirm] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Mantém o foco no input de bipagem
  useEffect(() => {
    const i = inputRef.current;
    if (!i) return;
    const ae = document.activeElement;
    if (
      ae &&
      ae !== document.body &&
      (ae.tagName === "INPUT" || ae.tagName === "BUTTON" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")
    ) {
      return;
    }
    i.focus();
  });

  function adicionarProduto(p: Produto) {
    setItens((arr) => {
      const idx = arr.findIndex((l) => l.produto_id === p.id);
      if (idx >= 0) {
        // Já existe na lista: incrementa qtd
        return arr.map((l, i) =>
          i === idx ? { ...l, qtd: l.qtd + 1 } : l,
        );
      }
      return [
        ...arr,
        {
          produto_id: p.id,
          sku: p.sku,
          nome: p.nome,
          qtd: 1,
          custo_unitario: p.custo ?? 0,
        },
      ];
    });
    setCodigo("");
    setFeedback({ tipo: "ok", msg: `+1 ${p.sku}` });
  }

  function bipar(cod: string) {
    if (!cod.trim()) return;
    startBip(async () => {
      const r = await resolverProdutoAction(cod);
      if (!r.ok) {
        setFeedback({ tipo: "erro", msg: r.error });
        return;
      }
      if (r.produto) {
        adicionarProduto(r.produto);
        return;
      }
      if (r.candidatos.length === 0) {
        setFeedback({
          tipo: "erro",
          msg: `Código "${cod}" não encontrado.`,
        });
        return;
      }
      // Múltiplos candidatos: mostra escolha
      setFeedback({ tipo: "ambiguo", candidatos: r.candidatos, codigo: cod });
    });
  }

  function setQtd(idx: number, qtd: number) {
    setItens((arr) =>
      arr.map((l, i) =>
        i === idx ? { ...l, qtd: Math.max(0, qtd) } : l,
      ),
    );
  }
  function setCusto(idx: number, custo: number) {
    setItens((arr) =>
      arr.map((l, i) =>
        i === idx ? { ...l, custo_unitario: Math.max(0, custo) } : l,
      ),
    );
  }
  function remover(idx: number) {
    setItens((arr) => arr.filter((_, i) => i !== idx));
  }

  const totalQtd = itens.reduce((acc, l) => acc + l.qtd, 0);
  const totalValor = itens.reduce((acc, l) => acc + l.qtd * l.custo_unitario, 0);

  function confirmar() {
    setErroFinal(null);
    if (!lojaCodigo) {
      setErroFinal("Selecione a loja destino.");
      return;
    }
    if (itens.length === 0) {
      setErroFinal("Adicione pelo menos 1 item.");
      return;
    }
    const itensInvalidos = itens.filter((l) => l.qtd <= 0);
    if (itensInvalidos.length > 0) {
      setErroFinal("Há item(ns) com quantidade zero. Ajuste ou remova.");
      return;
    }
    startConfirm(async () => {
      const r = await confirmarRecebimentoAction({
        loja_codigo: lojaCodigo,
        fornecedor: fornecedor.trim() || null,
        nf_numero: nfNumero.trim() || null,
        observacao: observacao.trim() || null,
        itens: itens.map((l) => ({
          produto_id: l.produto_id,
          qtd: l.qtd,
          custo_unitario: l.custo_unitario,
        })),
      });
      if (!r.ok) setErroFinal(r.error);
      // sucesso: action faz redirect
    });
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface-card border border-hairline rounded-xl p-5">
        <label htmlFor="codigo-manual" className="caption-uppercase text-muted block mb-3">
          Adicionar produto
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            bipar(codigo);
          }}
          className="flex gap-3"
        >
          <input
            ref={inputRef}
            id="codigo-manual"
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoFocus
            autoComplete="off"
            placeholder="Bipa EAN, digita SKU ou parte dele…"
            disabled={pendingBip}
            className="flex-1 bg-canvas-soft border border-hairline-strong rounded-md px-4 py-3 text-[15px] text-ink placeholder:text-muted focus:border-ink focus:bg-surface-card focus:outline-none font-mono"
          />
          <button
            type="submit"
            disabled={pendingBip}
            className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-12 px-6 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60"
          >
            {pendingBip ? "…" : "+1"}
          </button>
          <BuscarBotao onEscolher={adicionarProduto} />
        </form>
        <p className="mt-2.5 text-[12px] text-muted">
          Cada bipagem adiciona 1 unidade. Se já estiver na lista, soma. Edite
          quantidade e custo na tabela.
        </p>

        {feedback && (
          <div className="mt-3">
            {feedback.tipo === "ok" && (
              <span className="text-[13px] text-[#15803d]">{feedback.msg}</span>
            )}
            {feedback.tipo === "erro" && (
              <span className="text-[13px] text-error">{feedback.msg}</span>
            )}
            {feedback.tipo === "ambiguo" && (
              <div className="mt-2 border border-hairline-soft rounded-md bg-canvas-soft p-3">
                <p className="text-[12px] text-muted mb-2">
                  Múltiplos produtos batem com &quot;{feedback.codigo}&quot;:
                </p>
                <div className="space-y-1">
                  {feedback.candidatos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => adicionarProduto(p)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-surface-card border border-hairline rounded-md hover:border-ink text-left text-[13px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-ink">{p.sku}</div>
                        <div className="text-muted text-[12px] truncate">{p.nome}</div>
                      </div>
                      <span className="text-ink">+1 →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabela de itens */}
      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Produto</th>
              <th className="text-right px-4 py-3 w-24">Qtd</th>
              <th className="text-right px-4 py-3 w-32">Custo un.</th>
              <th className="text-right px-4 py-3 w-32">Subtotal</th>
              <th className="text-right px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {itens.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted text-[13px]">
                  Nenhum produto adicionado ainda. Bipa o primeiro acima.
                </td>
              </tr>
            )}
            {itens.map((l, idx) => (
              <tr key={l.produto_id} className="hover:bg-canvas-soft">
                <td className="px-4 py-3 font-mono text-[12px] text-body-strong">{l.sku}</td>
                <td className="px-4 py-3 text-[13px] text-ink">
                  <div className="truncate max-w-[440px]">{l.nome}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <input
                    type="number"
                    min={1}
                    value={l.qtd}
                    onChange={(e) => setQtd(idx, Number(e.target.value) || 0)}
                    className="w-16 text-right bg-canvas-soft border border-hairline rounded-md px-2 py-1 text-[13px] focus:border-ink focus:bg-surface-card focus:outline-none"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.custo_unitario}
                    onChange={(e) => setCusto(idx, Number(e.target.value) || 0)}
                    className="w-24 text-right bg-canvas-soft border border-hairline rounded-md px-2 py-1 text-[13px] focus:border-ink focus:bg-surface-card focus:outline-none"
                  />
                </td>
                <td className="px-4 py-3 text-right text-[13px] text-body">
                  {moedaBR.format(l.qtd * l.custo_unitario)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => remover(idx)}
                    className="text-[14px] text-muted hover:text-error"
                    title="Remover"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {itens.length > 0 && (
            <tfoot className="bg-surface-strong border-t border-hairline">
              <tr>
                <td colSpan={2} className="px-4 py-3 caption-uppercase text-muted">
                  Total
                </td>
                <td className="px-4 py-3 text-right text-[14px] text-ink font-medium">
                  {totalQtd}
                </td>
                <td></td>
                <td className="px-4 py-3 text-right text-[14px] text-ink font-medium">
                  {moedaBR.format(totalValor)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Cabeçalho do recebimento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Loja destino">
          <select
            value={lojaCodigo}
            onChange={(e) => setLojaCodigo(e.target.value)}
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[15px] text-ink focus:border-ink focus:outline-none"
          >
            <option value="">Selecione…</option>
            {lojas.map((l) => (
              <option key={l.codigo} value={l.codigo}>
                {l.codigo} — {l.nome}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nº do pedido ou NF (opcional)">
          <input
            type="text"
            value={nfNumero}
            onChange={(e) => setNfNumero(e.target.value)}
            placeholder="ex: 905163"
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Fornecedor (opcional)">
          <input
            type="text"
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
            placeholder="ex: Saint Germain Distribuição"
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Observação (opcional)">
          <input
            type="text"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex: reposição avulsa"
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] focus:border-ink focus:outline-none"
          />
        </Field>
      </div>

      {erroFinal && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 text-[14px] text-error">
          {erroFinal}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={confirmar}
          disabled={pendingConfirm || itens.length === 0 || !lojaCodigo}
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pendingConfirm ? "Salvando…" : "Confirmar recebimento"}
        </button>
        <Link href="/painel/recebimentos" className="text-[14px] text-body hover:text-ink">
          Cancelar
        </Link>
      </div>
    </div>
  );
}

function BuscarBotao({ onEscolher }: { onEscolher: (p: Produto) => void }) {
  const [aberto, setAberto] = useState(false);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Produto[]>([]);
  const [pending, startTransition] = useTransition();

  async function buscar(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    startTransition(async () => {
      const r = await buscarProdutos(q);
      setResultados(r);
    });
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center justify-center bg-surface-card border border-hairline-strong rounded-pill h-12 px-4 text-[14px] text-body hover:border-ink hover:text-ink transition-colors"
      >
        Buscar por nome
      </button>
    );
  }
  return (
    <div className="absolute mt-14 right-6 left-6 z-10 bg-surface-card border border-hairline rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-3">
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar produto por SKU ou nome…"
          className="flex-1 bg-canvas-soft border border-hairline-strong rounded-md px-3 py-2 text-[14px] focus:border-ink focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setQuery("");
            setResultados([]);
          }}
          className="text-[13px] text-muted hover:text-ink px-2"
        >
          Fechar
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {pending && <div className="text-[12px] text-muted px-2 py-2">Buscando…</div>}
        {!pending && query.length >= 2 && resultados.length === 0 && (
          <div className="text-[12px] text-muted px-2 py-2">Nenhum match</div>
        )}
        <div className="divide-y divide-hairline-soft">
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onEscolher(p);
                // Mantém aberto pra adicionar vários
                setQuery("");
                setResultados([]);
              }}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-canvas-soft text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] text-ink">{p.sku}</div>
                <div className="text-[12px] text-body truncate">{p.nome}</div>
              </div>
              <span className="text-[12px] text-ink whitespace-nowrap">+1 →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="caption-uppercase text-muted block mb-2">{label}</span>
      {children}
    </label>
  );
}
