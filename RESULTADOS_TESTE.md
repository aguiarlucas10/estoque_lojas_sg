# Resultados do teste end-to-end — 05/05/2026

Validação da arquitetura do sistema de estoque sem construir UI: parser do PDV → import de vendas → resolução de aliases/órfãos → recebimento → contagem com divergências → ajuste no ledger.

## Critérios do plano vs. real

| # | Critério | Meta | Real | Status |
|---|---|---|---|---|
| 1 | Parser do PDV extrai vendas/trocas do CSV de abril | ≥ 99% (1.844/1.862) | **100%** (1.862/1.862, 0 descartadas) | ✅ |
| 2 | Após pré-popular aliases + import: órfãos remanescentes | < 5 | **0 órfãos** | ✅ |
| 3 | Sessão de contagem amostragem fecha com `divergencias` corretas | qualitativo | 12 itens, 4 quebras detectadas, R$ -447,84 valorizado, 4 movimentos `contagem_validada` gerados | ✅ |
| 4 | `estoque_atual` consistente: `recebimentos − vendas + ajustes_contagem` | qualitativo | 116 SKUs com saldo ≠ 0 (12 positivos do recebimento + 104 negativos por venda sem recebimento prévio); ledger fecha (453 vendas + 12 entradas + 4 ajustes) | ✅ |

**Conclusão:** 4/4 critérios atingidos. Arquitetura validada. Pronto para Fase 1 (UI).

## Números reais

### Parser do PDV (`scripts/04_parser_pdv.py`)
- Tamanho do CSV: 1,57 MB
- Total de registros: **1.862** (1.823 vendas + 39 trocas)
- Distribuição por loja: BAL 552, MOO 503, GAR 417, NEU 390 (idêntica ao plano)
- Códigos únicos: 199 (116 alfanuméricos + 83 numéricos)
- 0 linhas descartadas

### Cadastros (`scripts/01_seed_lojas.py` + `02_seed_produtos.py`)
- 4 lojas (BAL, MOO, GAR, NEU) — atenção: `nome_pdv` da Mooca é `"QUIOSQUE MOOCA  PLAZA"` com **2 espaços**.
- 2.231 produtos importados:
  - 1.167 com nome PT-BR completo
  - 1.064 com SKU como nome (variantes `CLRx`/sem tradução; EAN populado)
- Categoria deduzida automaticamente em 1.052 dos 1.167 com nome (90%); 115 ficaram `null` para revisão (modelos nominais como "Nolita", "Versailles" sem palavra-chave de categoria).

### Resolução de aliases (`scripts/03_seed_aliases.py`)
- **86 órfãos identificados** (códigos `20xxx` do PDV legado) — bate com o plano.
- Após normalização (lower + sem acentos) e desempate por especificidade (Levenshtein como tiebreaker do `token_set_ratio`):
  - 74 com score 100, 11 com score ≥ 90, 1 com score 80
  - Nenhum abaixo de 70
- Pré-preenchimento automático do top-1 + revisão humana inline.
- 86/86 aliases inseridos em `lj_sku_aliases`.

### Import de vendas (`scripts/05_import_vendas.py --loja BAL --inicio 2026-04-01 --fim 2026-04-30`)
- 477 linhas filtradas (BAL, abril)
- **453 aplicadas** (vendas reais com qtd > 0) → 453 movimentos `venda` criados
- **0 órfãos**
- 24 ignoradas (39 trocas com qtd=0 do PDV inteiro, 24 caíram em BAL)
- Status final do import: `concluido`

### Recebimento simulado (`scripts/06_recebimento_simulado.py --loja BAL`)
- 12 SKUs com histórico de venda
- 145 unidades recebidas
- R$ 19.258,60 em valor de mercadoria
- Trigger `trg_lj_recebimento_item` gerou 12 movimentos `entrada_compra` e atualizou `lj_produtos.custo` automaticamente.

### Contagem simulada (`scripts/07_contagem_simulada.py --loja BAL`)
- 1 sessão amostragem, status `finalizada`
- 12 itens contados; com seed=7: 8 bateram, 4 quebras detectadas, 0 excessos (distribuição esperada com mais runs: 60/20/20)
- Quebra valorizada: **R$ -447,84**
- 4 movimentos `contagem_validada` gerados pela função `aplicar_contagem_validada`

## Achados não-óbvios

