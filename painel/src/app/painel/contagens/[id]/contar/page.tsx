import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { ContarUI, type ItemContado } from "./ContarUI";

export const dynamic = "force-dynamic";

export default async function ContarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = getSupabase();

  const { data: sessao } = await sb
    .from("lj_sessoes_contagem")
    .select(`
      id, status, tipo, loja_id,
      loja:lj_lojas(codigo, nome)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!sessao) notFound();

  const loja = sessao.loja as unknown as { codigo: string; nome: string } | null;
  const scope = await getLojaScope();
  if (scope.tipo === "loja" && (sessao.loja_id as string) !== scope.loja_id) notFound();
  const status = sessao.status as string;

  // Carrega itens com qtd_contada > 0
  const { data: itensRaw } = await sb
    .from("lj_sessoes_itens")
    .select("produto_id, qtd_contada")
    .eq("sessao_id", id)
    .gt("qtd_contada", 0);

  let itens: ItemContado[] = [];
  if ((itensRaw ?? []).length > 0) {
    const ids = (itensRaw ?? []).map((i) => i.produto_id as string);
    const { data: prods } = await sb
      .from("lj_produtos")
      .select("id, sku, nome")
      .in("id", ids);
    const prodMap = new Map(
      (prods ?? []).map((p) => [
        p.id as string,
        { sku: p.sku as string, nome: p.nome as string },
      ]),
    );
    itens = (itensRaw ?? []).map((r) => {
      const p = prodMap.get(r.produto_id as string);
      return {
        produto_id: r.produto_id as string,
        sku: p?.sku ?? "—",
        nome: p?.nome ?? "—",
        qtd_contada: Number(r.qtd_contada),
      };
    });
    // Mais recentes primeiro: como não temos timestamp por bipagem, ordeno por SKU
    // (sem dado melhor). Pode ser melhorado depois com log de bipagens.
    itens.sort((a, b) => a.sku.localeCompare(b.sku));
  }

  return (
    <div className="mx-auto max-w-[760px] px-6 py-12">
      <Link
        href={`/painel/contagens/${id}`}
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para a sessão
      </Link>

      <p className="caption-uppercase text-muted mb-3">
        {loja?.codigo ?? "—"} · {loja?.nome ?? ""} · Modo contagem
      </p>
      <h1 className="display-lg text-ink mb-2">Bipar produtos</h1>

      {status !== "em_contagem" ? (
        <div className="bg-[#fef3c7] border border-[#fde68a] rounded-lg px-4 py-3 mt-6 text-[14px] text-[#92400e]">
          Esta sessão não está em contagem (status atual: <strong>{status}</strong>).
          Volte para a tela da sessão para iniciar ou retomar.
        </div>
      ) : (
        <ContarUI sessao_id={id} itensContados={itens} />
      )}
    </div>
  );
}
