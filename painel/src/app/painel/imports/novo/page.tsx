import Link from "next/link";
import { NovoImportForm } from "./NovoImportForm";

export const dynamic = "force-dynamic";

export default function NovoImportPage() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-12">
      <Link
        href="/painel/imports"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para imports
      </Link>
      <p className="caption-uppercase text-muted mb-3">Nova importação</p>
      <h1 className="display-lg text-ink mb-2">Carregar vendas do PDV</h1>
      <p className="text-body text-[15px] mb-10 leading-[1.5]">
        Faça upload do relatório analítico do PDV. O sistema detecta loja e período do
        cabeçalho, parseia, resolve SKUs contra o cadastro e cria 1 import por loja.
      </p>

      <NovoImportForm />
    </div>
  );
}
