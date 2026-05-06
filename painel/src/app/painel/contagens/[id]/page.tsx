import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { SessaoUI, type ItemSessao } from "./SessaoUI";

export const dynamic = "force-dynamic";

const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dataHoraBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_LABEL: Record<string, string> = {
  aberta: "Aberta",
  em_contagem: "Em contagem",
  em_revisao: "Em revisão",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

const TIPO_LABEL: Record<string, string> = {
  geral: "Geral",
  amostragem: "Amostragem",
};

const moedaBR = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function SessaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = getSupabase();

  const { data: sessao } = await sb
    .from("lj_sessoes_contagem")
    .select(`
      id, tipo, status, escopo, criado_em, iniciada_em, finalizada_em,
      loja:lj_lojas(id, codigo, nome)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!sessao) notFound();

  const loja = sessao.loja as unknown as { id: string; codigo: string; nome: string } | null;
  const scope = await getLojaScope();
  if (scope.tipo === "loja" && loja?.id !== scope.loja_id) notFound();
  const status = sessao.status as ItemSessao["status"] extends never
    ? never
    : "aberta" | "em_contagem" | "em_revisao" | "finalizada" | "cancelada";

  // Carrega itens da sessão + dados de produto
  const { data: itensRaw } = await sb
    .from("lj_sessoes_itens")
    .select("produto_id, qtd_teorica, qtd_contada, diferenca, valor_diferenca, status")
    .eq("sessao_id", id);

  const ids = (itensRaw ?? []).map((i) => i.produto_id as string);
  let prodMap = new Map<string, { sku: string; nome: string; categoria: string | null; custo: number | null }>();
  if (ids.length > 0) {
    const { data: prods } = await sb
      .from("lj_produtos")
      .select("id, sku, nome, categoria, custo")
      .in("id", ids);
    prodMap = new Map(
      (prods ?? []).map((p) => [
        p.id as string,
        {
          sku: p.sku as string,
          nome: p.nome as string,
          categoria: (p.categoria as string | null) ?? null,
          custo: p.custo != null ? Number(p.custo) : null,
        },
      ]),
    );
  }

  const todosItens: ItemSessao[] = (itensRaw ?? []).map((r) => {
    const p = prodMap.get(r.produto_id as string);
    return {
      produto_id: r.produto_id as string,
      sku: p?.sku ?? "—",
      nome: p?.nome ?? "—",
      categoria: p?.categoria ?? null,
      custo: p?.custo ?? null,
      qtd_teorica: Number(r.qtd_teorica),
      qtd_contada: Number(r.qtd_contada),
      diferenca: Number(r.diferenca),
      valor_diferenca: r.valor_diferenca != null ? Number(r.valor_diferenca) : null,
      status: r.status as ItemSessao["status"],
    };
  });

  // Apos encerrar a contagem, foca somente nos SKUs efetivamente contados
  // (qtd_contada > 0). SKUs do escopo que nao foram bipados ficam ignorados:
  // o saldo deles no sistema nao eh alterado pela sessao.
  const ehFasePosContagem =
    sessao.status === "em_revisao" ||
    sessao.status === "finalizada" ||
    sessao.status === "cancelada";
  const itens = ehFasePosContagem
    ? todosItens.filter((i) => i.qtd_contada > 0)
    : todosItens;
  itens.sort((a, b) => {
    if (Math.abs(b.diferenca) !== Math.abs(a.diferenca)) {
      return Math.abs(b.diferenca) - Math.abs(a.diferenca);
    }
    return a.sku.localeCompare(b.sku);
  });

  const totalDiferenca = itens.reduce((acc, i) => acc + Math.abs(i.diferenca), 0);
  const valorAjuste = itens.reduce(
    (acc, i) => acc + (i.valor_diferenca ?? (i.custo ? i.custo * i.diferenca : 0)),
    0,
  );
  const escopo = sessao.escopo as Record<string, unknown> | null;
  const escopoLabel = (() => {
    if (!escopo) return "—";
    if (escopo.metodo === "geral") return "Geral";
    if (escopo.metodo === "amostragem_categoria")
      return `Amostragem · categoria ${escopo.categoria as string}`;
    if (escopo.metodo === "amostragem_aleatorio")
      return `Amostragem · aleatório ${escopo.n as number}`;
    return JSON.stringify(escopo);
  })();

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <Link
        href="/painel/contagens"
        className="text-[14px] text-muted hover:text-ink mb-6 inline-block"
      >
        ← Voltar para contagens
      </Link>

      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <p className="caption-uppercase text-muted mb-3">
            {loja?.codigo ?? "—"} · {loja?.nome ?? ""} · {TIPO_LABEL[sessao.tipo as string]}
          </p>
          <h1 className="display-lg text-ink mb-2">Sessão de contagem</h1>
          <p className="text-[14px] text-muted">
            {escopoLabel} · criada em{" "}
            {dataHoraBR.format(new Date(sessao.criado_em as string))}
            {sessao.iniciada_em && (
              <> · iniciada em {dataHoraBR.format(new Date(sessao.iniciada_em as string))}</>
            )}
            {sessao.finalizada_em && (
              <> · finalizada em {dataHoraBR.format(new Date(sessao.finalizada_em as string))}</>
            )}
          </p>
        </div>
        <StatusBadgeBig status={sessao.status as string} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat
          label={ehFasePosContagem ? "Itens contados" : "Itens no escopo"}
          value={itens.length.toLocaleString("pt-BR")}
          hint={
            ehFasePosContagem && todosItens.length !== itens.length
              ? `de ${todosItens.length.toLocaleString("pt-BR")} no escopo`
              : undefined
          }
        />
        <Stat
          label="Soma diferenças"
          value={totalDiferenca.toLocaleString("pt-BR")}
          hint="quantidade absoluta"
        />
        <Stat
          label="Valor de ajuste"
          value={moedaBR.format(valorAjuste)}
          tone={valorAjuste < 0 ? "error" : "default"}
        />
        <Stat
          label="Última contagem"
          value={
            sessao.finalizada_em
              ? dataBR.format(new Date(sessao.finalizada_em as string))
              : sessao.iniciada_em
                ? "Em andamento"
                : "—"
          }
        />
      </div>

      <SessaoUI sessao_id={id} status={status} itens={itens} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "error";
}) {
  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-5">
      <p className="caption-uppercase text-muted">{label}</p>
      <p
        className={`mt-2 text-[22px] font-light ${tone === "error" ? "text-error" : "text-ink"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function StatusBadgeBig({ status }: { status: string }) {
  const map: Record<string, string> = {
    aberta: "bg-surface-strong text-muted",
    em_contagem: "bg-[#dbeafe] text-[#1e40af]",
    em_revisao: "bg-[#fef3c7] text-[#92400e]",
    finalizada: "bg-[#dcfce7] text-[#15803d]",
    cancelada: "bg-[#fee2e2] text-error",
  };
  const tone = map[status] ?? "bg-surface-strong text-muted";
  return (
    <span className={`caption-uppercase rounded-pill px-3 py-1.5 whitespace-nowrap ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
