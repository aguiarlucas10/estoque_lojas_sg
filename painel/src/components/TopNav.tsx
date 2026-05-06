import Link from "next/link";

export function TopNav() {
  return (
    <header className="bg-canvas border-b border-hairline">
      <div className="mx-auto max-w-[1200px] h-16 px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="display text-xl text-ink">Saint Germain</span>
          <span className="caption-uppercase text-muted">Estoque</span>
        </Link>
        <nav className="flex items-center gap-7 text-[15px] font-medium">
          <Link href="/painel/estoque/BAL" className="text-ink hover:text-body">
            Estoque
          </Link>
          <Link href="/painel/imports" className="text-muted hover:text-ink">
            Imports
          </Link>
          <Link href="/painel/contagens" className="text-muted hover:text-ink">
            Contagens
          </Link>
        </nav>
      </div>
    </header>
  );
}
