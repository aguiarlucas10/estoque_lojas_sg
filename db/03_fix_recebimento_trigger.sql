-- ============================================================
-- FIX: recebimentos não geravam movimento de estoque
-- ============================================================
-- Diagnóstico (16/06/2026): existiam 7 recebimentos e 165 itens
-- (lj_recebimentos_itens), porém 0 movimentos 'entrada_compra' em
-- lj_movimentos_estoque. O trigger trg_lj_recebimento_item (db/02_triggers.sql)
-- não estava ativo em produção — provavelmente um re-run do 01_schema.sql
-- dropou a tabela em cascata e levou o trigger junto, sem reaplicar o 02.
--
-- Consequência na tela "Estoque atual": coluna Últ. Recebimento vazia,
-- saldo sem somar o recebido, custo/Valor estimado zerados.
--
-- Este script é IDEMPOTENTE: pode rodar mais de uma vez sem duplicar.
-- Rodar no SQL Editor do Supabase.

-- 1) (Re)cria a função + trigger (igual ao 02_triggers.sql)
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

-- 2) Backfill dos movimentos que faltaram (itens já lançados sem movimento).
--    criado_em = data_recebimento (não now()) para que a matview respeite a
--    regra "saldo = contagem + movimentos APÓS a contagem": recebimentos
--    anteriores à última contagem ficam corretamente de fora (já absorvidos),
--    e os posteriores entram no saldo.
insert into lj_movimentos_estoque (
  loja_id, produto_id, tipo, qtd, custo_unitario,
  data_evento, origem_tipo, origem_id, criado_em
)
select
  r.loja_id, ri.produto_id, 'entrada_compra', ri.qtd, ri.custo_unitario,
  r.data_recebimento, 'recebimento', ri.id, r.data_recebimento::timestamptz
from lj_recebimentos_itens ri
join lj_recebimentos r on r.id = ri.recebimento_id
where not exists (
  select 1 from lj_movimentos_estoque m
  where m.origem_tipo = 'recebimento' and m.origem_id = ri.id
);

-- 3) Atualiza custo do produto a partir do recebimento mais recente.
--    Guard: só sobrescreve quando há custo real (> 0). Hoje os 165 itens
--    estão com custo_unitario = 0, então na prática nada muda aqui — o
--    "Valor estimado" só deixará de ser R$ 0 quando os recebimentos
--    passarem a registrar o custo unitário de verdade.
update lj_produtos p
   set custo = sub.custo_unitario,
       atualizado_em = now()
  from (
    select distinct on (ri.produto_id)
           ri.produto_id, ri.custo_unitario
    from lj_recebimentos_itens ri
    join lj_recebimentos r on r.id = ri.recebimento_id
    where ri.custo_unitario > 0
    order by ri.produto_id, r.data_recebimento desc, r.criado_em desc
  ) sub
 where p.id = sub.produto_id;

-- 4) Atualiza a matview do estoque
refresh materialized view lj_estoque_atual;

-- 5) Conferência (opcional): deve listar os movimentos recém-criados
-- select tipo, count(*), min(data_evento), max(data_evento)
--   from lj_movimentos_estoque
--  where tipo = 'entrada_compra'
--  group by tipo;
