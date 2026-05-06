"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  previewPDFAction,
  confirmarRecebimentoAction,
  buscarProdutos,
  type PreviewResult,
  type LinhaPreview,
} from "./actions";

type Loja = { codigo: string; nome: string };

type LinhaEditavel = LinhaPreview & {
  produto_id: string | null;
  custo_unitario: number;
  // Estado da busca manual
  buscando: boolean;
  buscaQuery: string;
  buscaResults: { id: string; sku: string; nome: string; custo: number | null }[];
};

export function NovoRecebimentoUI({ lojas }: { lojas: Loja[] }) {
  const [preview, formAction] = useActionState<PreviewResult | null, FormData>(
    previewPDFAction,
    null,
  );

  if (preview && preview.ok) {
    return <RevisaoPreview preview={preview} lojas={lojas} />;
  }

  return (
    <form action={formAction} className="space-y-6">
      <Field label="PDF do pedido de venda" hint="Exporte do Bling como 'Pedido de venda'.">
        <input
          type="file"
          name="arquivo"
          accept="application/pdf,.pdf"
          required
          className="block w-full text-[14px] text-body file:mr-4 file:py-2 file:px-4 file:rounded-pill file:border-0 file:text-[14px] file:font-medium file:bg-surface-strong file:text-ink hover:file:bg-hairline cursor-pointer"
        />
      </Field>

      {preview && !preview.ok && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 text-[14px] text-error">
          <strong className="font-semibold">Erro:</strong> {preview.error}
        </div>
      )}

      <div className="flex items-center gap-3 pt-4">
        <SubmitBtn />
        <Link href="/painel/recebimentos" className="text-[14px] text-body hover:text-ink">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function RevisaoPreview({
  preview,
  lojas,
}: {
  preview: Extract<PreviewResult, { ok: true }>;
  lojas: Loja[];
}) {
  const [linhas, setLinhas] = useState<LinhaEditavel[]>(() =>
    preview.linhas.map((l) => ({
      ...l,
      produto_id: l.match?.id ?? null,
      custo_unitario: l.match?.custo ?? 0,
      buscando: false,
      buscaQuery: "",
      buscaResults: [],
    })),
  );
  const [lojaCodigo, setLojaCodigo] = useState<string>("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalQtd = linhas.reduce((acc, l) => acc + l.qtd, 0);
  const totalValor = linhas.reduce((acc, l) => acc + l.qtd * l.custo_unitario, 0);
  const naoResolvidos = linhas.filter((l) => !l.produto_id).length;

  function setLinha(idx: number, patch: Partial<LinhaEditavel>) {
    setLinhas((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function buscar(idx: number, query: string) {
    setLinha(idx, { buscaQuery: query });
    if (query.trim().length < 2) {
      setLinha(idx, { buscaResults: [] });
      return;
    }
    const results = await buscarProdutos(query);
    setLinha(idx, { buscaResults: results });
  }

  function escolherProduto(
    idx: number,
    p: { id: string; sku: string; nome: string; custo: number | null },
  ) {
    setLinha(idx, {
      produto_id: p.id,
      buscando: false,
      buscaResults: [],
      buscaQuery: "",
      match: { id: p.id, sku: p.sku, nome: p.nome, custo: p.custo },
      custo_unitario:
        // Se ainda está em 0, herda custo do produto escolhido
        linhas[idx].custo_unitario === 0 && p.custo != null
          ? p.custo
          : linhas[idx].custo_unitario,
    });
  }

  function confirmar() {
    setErro(null);
    if (!lojaCodigo) {
      setErro("Selecione a loja destino.");
      return;
    }
    if (naoResolvidos > 0) {
      setErro(
        `Há ${naoResolvidos} item(ns) sem produto associado. Resolva todos antes de confirmar (ou remova-os).`,
      );
      return;
    }
    const itens = linhas.map((l) => ({
      produto_id: l.produto_id!,
      qtd: l.qtd,
      custo_unitario: l.custo_unitario,
    }));
    startTransition(async () => {
      const r = await confirmarRecebimentoAction({
        loja_codigo: lojaCodigo,
        fornecedor: preview.cliente,
        nf_numero: preview.numero_pedido,
        observacao: observacao || null,
        itens,
      });
      if (!r.ok) setErro(r.error);
      // sucesso: redirect dentro da action
    });
  }

  function remover(idx: number) {
    setLinhas((arr) => arr.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl px-5 py-4">
        <p className="text-[14px] text-[#166534]">
          PDF lido — <strong>{preview.linhas.length}</strong> item(ns),{" "}
          <strong>{preview.total_unidades}</strong> unidade(s).
          {preview.numero_pedido && (
            <>
              {" "}
              Pedido <strong>#{preview.numero_pedido}</strong>.
            </>
          )}
          {preview.cliente && (
            <>
              {" "}
              Cliente: <strong>{preview.cliente}</strong>.
            </>
          )}
        </p>
        {naoResolvidos > 0 && (
          <p className="mt-2 text-[13px] text-[#92400e]">
            ⚠ {naoResolvidos} item(ns) sem SKU resolvido — use &quot;Buscar produto&quot;
            para ajustar manualmente.
          </p>
        )}
      </div>

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
        <Field label="Observação (opcional)">
          <input
            type="text"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="ex: reposição mensal"
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] focus:border-ink focus:outline-none"
          />
        </Field>
      </div>

      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-4 py-3">SKU PDF</th>
              <th className="text-left px-4 py-3">Produto resolvido</th>
              <th className="text-right px-4 py-3 w-20">Qtd</th>
              <th className="text-right px-4 py-3 w-32">Custo un.</th>
              <th className="text-right px-4 py-3 w-32">Subtotal</th>
              <th className="text-right px-4 py-3 w-24">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {linhas.map((l, idx) => (
              <LinhaItem
                key={idx}
                idx={idx}
                linha={l}
                onSetQtd={(q) => setLinha(idx, { qtd: q })}
                onSetCusto={(c) => setLinha(idx, { custo_unitario: c })}
                onAbrirBusca={() =>
                  setLinha(idx, { buscando: true, buscaQuery: l.sku_pdv })
                }
                onFecharBusca={() =>
                  setLinha(idx, { buscando: false, buscaResults: [], buscaQuery: "" })
                }
                onBuscar={(q) => buscar(idx, q)}
                onEscolher={(p) => escolherProduto(idx, p)}
                onRemover={() => remover(idx)}
              />
            ))}
          </tbody>
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
                {totalValor.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {erro && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 text-[14px] text-error">
          {erro}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={confirmar}
          disabled={pending || naoResolvidos > 0 || !lojaCodigo}
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Salvando…" : "Confirmar recebimento"}
        </button>
        <Link href="/painel/recebimentos" className="text-[14px] text-body hover:text-ink">
          Cancelar
        </Link>
      </div>
    </div>
  );
}

function LinhaItem({
  idx,
  linha,
  onSetQtd,
  onSetCusto,
  onAbrirBusca,
  onFecharBusca,
  onBuscar,
  onEscolher,
  onRemover,
}: {
  idx: number;
  linha: LinhaEditavel;
  onSetQtd: (q: number) => void;
  onSetCusto: (c: number) => void;
  onAbrirBusca: () => void;
  onFecharBusca: () => void;
  onBuscar: (q: string) => void;
  onEscolher: (p: { id: string; sku: string; nome: string; custo: number | null }) => void;
  onRemover: () => void;
}) {
  const subtotal = linha.qtd * linha.custo_unitario;
  return (
    <>
      <tr className="hover:bg-canvas-soft">
        <td className="px-4 py-3 font-mono text-[12px] text-body-strong">
          {linha.sku_pdv}
        </td>
        <td className="px-4 py-3 text-[13px]">
          {linha.match ? (
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-[13px] text-ink font-medium">
                  {linha.match.sku}
                </span>
                {linha.candidatos.length > 1 && (
                  <span className="caption-uppercase rounded-pill px-1.5 py-0.5 bg-[#fef3c7] text-[#92400e]">
                    {linha.candidatos.length} candidatos
                  </span>
                )}
              </div>
              <div className="text-[12px] text-body truncate max-w-[440px]">
                {linha.match.nome}
              </div>
            </div>
          ) : (
            <span className="text-error text-[12px]">Não resolvido</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <input
            type="number"
            min={1}
            value={linha.qtd}
            onChange={(e) => onSetQtd(Math.max(0, Number(e.target.value) || 0))}
            className="w-16 text-right bg-canvas-soft border border-hairline rounded-md px-2 py-1 text-[13px] focus:border-ink focus:bg-surface-card focus:outline-none"
          />
        </td>
        <td className="px-4 py-3 text-right">
          <input
            type="number"
            min={0}
            step="0.01"
            value={linha.custo_unitario}
            onChange={(e) => onSetCusto(Math.max(0, Number(e.target.value) || 0))}
            className="w-24 text-right bg-canvas-soft border border-hairline rounded-md px-2 py-1 text-[13px] focus:border-ink focus:bg-surface-card focus:outline-none"
          />
        </td>
        <td className="px-4 py-3 text-right text-[13px] text-body">
          {subtotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onAbrirBusca}
              className="text-[12px] text-body hover:text-ink"
            >
              Buscar
            </button>
            <button
              type="button"
              onClick={onRemover}
              className="text-[12px] text-muted hover:text-error"
              title="Remover do recebimento"
            >
              ×
            </button>
          </div>
        </td>
      </tr>
      {linha.buscando && (
        <tr>
          <td colSpan={6} className="px-4 py-3 bg-canvas-soft border-l-2 border-ink">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                autoFocus
                value={linha.buscaQuery}
                onChange={(e) => onBuscar(e.target.value)}
                placeholder="Digite SKU ou nome…"
                className="flex-1 bg-surface-card border border-hairline-strong rounded-md px-3 py-1.5 text-[13px] focus:border-ink focus:outline-none"
              />
              <button
                type="button"
                onClick={onFecharBusca}
                className="text-[12px] text-muted hover:text-ink"
              >
                Cancelar
              </button>
            </div>
            {linha.candidatos.length > 1 && linha.buscaQuery === linha.sku_pdv && (
              <p className="text-[11px] text-muted mb-2">
                Candidatos baseados no SKU truncado:
              </p>
            )}
            <div className="max-h-64 overflow-y-auto border border-hairline-soft rounded-md divide-y divide-hairline-soft bg-surface-card">
              {(linha.buscaResults.length > 0 ? linha.buscaResults : linha.candidatos).map(
                (p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onEscolher(p)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-canvas-soft text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[12px] text-ink">{p.sku}</div>
                      <div className="text-[12px] text-body truncate">{p.nome}</div>
                    </div>
                    <span className="text-[12px] text-ink">→</span>
                  </button>
                ),
              )}
              {linha.buscaResults.length === 0 &&
                linha.candidatos.length === 0 &&
                linha.buscaQuery.length >= 2 && (
                  <div className="px-3 py-2 text-[12px] text-muted">Nenhum match</div>
                )}
            </div>
          </td>
        </tr>
      )}
    </>
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

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60"
    >
      {pending ? "Lendo PDF…" : "Ler PDF"}
    </button>
  );
}
