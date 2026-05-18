"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORIAS_VALIDAS,
  criarProdutoAction,
  editarProdutoAction,
  type ProdutoInput,
} from "./actions";

export type ProdutoExistente = {
  id: string;
  sku: string;
  nome: string;
  ean: string | null;
  categoria: string | null;
  subcategoria: string | null;
  custo: number | null;
  preco_venda: number | null;
  ativo: boolean;
};

export type ProdutoFormDialogHandle = {
  abrirNovo: () => void;
  abrirEdicao: (p: ProdutoExistente) => void;
};

type FormState = {
  sku: string;
  nome: string;
  ean: string;
  categoria: string;
  subcategoria: string;
  custo: string;
  preco_venda: string;
  ativo: boolean;
};

const ESTADO_VAZIO: FormState = {
  sku: "",
  nome: "",
  ean: "",
  categoria: "",
  subcategoria: "",
  custo: "",
  preco_venda: "",
  ativo: true,
};

function parseMoeda(v: string): number | null {
  const limpo = v.trim().replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
}

function moedaParaString(n: number | null): string {
  if (n == null) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const ProdutoFormDialog = forwardRef<ProdutoFormDialogHandle>(
  function ProdutoFormDialog(_, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [erro, setErro] = useState<string | null>(null);
    const [editando, setEditando] = useState<ProdutoExistente | null>(null);
    const [form, setForm] = useState<FormState>(ESTADO_VAZIO);

    useImperativeHandle(ref, () => ({
      abrirNovo() {
        setEditando(null);
        setForm(ESTADO_VAZIO);
        setErro(null);
        dialogRef.current?.showModal();
      },
      abrirEdicao(p) {
        setEditando(p);
        setForm({
          sku: p.sku,
          nome: p.nome,
          ean: p.ean ?? "",
          categoria: p.categoria ?? "",
          subcategoria: p.subcategoria ?? "",
          custo: moedaParaString(p.custo),
          preco_venda: moedaParaString(p.preco_venda),
          ativo: p.ativo,
        });
        setErro(null);
        dialogRef.current?.showModal();
      },
    }));

    function atualizar<K extends keyof FormState>(k: K, v: FormState[K]) {
      setForm((s) => ({ ...s, [k]: v }));
    }

    function fechar() {
      dialogRef.current?.close();
    }

    function salvar() {
      setErro(null);

      const custo = parseMoeda(form.custo);
      const preco = parseMoeda(form.preco_venda);
      if (Number.isNaN(custo)) {
        setErro("Custo inválido. Use formato 12,34");
        return;
      }
      if (Number.isNaN(preco)) {
        setErro("Preço de venda inválido. Use formato 12,34");
        return;
      }

      const input: ProdutoInput = {
        sku: form.sku,
        nome: form.nome,
        ean: form.ean,
        categoria: form.categoria || null,
        subcategoria: form.subcategoria,
        custo: custo as number | null,
        preco_venda: preco as number | null,
        ativo: form.ativo,
      };

      startTransition(async () => {
        const r = editando
          ? await editarProdutoAction(editando.id, input)
          : await criarProdutoAction(input);
        if (!r.ok) {
          setErro(r.error);
        } else {
          fechar();
          router.refresh();
        }
      });
    }

    const titulo = editando ? "Editar produto" : "Novo produto";
    const acao = editando ? "Salvar alterações" : "Cadastrar produto";

    return (
      <dialog
        ref={dialogRef}
        className="rounded-xl p-0 max-w-[560px] w-full backdrop:bg-black/50"
        onClose={() => setErro(null)}
      >
        <div className="bg-surface-card p-6">
          <p className="caption-uppercase text-muted mb-2">
            {editando ? "Catálogo · edição" : "Catálogo · novo cadastro"}
          </p>
          <h2 className="display-lg text-ink mb-6" style={{ fontSize: 22 }}>
            {titulo}
          </h2>

          <div className="space-y-4 mb-5">
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Field label="SKU *">
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => atualizar("sku", e.target.value)}
                  disabled={pending}
                  autoFocus={!editando}
                  className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 font-mono text-[14px] text-ink focus:border-ink focus:outline-none"
                />
              </Field>
              <Field label="EAN">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.ean}
                  onChange={(e) =>
                    atualizar("ean", e.target.value.replace(/\D/g, ""))
                  }
                  disabled={pending}
                  placeholder="13 dígitos"
                  className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 font-mono text-[14px] text-ink focus:border-ink focus:outline-none"
                />
              </Field>
            </div>

            <Field label="Nome *">
              <input
                type="text"
                value={form.nome}
                onChange={(e) => atualizar("nome", e.target.value)}
                disabled={pending}
                className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[15px] text-ink focus:border-ink focus:outline-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Categoria">
                <select
                  value={form.categoria}
                  onChange={(e) => atualizar("categoria", e.target.value)}
                  disabled={pending}
                  className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
                >
                  <option value="">— sem categoria</option>
                  {CATEGORIAS_VALIDAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Subcategoria">
                <input
                  type="text"
                  value={form.subcategoria}
                  onChange={(e) => atualizar("subcategoria", e.target.value)}
                  disabled={pending}
                  placeholder="opcional"
                  className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Custo (R$)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.custo}
                  onChange={(e) => atualizar("custo", e.target.value)}
                  disabled={pending}
                  placeholder="0,00"
                  className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
                />
              </Field>
              <Field label="Preço de venda (R$)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.preco_venda}
                  onChange={(e) => atualizar("preco_venda", e.target.value)}
                  disabled={pending}
                  placeholder="0,00"
                  className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => atualizar("ativo", e.target.checked)}
                disabled={pending}
                className="h-4 w-4 accent-[var(--color-ink)]"
              />
              <span className="text-[14px] text-body">
                Produto ativo
                <span className="text-muted text-[12px] ml-2">
                  (visível em contagens, importações e recebimentos)
                </span>
              </span>
            </label>
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
              disabled={pending}
              className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[14px] font-medium hover:bg-primary-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? "Salvando…" : acao}
            </button>
          </div>
        </div>
      </dialog>
    );
  },
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caption-uppercase text-muted block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
