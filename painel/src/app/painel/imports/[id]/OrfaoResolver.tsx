"use client";

import { useState, useTransition } from "react";
import {
  resolverOrfaoAction,
  ignorarOrfaoAction,
  buscarProdutos,
} from "./actions";

export type Orfao = {
  codigo_origem: string;
  descricao_origem: string | null;
  qtd_aparicoes: number;
  qtd_total: number;
  sugestoes: { produto_id: string; sku: string; nome: string; score: number }[];
};

export function OrfaoResolver({
  import_id,
  loja_id,
  orfaos,
}: {
  import_id: string;
  loja_id: string;
  orfaos: Orfao[];
}) {
  const [resolvidos, setResolvidos] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});

  const visiveis = orfaos.filter((o) => !(o.codigo_origem in resolvidos));

  if (orfaos.length === 0) {
    return (
      <div className="bg-surface-card border border-hairline rounded-xl p-12 text-center">
        <p className="text-muted">Nenhum órfão pendente neste import.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(resolvidos).length > 0 && (
        <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-4 py-3 text-[14px] text-[#166534]">
          <strong className="font-semibold">{Object.keys(resolvidos).length}</strong> órfão(s)
          resolvido(s) nesta sessão.
        </div>
      )}

      {visiveis.map((o) => (
        <OrfaoCard
          key={o.codigo_origem}
          orfao={o}
          import_id={import_id}
          loja_id={loja_id}
          erro={erros[o.codigo_origem]}
          onResolved={(codigo, msg) =>
            setResolvidos((r) => ({ ...r, [codigo]: msg }))
          }
          onError={(codigo, msg) => setErros((e) => ({ ...e, [codigo]: msg }))}
        />
      ))}
    </div>
  );
}

function OrfaoCard({
  orfao,
  import_id,
  loja_id,
  erro,
  onResolved,
  onError,
}: {
  orfao: Orfao;
  import_id: string;
  loja_id: string;
  erro?: string;
  onResolved: (codigo: string, msg: string) => void;
  onError: (codigo: string, msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busca, setBusca] = useState(false);
  const [searchResults, setSearchResults] = useState<
    { id: string; sku: string; nome: string }[]
  >([]);
  const [searchQuery, setSearchQuery] = useState("");

  function aceitar(produto_id: string, sku: string) {
    startTransition(async () => {
      const r = await resolverOrfaoAction({
        import_id,
        loja_id,
        codigo_origem: orfao.codigo_origem,
        produto_id,
      });
      if (r.ok) {
        onResolved(orfao.codigo_origem, `→ ${sku}`);
      } else {
        onError(orfao.codigo_origem, r.message ?? "Erro");
      }
    });
  }

  function ignorar() {
    startTransition(async () => {
      const r = await ignorarOrfaoAction({
        import_id,
        codigo_origem: orfao.codigo_origem,
      });
      if (r.ok) {
        onResolved(orfao.codigo_origem, "ignorado");
      } else {
        onError(orfao.codigo_origem, r.message ?? "Erro");
      }
    });
  }

  async function fazerBusca(q: string) {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const results = await buscarProdutos(q);
    setSearchResults(results);
  }

  return (
    <div className="bg-surface-card border border-hairline rounded-xl p-6">
      <div className="flex items-start justify-between gap-6 mb-5">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[15px] text-ink font-medium">
              {orfao.codigo_origem}
            </span>
            <span className="caption-uppercase text-muted">
              {orfao.qtd_aparicoes} linha{orfao.qtd_aparicoes > 1 ? "s" : ""} ·{" "}
              {orfao.qtd_total} un
            </span>
          </div>
          <p className="text-[14px] text-body">{orfao.descricao_origem ?? "—"}</p>
        </div>
        <button
          onClick={ignorar}
          disabled={pending}
          className="text-[13px] text-muted hover:text-error disabled:opacity-50 whitespace-nowrap"
        >
          Ignorar
        </button>
      </div>

      <div className="space-y-2">
        {orfao.sugestoes.map((s, idx) => (
          <button
            key={s.produto_id}
            onClick={() => aceitar(s.produto_id, s.sku)}
            disabled={pending}
            className="w-full flex items-center justify-between gap-4 px-4 py-3 bg-canvas-soft border border-hairline-soft rounded-lg hover:border-ink hover:bg-canvas transition-colors disabled:opacity-50 text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-0.5">
                <span className="caption-uppercase text-muted">#{idx + 1}</span>
                <span className="font-mono text-[14px] text-ink font-medium">
                  {s.sku}
                </span>
                <ScoreBadge score={s.score} />
              </div>
              <div className="text-[13px] text-body truncate">{s.nome}</div>
            </div>
            <span className="text-[13px] text-ink font-medium whitespace-nowrap">
              Aceitar →
            </span>
          </button>
        ))}
        {orfao.sugestoes.length === 0 && (
          <div className="text-[13px] text-muted px-4 py-2">
            Sem sugestões automáticas — use a busca abaixo.
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-hairline-soft">
        {!busca ? (
          <button
            onClick={() => setBusca(true)}
            className="text-[13px] text-body hover:text-ink"
          >
            Buscar outro produto…
          </button>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              autoFocus
              placeholder="Digite SKU ou nome do produto…"
              value={searchQuery}
              onChange={(e) => fazerBusca(e.target.value)}
              className="w-full bg-surface-card border border-hairline-strong rounded-md px-4 py-2 text-[14px] focus:border-ink focus:outline-none"
            />
            {searchResults.length > 0 && (
              <div className="max-h-64 overflow-y-auto border border-hairline-soft rounded-md divide-y divide-hairline-soft">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => aceitar(p.id, p.sku)}
                    disabled={pending}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2 hover:bg-canvas-soft text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[13px] text-ink">{p.sku}</div>
                      <div className="text-[13px] text-body truncate">{p.nome}</div>
                    </div>
                    <span className="text-[13px] text-ink">→</span>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="text-[13px] text-muted px-2">Nenhum match</div>
            )}
          </div>
        )}
      </div>

      {erro && (
        <div className="mt-4 text-[13px] text-error">Erro: {erro}</div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  let tone = "bg-surface-strong text-muted";
  if (pct >= 80) tone = "bg-[#dcfce7] text-[#15803d]";
  else if (pct >= 60) tone = "bg-[#fef9c3] text-[#854d0e]";
  return (
    <span className={`caption-uppercase rounded-pill px-2 py-0.5 ${tone}`}>
      {pct}%
    </span>
  );
}
