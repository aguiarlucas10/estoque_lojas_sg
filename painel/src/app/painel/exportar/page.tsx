import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { ExportarForm, type LojaOpcao } from "./ExportarForm";

export const dynamic = "force-dynamic";

export default async function ExportarPage() {
  const scope = await getLojaScope();
  const sb = getSupabase();

  let query = sb
    .from("lj_lojas")
    .select("codigo, nome")
    .eq("ativa", true)
    .order("codigo");
  if (scope.tipo === "loja") {
    query = query.eq("codigo", scope.codigo.toUpperCase());
  }
  const { data } = await query;
  const lojas: LojaOpcao[] = (data ?? []).map((l) => ({
    codigo: l.codigo as string,
    nome: l.nome as string,
  }));

  return (
    <div className="mx-auto max-w-[760px] px-6 py-12">
      <div className="mb-10">
        <p className="caption-uppercase text-muted mb-3">Exportar</p>
        <h1 className="display-lg text-ink">Exportar dados</h1>
        <p className="mt-3 text-[15px] text-body">
          Baixe o estoque atual ou as contagens em CSV (abre direto no Excel).
          Selecione as lojas desejadas.
        </p>
      </div>

      <ExportarForm lojas={lojas} travado={scope.tipo === "loja"} />
    </div>
  );
}
