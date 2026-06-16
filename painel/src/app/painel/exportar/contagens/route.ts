import type { NextRequest } from "next/server";
import { getLojaScope } from "@/lib/scope";
import { resolverLojas, exportarContagensCSV } from "@/lib/exportar";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const scope = await getLojaScope();
  const pedidas = (request.nextUrl.searchParams.get("lojas") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  // Usuario de loja so exporta a propria, independente do que pediu na URL.
  const codigos =
    scope.tipo === "loja" ? [scope.codigo] : pedidas;
  const lojas = await resolverLojas(codigos);

  if (lojas.length === 0) {
    return new Response("Selecione ao menos uma loja.", { status: 400 });
  }

  const csv = await exportarContagensCSV(lojas);
  const sufixo = lojas.length === 1 ? lojas[0].codigo : `${lojas.length}lojas`;
  const nome = `contagens_${sufixo}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
