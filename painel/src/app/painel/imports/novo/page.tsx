import Link from "next/link";
import Image from "next/image";
import { NovoImportForm } from "./NovoImportForm";

export const dynamic = "force-dynamic";

export default function NovoImportPage() {
  return (
    <div className="mx-auto max-w-[860px] px-6 py-12">
      <Link
        href="/painel/imports"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para imports
      </Link>
      <p className="caption-uppercase text-muted mb-3">Nova importação</p>
      <h1 className="display-lg text-ink mb-2">Carregar vendas do PDV</h1>
      <p className="text-body text-[15px] mb-8 leading-[1.5]">
        Faça upload do relatório analítico do PDV. O sistema detecta loja e período do
        cabeçalho, parseia, resolve SKUs contra o cadastro e cria 1 import por loja.
      </p>

      <TutorialPDVNet />

      <div className="mt-10">
        <NovoImportForm />
      </div>
    </div>
  );
}

function TutorialPDVNet() {
  return (
    <details className="bg-surface-card border border-hairline rounded-xl">
      <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between">
        <span className="text-[14px] font-medium text-ink">
          Onde encontrar o relatório no PDVNet?
        </span>
        <span className="text-[12px] text-muted">expandir / fechar</span>
      </summary>
      <div className="px-5 pb-5 border-t border-hairline-soft">
        <ol className="text-[13px] text-body space-y-1.5 mt-4 ml-4 list-decimal leading-relaxed">
          <li>
            Abra o <strong>PDVNet — Retaguarda</strong>
          </li>
          <li>
            Clique em <strong>Relatórios Financeiros</strong> na home
          </li>
          <li>
            Selecione a opção do relatório <strong>analítico de vendas</strong>
          </li>
          <li>
            Defina o <strong>período</strong> (de / até) e clique em{" "}
            <strong>Visualizar</strong>
          </li>
          <li>
            Exporte como <strong>CSV</strong> e faça upload aqui
          </li>
        </ol>
        <div className="mt-5 rounded-lg overflow-hidden border border-hairline-soft bg-canvas-soft">
          <Image
            src="/tutoriais/extrair-relatorio-pdv.png"
            alt="Tela do PDVNet mostrando onde extrair o relatório de vendas"
            width={1600}
            height={1000}
            className="w-full h-auto"
            priority={false}
          />
        </div>
      </div>
    </details>
  );
}
