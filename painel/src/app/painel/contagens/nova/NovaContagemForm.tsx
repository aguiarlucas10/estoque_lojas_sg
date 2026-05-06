"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { criarContagem, type NovaContagemState } from "./actions";

export function NovaContagemForm({
  lojas,
  categorias,
  lojaFixa,
}: {
  lojas: { codigo: string; nome: string }[];
  categorias: string[];
  lojaFixa: string | null;
}) {
  const [state, formAction] = useActionState<NovaContagemState, FormData>(
    criarContagem,
    null,
  );
  const [tipo, setTipo] = useState<"geral" | "amostragem">("geral");
  const [metodo, setMetodo] = useState<"categoria" | "aleatorio">("aleatorio");

  return (
    <form action={formAction} className="space-y-6">
      <Field label="Loja">
        {lojaFixa ? (
          <>
            <input type="hidden" name="loja_codigo" value={lojaFixa} />
            <div className="w-full bg-canvas-soft border border-hairline rounded-md px-4 py-3 text-[15px] text-ink">
              {lojas[0]?.codigo} — {lojas[0]?.nome}
            </div>
          </>
        ) : (
          <select
            name="loja_codigo"
            required
            defaultValue=""
            className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-3 text-[15px] text-ink focus:border-ink focus:outline-none"
          >
            <option value="" disabled>Selecione…</option>
            {lojas.map((l) => (
              <option key={l.codigo} value={l.codigo}>
                {l.codigo} — {l.nome}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Tipo de contagem">
        <div className="grid grid-cols-2 gap-3">
          <RadioCard
            name="tipo"
            value="geral"
            checked={tipo === "geral"}
            onChange={() => setTipo("geral")}
            title="Geral"
            desc="Conta todos os SKUs com saldo positivo da loja. Use trimestral ou semestralmente."
          />
          <RadioCard
            name="tipo"
            value="amostragem"
            checked={tipo === "amostragem"}
            onChange={() => setTipo("amostragem")}
            title="Amostragem"
            desc="Conta um subconjunto. Use semanal/mensalmente para detectar ruptura cedo."
          />
        </div>
      </Field>

      {tipo === "amostragem" && (
        <div className="bg-canvas-soft border border-hairline rounded-xl p-5 space-y-5">
          <Field label="Método">
            <div className="flex gap-3">
              <label className="inline-flex items-center gap-2 text-[14px] text-ink">
                <input
                  type="radio"
                  name="metodo"
                  value="aleatorio"
                  checked={metodo === "aleatorio"}
                  onChange={() => setMetodo("aleatorio")}
                />
                Aleatório N
              </label>
              <label className="inline-flex items-center gap-2 text-[14px] text-ink">
                <input
                  type="radio"
                  name="metodo"
                  value="categoria"
                  checked={metodo === "categoria"}
                  onChange={() => setMetodo("categoria")}
                />
                Categoria inteira
              </label>
            </div>
          </Field>

          {metodo === "aleatorio" && (
            <Field label="Quantidade de SKUs">
              <input
                type="number"
                name="n"
                min={1}
                defaultValue={20}
                required
                className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-3 text-[15px] text-ink focus:border-ink focus:outline-none"
              />
            </Field>
          )}

          {metodo === "categoria" && (
            <Field label="Categoria">
              <select
                name="categoria"
                required
                defaultValue=""
                className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-3 text-[15px] text-ink focus:border-ink focus:outline-none"
              >
                <option value="" disabled>Selecione…</option>
                {categorias.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {state?.error && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-lg px-4 py-3 text-[14px] text-error">
          <strong className="font-semibold">Erro:</strong> {state.error}
        </div>
      )}

      <div className="flex items-center gap-4 pt-4">
        <SubmitButton />
        <Link href="/painel/contagens" className="text-[15px] text-body hover:text-ink">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  desc,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      className={`block cursor-pointer p-4 rounded-xl border transition-colors ${
        checked
          ? "border-ink bg-surface-card"
          : "border-hairline bg-surface-card hover:border-hairline-strong"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <div className="text-[15px] font-medium text-ink mb-1">{title}</div>
      <div className="text-[13px] text-body leading-snug">{desc}</div>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caption-uppercase text-muted block mb-2">{label}</span>
      {children}
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
      {pending ? "Criando…" : "Criar sessão"}
    </button>
  );
}
