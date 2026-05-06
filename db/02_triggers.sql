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
