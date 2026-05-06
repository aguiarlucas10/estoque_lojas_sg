import Link from "next/link";
import { getLojaScope } from "@/lib/scope";

export async function TopNav() {
  const scope = await getLojaScope();
  const estoqueHref =
    scope.tipo === "loja" ? `/painel/estoque/${scope.codigo}` : "/painel/estoque/BAL";

  return (
    <header className="bg-canvas border-b border-hairline">
      <div className="mx-auto max-w-[1200px] h-16 px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="display text-xl text-ink">Saint Germain</span>
          <span className="caption-uppercase text-muted">Estoque</span>
        </Link>
        <nav className="flex items-center gap-7 text-[15px] font-medium">
          <Link href={estoqueHref} className="text-ink hover:text-body">
            Estoque
          </Link>
          <Link href="/painel/imports" className="text-muted hover:text-ink">
            Imports
          </Link>
          {scope.tipo === "admin" && (
            <Link href="/painel/recebimentos" className="text-muted hover:text-ink">
              Recebimentos
            </Link>
          )}
          <Link href="/painel/contagens" className="text-muted hover:text-ink">
            Contagens
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          {scope.tipo === "loja" ? (
            <span className="caption-uppercase text-muted">
              <strong className="text-ink not-italic font-semibold">{scope.codigo}</strong>{" "}
              · {scope.nome}
            </span>
          ) : (
            <span className="caption-uppercase text-muted">Admin · todas as lojas</span>
          )}
          <a
            href="/logout"
            className="caption-uppercase text-muted hover:text-ink"
            title="Encerrar sessão"
          >
            Sair
          </a>
        </div>
      </div>
    </header>
  );
}
