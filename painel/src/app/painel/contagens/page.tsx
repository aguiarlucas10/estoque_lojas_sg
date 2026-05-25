import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { getLojaScope } from "@/lib/scope";
import { dataBR } from "@/lib/format-date";

export const dynamic = "force-dynamic";

const STATUS: Record<
  string,
  { label: string; tone: "ok" | "active" | "warn" | "muted" | "err" }
> = {
  aberta: { label: "Aberta", tone: "muted" },
  em_contagem: { label: "Em contagem", tone: "active" },
  em_revisao: { label: "Em revisão", tone: "warn" },
  finalizada: { label: "Finalizada", tone: "ok" },
  cancelada: { label: "Cancelada", tone: "err" },
};

const TIPO_LABEL: Record<string, string> = {
  geral: "Geral",
  amostragem: "Amostragem",
};

export default async function ContagensPage() {
  const scope = await getLojaScope();
  const sb = getSupabase();
  let query = sb
    .from("lj_sessoes_contagem")
    .select(`
      id, tipo, status, criado_em, iniciada_em, finalizada_em,
      loja:lj_lojas(codigo, nome)
    `)
    .order("criado_em", { ascending: false });
  if (scope.tipo === "loja") {
    query = query.eq("loja_id", scope.loja_id);
  }
  const { data: sessoes } = await query;

  // Para cada sessão, contar itens e progresso (em uma query)
  const ids = (sessoes ?? []).map((s) => s.id as string);
  const itens =
    ids.length > 0
      ? (await sb
          .from("lj_sessoes_itens")
          .select("sessao_id, qtd_contada, qtd_teorica")
          .in("sessao_id", ids)).data ?? []
      : [];
  const progresso = new Map<string, { total: number; contados: number }>();
  for (const i of itens) {
    const sid = i.sessao_id as string;
    const cur = progresso.get(sid) ?? { total: 0, contados: 0 };
    cur.total += 1;
    if (Number(i.qtd_contada) > 0) cur.contados += 1;
    progresso.set(sid, cur);
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="caption-uppercase text-muted mb-3">Contagens</p>
          <h1 className="display-lg text-ink">Sessões de contagem</h1>
        </div>
        <Link
          href="/painel/contagens/nova"
          className="inline-flex items-center justify-center bg-primary text-on-primary rounded-pill h-10 px-5 text-[15px] font-medium hover:bg-primary-active transition-colors"
        >
          Nova contagem
        </Link>
      </div>

      <div className="bg-surface-card border border-hairline rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-strong border-b border-hairline">
            <tr className="caption-uppercase text-muted">
              <th className="text-left px-6 py-3">Loja</th>
              <th className="text-left px-6 py-3">Tipo</th>
              <th className="text-right px-6 py-3">Itens</th>
              <th className="text-left px-6 py-3 w-48">Progresso</th>
              <th className="text-left px-6 py-3">Status</th>
              <th className="text-right px-6 py-3">Criada em</th>
              <th className="px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {(sessoes ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-muted">
                  Nenhuma sessão ainda. Clique em &quot;Nova contagem&quot; para começar.
                </td>
              </tr>
            )}
            {(sessoes ?? []).map((s) => {
              const loja = s.loja as unknown as { codigo: string; nome: string } | null;
              const st = STATUS[s.status as string] ?? { label: s.status as string, tone: "muted" as const };
              const prog = progresso.get(s.id as string) ?? { total: 0, contados: 0 };
              const pct = prog.total > 0 ? Math.round((prog.contados / prog.total) * 100) : 0;
              return (
                <tr key={s.id as string} className="hover:bg-canvas-soft">
                  <td className="px-6 py-4">
                    <div className="text-[14px] text-ink font-medium">{loja?.codigo ?? "—"}</div>
                    <div className="text-[12px] text-muted">{loja?.nome ?? ""}</div>
                  </td>
                  <td className="px-6 py-4 text-[14px] text-body">
                    {TIPO_LABEL[s.tipo as string] ?? s.tipo as string}
                  </td>
                  <td className="px-6 py-4 text-right text-[14px] text-ink">
                    {prog.total.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-6 py-4">
                    <ProgressBar pct={pct} done={prog.contados} total={prog.total} />
                  </td>
                  <td className="px-6 py-4">
                    <StatusPill tone={st.tone} label={st.label} />
                  </td>
                  <td className="px-6 py-4 text-right text-[13px] text-muted">
                    {dataBR.format(new Date(s.criado_em as string))}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <Link
                      href={`/painel/contagens/${s.id as string}`}
                      className="text-[14px] text-ink hover:underline whitespace-nowrap"
                    >
                      Detalhes →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "active" | "warn" | "muted" | "err"; label: string }) {
  const styles = {
    ok: "bg-[#dcfce7] text-[#15803d]",
    active: "bg-[#dbeafe] text-[#1e40af]",
    warn: "bg-[#fef3c7] text-[#92400e]",
    muted: "bg-surface-strong text-muted",
    err: "bg-[#fee2e2] text-error",
  }[tone];
  return (
    <span className={`inline-block caption-uppercase px-2.5 py-1 rounded-pill ${styles}`}>
      {label}
    </span>
  );
}

function ProgressBar({ pct, done, total }: { pct: number; done: number; total: number }) {
  if (total === 0) return <span className="text-[12px] text-muted">—</span>;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-surface-strong rounded-pill overflow-hidden">
        <div
          className="h-full bg-ink rounded-pill transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[12px] text-muted whitespace-nowrap min-w-[3rem] text-right">
        {done}/{total}
      </span>
    </div>
  );
}