1. **Saldos negativos são esperados.** 104 dos 116 SKUs com saldo na BAL ficaram negativos porque vendas de abril foram importadas antes de qualquer recebimento desses produtos. O plano original ([PLANEJAMENTO Estoque.md:527](PLANEJAMENTO%20Estoque.md#L527)) prevê "fazer a primeira contagem geral em cada loja antes da primeira importação de vendas" — aqui pulamos esse passo deliberadamente para testar a importação. Em produção, a primeira contagem geral resolve automaticamente.

   *(Correção: o relatório original deste teste mencionava "20 SKUs com saldo" — era erro de print, eu havia limitado a query a 20 linhas e contei apenas os retornados. A UI do painel revelou o número real ao listar todos.)*

2. **Variantes da Nuvemshop sem nome PT-BR (1.064 SKUs).** São majoritariamente cadastros tipo `CLRx` (cordões/pulseiras de troca, peças menores) com EAN preenchido mas sem nome traduzido. Decisão: importar com SKU como placeholder de nome; categorização e nome corretos ficam para revisão pós-MVP. Não impacta o teste — bipagem por EAN funciona normalmente.

3. **Trocas vs vendas com mesmo doc.** 23 chaves `(doc, sku)` em BAL abril aparecem 2x ou mais no PDV — mistura de:
   - Cliente comprou 2 unidades do mesmo SKU (ex: `BXS2230` 2x Venda)
   - Venda + troca do mesmo SKU no mesmo doc (`20127`: 1 Venda + 1 Troca)
   - Mesma compra fragmentada em linhas (ex: `20012` aparece 4x como Venda no mesmo doc)
   
   Solução implementada: trocas e qtd=0 viram `status='ignorado'` (não geram movimento mas ficam no histórico); todas as Vendas com qtd>0 viram `status='aplicado'`. **Removido o índice unique `ux_lj_iv_linhas_dedup`** que estava bloqueando isso erroneamente. Dedup contra reimport do mesmo CSV agora é feito no início do script (verifica se já existe import com mesma loja+período).

## Decisões tomadas durante o teste

1. **Schema consolidado de 14 → 10 tabelas + 1 matview**, todas prefixadas com `lj_`:
   - Removidas: `usuarios`, `usuarios_lojas` (sem auth hoje)
   - Removida: `perdas` → vira movimento direto com `tipo='perda'` + coluna `motivo`
   - Fundidas: `sessoes_snapshot` + `contagens_item` + `divergencias` → `lj_sessoes_itens` (linha-por-SKU com `qtd_teorica` + `qtd_contada` + `status` de aprovação + `diferenca` generated)

2. **`supabase-py` substituído por cliente HTTP fino com `httpx`.** Motivo: dep transitiva `pyiceberg` exige MSVC para compilar no Python 3.14 Windows. Cliente em [scripts/_db.py](scripts/_db.py) (~120 linhas) cobre `select`/`insert`/`upsert`/`update`/`rpc` via REST API do Supabase. Sem perda funcional para o uso de scripts/seed.

3. **Legacy API keys do Supabase desabilitadas em 2026-03-31.** Migrado para o novo formato `sb_secret_*`.

## Próximos passos (Fase 1 do roadmap original)

Com a arquitetura validada, partir para o painel Next.js + PWA:
- Ativar RLS + auth (substituir service_role)
- Painel: cadastros + recebimento + perda + import (com upload de CSV) + tela de resolução de órfãos + tela de divergências
- PWA de contagem: bipagem online (offline com IndexedDB na Fase 2)
- Loja piloto: Balneário (já com dados deste teste populados)

## Arquivos chave criados

| Arquivo | Descrição |
|---|---|
| [db/01_schema.sql](db/01_schema.sql) | DDL completa (10 tabelas + matview, prefixo `lj_`) |
| [db/02_triggers.sql](db/02_triggers.sql) | Trigger de recebimento (entrada_compra + atualiza custo) |
| [db/03_funcoes.sql](db/03_funcoes.sql) | `refresh_estoque_atual`, `sugerir_produtos_por_nome`, `aplicar_contagem_validada` |
| [db/_all.sql](db/_all.sql) | Concatenação dos 3 acima (drop + recreate) — para colar no SQL Editor |
| [scripts/_db.py](scripts/_db.py) | Cliente HTTP minimal para Supabase REST |
| [scripts/04_parser_pdv.py](scripts/04_parser_pdv.py) | Parser standalone do PDV analítico → JSON |
| [scripts/01_seed_lojas.py](scripts/01_seed_lojas.py), [02_seed_produtos.py](scripts/02_seed_produtos.py), [03_seed_aliases.py](scripts/03_seed_aliases.py) | Seeds idempotentes |
| [scripts/05_import_vendas.py](scripts/05_import_vendas.py) | Import com resolução SKU/EAN/alias e dedup contra reimport |
| [scripts/06_recebimento_simulado.py](scripts/06_recebimento_simulado.py), [07_contagem_simulada.py](scripts/07_contagem_simulada.py) | Geradores de fluxo end-to-end |
| [data/vendas_parseadas.json](data/vendas_parseadas.json) | 1.862 registros parseados do PDV (cache) |
| [data/aliases_propostos.csv](data/aliases_propostos.csv) | 86 órfãos resolvidos com top-3 sugestões |
