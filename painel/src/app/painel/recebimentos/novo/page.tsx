import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { NovoRecebimentoUI } from "./NovoRecebimento";

export const dynamic = "force-dynamic";

export default async function NovoRecebimentoPage() {
  const scope = await getLojaScope();
  if (scope.tipo !== "admin") {
    redirect("/painel/recebimentos");
  }
  const sb = getSupabase();
  const { data: lojas } = await sb
    .from("lj_lojas")
    .select("codigo, nome")
    .eq("ativa", true)
    .order("codigo");

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-12">
      <Link
        href="/painel/recebimentos"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para recebimentos
      </Link>
      <p className="caption-uppercase text-muted mb-3">Novo recebimento</p>
      <h1 className="display-lg text-ink mb-2">Lançar a partir de PDF</h1>
      <p className="text-body text-[15px] mb-10 leading-[1.5]">
        Faça upload do PDF do pedido de venda do Bling. O sistema detecta SKU e
        quantidade de cada item; você revisa, ajusta SKUs truncados, define o custo
        unitário e a loja destino, e confirma. Cada item vira um movimento{" "}
        <code className="text-[13px]">entrada_compra</code> no ledger.
      </p>

      <NovoRecebimentoUI
        lojas={(lojas ?? []) as { codigo: string; nome: string }[]}
      />
    </div>
  );
}
