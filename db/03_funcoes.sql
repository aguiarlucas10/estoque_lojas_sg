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
  v_saldo_atual numeric(12,3);
  v_ajuste      numeric(12,3);
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

  for d in
    select * from lj_sessoes_itens
     where sessao_id = p_sessao_id and status = 'aprovada'
  loop
    select coalesce(sum(qtd), 0) into v_saldo_atual
      from lj_movimentos_estoque
     where loja_id = v_loja_id and produto_id = d.produto_id;

    v_ajuste := d.qtd_contada - v_saldo_atual;

    if v_ajuste <> 0 then
      select custo into v_custo from lj_produtos where id = d.produto_id;
      insert into lj_movimentos_estoque (
        loja_id, produto_id, tipo, qtd, custo_unitario,
        data_evento, origem_tipo, origem_id
      ) values (
        v_loja_id, d.produto_id, 'contagem_validada', v_ajuste, v_custo,
        current_date, 'sessao_contagem', p_sessao_id
      );
      v_count := v_count + 1;
    end if;
  end loop;

  update lj_sessoes_contagem
     set status = 'finalizada',
         finalizada_em = now()
   where id = p_sessao_id;

  return v_count;
end;
$$;
