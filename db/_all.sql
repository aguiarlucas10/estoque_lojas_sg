-- ===== db/01_schema.sql =====

-- Schema do sistema de estoque Saint Germain (teste end-to-end)
-- Idempotente: comeca dropando tudo (lj_* e legados) e recria limpo.
-- Sem RLS por hoje (single-user via service_role).

-- ============================================================
-- Reset (drop tabelas/views/funcoes anteriores, lj_ e legados)
-- ============================================================
drop materialized view if exists estoque_atual cascade;
drop materialized view if exists lj_estoque_atual cascade;

drop table if exists
  lojas, produtos, sku_aliases, usuarios, usuarios_lojas,
  movimentos_estoque, recebimentos, recebimentos_itens, perdas,
  imports_vendas, imports_vendas_linhas,
  sessoes_contagem, sessoes_snapshot, contagens_item, divergencias,
  lj_lojas, lj_produtos, lj_sku_aliases, lj_movimentos_estoque,
  lj_recebimentos, lj_recebimentos_itens,
  lj_imports_vendas, lj_imports_vendas_linhas,
  lj_sessoes_contagem, lj_sessoes_itens
  cascade;

drop function if exists refresh_estoque_atual() cascade;
drop function if exists sugerir_produtos_por_nome(text, int) cascade;
drop function if exists gerar_divergencias(uuid) cascade;
drop function if exists aplicar_contagem_validada(uuid) cascade;
drop function if exists trg_recebimento_item_after_insert() cascade;
drop function if exists trg_perda_after_insert() cascade;

