import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { NovaContagemForm } from "./NovaContagemForm";

export const dynamic = "force-dynamic";

export default async function NovaContagemPage() {
  const scope = await getLojaScope();
  const sb = getSupabase();
  const [lojasRes, prodsRes] = await Promise.all([
    sb.from("lj_lojas").select("codigo, nome").eq("ativa", true).order("codigo"),
    sb.from("lj_produtos").select("categoria").eq("ativo", true).not("categoria", "is", null),
  ]);
  const categorias = Array.from(
    new Set((prodsRes.data ?? []).map((p) => p.categoria as string).filter(Boolean)),
  ).sort();
  // Usuario de loja so cria pra propria loja
  const lojas = (lojasRes.data ?? []) as { codigo: string; nome: string }[];
  const lojasFiltradas =
    scope.tipo === "loja"
      ? lojas.filter((l) => l.codigo === scope.codigo)
      : lojas;
  const lojaFixa = scope.tipo === "loja" ? scope.codigo : null;

  return (
    <div className="mx-auto max-w-[760px] px-6 py-12">
      <Link
        href="/painel/contagens"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para contagens
      </Link>
      <p className="caption-uppercase text-muted mb-3">Nova sessão</p>
      <h1 className="display-lg text-ink mb-2">Criar contagem</h1>
      <p className="text-body text-[15px] mb-10 leading-[1.5]">
        A sessão começa em <strong>aberta</strong> e congela um snapshot do estoque atual
        no escopo escolhido. Para a primeira contagem geral de uma loja, todos os SKUs
        ativos entram no escopo (qtd teórica = 0 na maioria) — bipe o que existir
        fisicamente, o resto fica com 0 e a contagem estabelece o estoque inicial.
      </p>

      <NovaContagemForm
        lojas={lojasFiltradas}
        categorias={categorias}
        lojaFixa={lojaFixa}
      />
    </div>
  );
}
