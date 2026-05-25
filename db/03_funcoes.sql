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


-- Cruza vendas importadas com bipagens de sessoes abertas (em_contagem/em_revisao)
-- da mesma loja do import. Para cada (sessao, produto), o "ultimo bip" eh o
-- max(bipado_em). Qualquer venda do PDV cujo (data_venda + hora_venda)
-- excede o ultimo bip desconta do qtd_contada da sessao.
--
-- Idempotente: ajuste_vendas_pos_bip armazena o total ja descontado.
-- Re-rodar o cruzamento aplica apenas o delta (vendas novas).
--
-- Sessoes ja 'finalizada' nao sao tocadas (qtd_contada virou movimento
-- contagem_validada e nao pode ser editado retroativamente).
create or replace function cruzar_vendas_pos_bipagem(p_import_id uuid)
returns table (sessao_id uuid, produto_id uuid, descontado numeric(12,3))
language plpgsql as $$
declare
  v_loja_id uuid;
begin
  select loja_id into v_loja_id
    from lj_imports_vendas where id = p_import_id;
  if v_loja_id is null then
    raise exception 'Import % nao encontrado', p_import_id;
  end if;

  return query
  with bipagens_por_produto as (
    select b.sessao_id, b.produto_id, max(b.bipado_em) as ultimo_bip
      from lj_sessoes_bipagens b
      join lj_sessoes_contagem s on s.id = b.sessao_id
     where s.loja_id = v_loja_id
       and s.status in ('em_contagem', 'em_revisao')
     group by b.sessao_id, b.produto_id
  ),
  vendas_pos_bip as (
    select bp.sessao_id, bp.produto_id,
           sum(l.qtd) as qtd_vendida
      from bipagens_por_produto bp
      join lj_imports_vendas_linhas l on l.produto_id = bp.produto_id
      join lj_imports_vendas i on i.id = l.import_id
     where i.loja_id = v_loja_id
       and l.status in ('aplicado', 'resolvido_manualmente')
       and l.operacao = 'Venda'
       -- data_venda + hora_venda eh horario local da loja; convertemos
       -- para timestamptz pra comparar com bipado_em (UTC).
       and (l.data_venda + coalesce(l.hora_venda, '00:00'::time))
             at time zone 'America/Sao_Paulo' > bp.ultimo_bip
     group by bp.sessao_id, bp.produto_id
  ),
  deltas as (
    -- delta = total de vendas pos-bip - o que ja foi descontado em runs anteriores.
    -- Garante idempotencia (rerodar nao duplica).
    select v.sessao_id, v.produto_id, v.qtd_vendida,
           (v.qtd_vendida - si.ajuste_vendas_pos_bip) as delta
      from vendas_pos_bip v
      join lj_sessoes_itens si
        on si.sessao_id = v.sessao_id and si.produto_id = v.produto_id
     where v.qtd_vendida > si.ajuste_vendas_pos_bip
  ),
  ajustes as (
    update lj_sessoes_itens si
       set qtd_contada = si.qtd_contada - d.delta,
           ajuste_vendas_pos_bip = d.qtd_vendida
      from deltas d
     where si.sessao_id = d.sessao_id
       and si.produto_id = d.produto_id
    returning si.sessao_id, si.produto_id, d.delta as descontado
  )
  select a.sessao_id, a.produto_id, a.descontado from ajustes a;
end;
$$;