-- ============================================================
-- Extensoes
-- ============================================================
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ============================================================
-- Cadastros
-- ============================================================
create table lj_lojas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  codigo      text unique not null,
  nome_pdv    text,
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table lj_produtos (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique not null,
  ean           text,
  nome          text not null,
  categoria     text,
  subcategoria  text,
  custo         numeric(12,2),
  preco_venda   numeric(12,2),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index idx_lj_produtos_ean on lj_produtos (ean) where ean is not null;
create index idx_lj_produtos_nome_trgm on lj_produtos using gin (nome gin_trgm_ops);

create table lj_sku_aliases (
  id            uuid primary key default gen_random_uuid(),
  produto_id    uuid not null references lj_produtos(id),
  codigo_alias  text not null,
  origem        text not null check (origem in ('pdv_legado','ean','manual','nuvemshop_antigo')),
  criado_em     timestamptz not null default now(),
  criado_por    uuid,
  unique (codigo_alias, origem)
);
create index idx_lj_sku_aliases_codigo on lj_sku_aliases (codigo_alias);
create index idx_lj_sku_aliases_produto on lj_sku_aliases (produto_id);

-- ============================================================
-- Ledger imutavel  (perdas viram movimento direto com motivo)
-- ============================================================
create table lj_movimentos_estoque (
  id              uuid primary key default gen_random_uuid(),
  loja_id         uuid not null references lj_lojas(id),
  produto_id      uuid not null references lj_produtos(id),
  tipo            text not null check (tipo in (
                    'contagem_validada','venda','troca',
                    'entrada_compra','perda','ajuste_manual')),
  qtd             numeric(12,3) not null,
  custo_unitario  numeric(12,2),
  data_evento     date not null,
  origem_tipo     text not null check (origem_tipo in (
                    'sessao_contagem','import_vendas',
                    'recebimento','perda','manual')),
  origem_id       uuid,
  motivo          text,            -- usado quando tipo='perda' (furto/quebra/vencimento/avaria)
  observacao      text,
  criado_em       timestamptz not null default now(),
  criado_por      uuid
);
create index idx_lj_mov_loja_produto_data on lj_movimentos_estoque (loja_id, produto_id, data_evento);
create index idx_lj_mov_origem on lj_movimentos_estoque (origem_tipo, origem_id);
create index idx_lj_mov_criado_em on lj_movimentos_estoque (criado_em);

-- A última contagem validada de cada (loja, produto) é o "snapshot do real".
-- O saldo atual é a qtd contada + movimentos criados APÓS a contagem.
-- Movimentos criados antes da contagem (ou imports retroativos) ficam fora —
-- já foram absorvidos no ajuste que a contagem gerou.
create materialized view lj_estoque_atual as
with ultimas_contagens as (
  select loja_id, produto_id, max(criado_em) as contagem_em
  from lj_movimentos_estoque
  where tipo = 'contagem_validada'
  group by loja_id, produto_id
)
select
  m.loja_id,
  m.produto_id,
  sum(m.qtd) filter (
    where uc.contagem_em is null or m.criado_em >= uc.contagem_em
  )                                          as quantidade,
  max(case when m.tipo='contagem_validada'
           then m.data_evento end)           as ultima_contagem_em,
  max(case when m.tipo='entrada_compra'
           then m.data_evento end)           as ultimo_recebimento_em,
  max(case when m.tipo='venda'
           then m.data_evento end)           as ultima_venda_em,
  max(m.criado_em)                           as atualizado_em
from lj_movimentos_estoque m
left join ultimas_contagens uc
  on uc.loja_id = m.loja_id and uc.produto_id = m.produto_id
group by m.loja_id, m.produto_id
with no data;

create unique index ux_lj_estoque_atual on lj_estoque_atual (loja_id, produto_id);

-- ============================================================
-- Recebimentos
-- ============================================================
create table lj_recebimentos (
  id                 uuid primary key default gen_random_uuid(),
  loja_id            uuid not null references lj_lojas(id),
  fornecedor         text,
  nf_numero          text,
  data_recebimento   date not null,
  total_itens        int,
  total_valor        numeric(12,2),
  recebido_por       uuid,
  observacao         text,
  criado_em          timestamptz not null default now()
);

create table lj_recebimentos_itens (
  id              uuid primary key default gen_random_uuid(),
  recebimento_id  uuid not null references lj_recebimentos(id) on delete cascade,
  produto_id      uuid not null references lj_produtos(id),
  qtd             numeric(12,3) not null check (qtd > 0),
  custo_unitario  numeric(12,2) not null check (custo_unitario >= 0)
);
create index idx_lj_receb_itens_recebimento on lj_recebimentos_itens (recebimento_id);

-- ============================================================
-- Importacao de vendas (PDV -> sistema)
-- ============================================================
create table lj_imports_vendas (
  id                            uuid primary key default gen_random_uuid(),
  loja_id                       uuid not null references lj_lojas(id),
  fonte                         text not null check (fonte in ('pdv_analitico','manual')),
  periodo_inicio                date not null,
  periodo_fim                   date not null,
  arquivo_nome                  text,
  total_linhas                  int,
  total_vendas                  int,
  total_trocas                  int,
  total_skus_nao_encontrados    int,
  status                        text not null check (status in ('processando','aguardando_resolucao','concluido','erro')),
  importado_por                 uuid,
  importado_em                  timestamptz not null default now()
);

create table lj_imports_vendas_linhas (
  id                uuid primary key default gen_random_uuid(),
  import_id         uuid not null references lj_imports_vendas(id) on delete cascade,
  codigo_origem     text not null,
  descricao_origem  text,
  produto_id        uuid references lj_produtos(id),
  doc_pdv           text,
  data_venda        date not null,
  hora_venda        time,
  vendedor          text,
  qtd               numeric(12,3) not null,
  operacao          text not null check (operacao in ('Venda','Troca')),
  preco_praticado   numeric(12,2),
  preco_tabela      numeric(12,2),
  status            text not null check (status in ('aplicado','orfao','duplicado_doc','ignorado','resolvido_manualmente'))
);
create index idx_lj_iv_linhas_import_status on lj_imports_vendas_linhas (import_id, status);
create index idx_lj_iv_linhas_codigo on lj_imports_vendas_linhas (codigo_origem);
-- Sem indice unique por (import_id, doc, codigo): vendas reais podem se
-- repetir (cliente comprou 2 unidades do mesmo SKU, ou venda + troca no
-- mesmo doc). Dedup contra reimport do mesmo CSV vira responsabilidade
-- do script (checa import previo de mesma loja+periodo antes de criar).

-- ============================================================
-- Sessoes de contagem (snapshot + contagem + divergencia em 1 tabela)
-- ============================================================
create table lj_sessoes_contagem (
  id              uuid primary key default gen_random_uuid(),
  loja_id         uuid not null references lj_lojas(id),
  tipo            text not null check (tipo in ('geral','amostragem')),
  status          text not null check (status in ('aberta','em_contagem','em_revisao','finalizada','cancelada')),
  escopo          jsonb,
  iniciada_em     timestamptz,
  finalizada_em   timestamptz,
  responsavel_id  uuid,
  observacao      text,
  criado_em       timestamptz not null default now()
);

-- 1 linha por (sessao, produto): congela qtd_teorica na criacao,
-- recebe qtd_contada via bipagens (update incremental), tem status de aprovacao.
create table lj_sessoes_itens (
  sessao_id        uuid not null references lj_sessoes_contagem(id) on delete cascade,
  produto_id       uuid not null references lj_produtos(id),
  qtd_teorica      numeric(12,3) not null,
  qtd_contada      numeric(12,3) not null default 0,
  diferenca        numeric(12,3) generated always as (qtd_contada - qtd_teorica) stored,
  valor_diferenca  numeric(12,2),
  status           text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada','recontar')),
  motivo_provavel  text,
  aprovado_por     uuid,
  aprovado_em      timestamptz,
  observacao       text,
  primary key (sessao_id, produto_id)
);
create index idx_lj_sessoes_itens_status on lj_sessoes_itens (sessao_id, status);


-- ===== db/02_triggers.sql =====

-- Triggers que alimentam o ledger lj_movimentos_estoque

-- Recebimento de item -> entrada_compra + atualiza custo do produto
create or replace function trg_lj_recebimento_item_after_insert()
returns trigger language plpgsql as $$
declare
  v_loja_id uuid;
  v_data    date;
begin
  select loja_id, data_recebimento into v_loja_id, v_data
    from lj_recebimentos where id = NEW.recebimento_id;

  insert into lj_movimentos_estoque (
    loja_id, produto_id, tipo, qtd, custo_unitario,
    data_evento, origem_tipo, origem_id
  ) values (
    v_loja_id, NEW.produto_id, 'entrada_compra', NEW.qtd, NEW.custo_unitario,
    v_data, 'recebimento', NEW.id
  );

  update lj_produtos
     set custo = NEW.custo_unitario,
         atualizado_em = now()
   where id = NEW.produto_id;

  return NEW;
end;
$$;

drop trigger if exists trg_lj_recebimento_item on lj_recebimentos_itens;
create trigger trg_lj_recebimento_item
  after insert on lj_recebimentos_itens
  for each row execute function trg_lj_recebimento_item_after_insert();


-- ===== db/03_funcoes.sql =====

-- Funcoes RPC chamadas dos scripts

-- Retorna os docs distintos de uma loja que ja estao aplicados em algum
-- import anterior. Usado para dedup: linhas com doc na lista viram
-- 'duplicado_doc' no novo import (preserva o caso de cliente comprar
-- multiplas unidades dentro de um mesmo doc).
create or replace function docs_aplicados_da_loja(p_loja_id uuid)
returns table (doc_pdv text) language sql stable as $$
  select distinct l.doc_pdv
    from lj_imports_vendas_linhas l
    join lj_imports_vendas i on i.id = l.import_id
   where i.loja_id = p_loja_id
     and l.doc_pdv is not null
     and l.status in ('aplicado', 'resolvido_manualmente');
$$;


create or replace function refresh_estoque_atual()
returns void language plpgsql as $$
begin
  refresh materialized view lj_estoque_atual;
end;
$$;


-- Sugestoes top-N por similaridade de nome (pg_trgm)
create or replace function sugerir_produtos_por_nome(texto text, limite int default 3)
returns table (produto_id uuid, sku text, nome text, score real)
language sql stable as $$
  select p.id, p.sku, p.nome,
         similarity(unaccent(lower(p.nome)), unaccent(lower(texto)))::real as score
    from lj_produtos p
   where p.ativo = true
     and similarity(unaccent(lower(p.nome)), unaccent(lower(texto))) >= 0.2
   order by similarity(unaccent(lower(p.nome)), unaccent(lower(texto))) desc
   limit limite;
$$;


-- Aplica itens aprovados da sessao: gera movimentos contagem_validada que
-- ajustam o saldo derivado para qtd_contada. Atualiza valor_diferenca usando
-- custo do produto. Marca sessao como finalizada.
create or replace function aplicar_contagem_validada(p_sessao_id uuid)
returns int language plpgsql as $$
declare
  v_loja_id     uuid;
  v_count       int := 0;
  d             record;
  v_custo       numeric(12,2);
begin
  select loja_id into v_loja_id
    from lj_sessoes_contagem where id = p_sessao_id;
  if v_loja_id is null then
    raise exception 'Sessao % nao encontrada', p_sessao_id;
  end if;

  -- preenche valor_diferenca para todos os itens da sessao
  update lj_sessoes_itens si
     set valor_diferenca = si.diferenca * p.custo
    from lj_produtos p
   where si.produto_id = p.id
     and si.sessao_id = p_sessao_id
     and p.custo is not null;

  -- A contagem é a "fonte de verdade" do saldo naquele momento.
  -- Inserimos o valor absoluto (qtd_contada) — não o delta. A matview
  -- soma apenas movimentos com criado_em >= contagem.criado_em, então
  -- o saldo atual fica = qtd_contada + eventos genuínos posteriores.
  for d in
    select * from lj_sessoes_itens
     where sessao_id = p_sessao_id and status = 'aprovada'
  loop
    select custo into v_custo from lj_produtos where id = d.produto_id;
    insert into lj_movimentos_estoque (
      loja_id, produto_id, tipo, qtd, custo_unitario,
      data_evento, origem_tipo, origem_id
    ) values (
      v_loja_id, d.produto_id, 'contagem_validada', d.qtd_contada, v_custo,
      current_date, 'sessao_contagem', p_sessao_id
    );
    v_count := v_count + 1;
  end loop;

  update lj_sessoes_contagem
     set status = 'finalizada',
         finalizada_em = now()
   where id = p_sessao_id;

  return v_count;
end;
$$;
