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

create materialized view lj_estoque_atual as
select
  loja_id,
  produto_id,
  sum(qtd)                                  as quantidade,
  max(case when tipo='contagem_validada'
           then data_evento end)            as ultima_contagem_em,
  max(criado_em)                            as atualizado_em
from lj_movimentos_estoque
group by loja_id, produto_id
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
