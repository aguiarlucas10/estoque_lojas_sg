# Sistema de Contagem de Estoque — Saint Germain

**Status:** Planejamento fechado — pronto para execução
**Última atualização:** 05/05/2026

---

## 1. Contexto e objetivo

A Saint Germain opera 4 quiosques físicos (Balneário Shopping, Mooca Plaza, Garten Shopping, Neumarkt Shopping) e uma operação online via Nuvemshop. Existe um sistema de PDV legado nas lojas físicas que registra vendas razoavelmente bem, mas a função de **contagem de estoque** é deficiente e não é confiável para análise de quebra, ruptura ou divergência.

**Objetivo:** construir um sistema independente de contagem que seja a **fonte de verdade do estoque físico em cada loja**, alimentado por:

1. Contagens periódicas (gerais e por amostragem) — fonte primária de verdade
2. Importação do relatório analítico de vendas do PDV (entre contagens, abate o estoque)
3. Registro de recebimentos (NF de fornecedor) — entradas de mercadoria
4. Registro de perdas (furto, quebra, vencimento, avaria) — saídas não-vendidas

**O que o sistema NÃO faz:**

- Não é PDV (não registra venda em tempo real — confia no PDV legado e importa CSV)
- Não emite NF-e
- Não controla transferências entre lojas (cada loja é isolada)
- Não controla estoque online da Nuvemshop (escopo é só lojas físicas)

---

## 2. Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Quantidade de lojas | 4-10 (hoje 4) |
| Tipos de contagem | Inventário geral + amostragem |
| Sistema atual | Existe PDV legado, mantém-se em paralelo |
| Modelo do sistema novo | Fonte de verdade do estoque físico, alimentado por importação de vendas |
| Transferências entre lojas | Não suportadas |
| Tipos de movimento de entrada | Recebimento (NF) + Perda separada |
| Modo de contagem | 1 contador por SKU (sem dupla cega) |
| Método de contagem | Leitor de código de barras (EAN) |
| SKU canônico | SKU da Nuvemshop |
| EAN físico nos produtos | Sim, todos têm EAN imprimido |
| Origem do custo | Último custo do recebimento de NF |
| Resolução de SKUs órfãos | Tela com sugestão automática por similaridade (MVP) |
| Categorias de produto | Relógio, Óculos de Sol, Óculos de Grau, Semijoias, Embalagem |
| Códigos de loja | BAL (Balneário), MOO (Mooca), GAR (Garten), NEU (Neumarkt) |
| Custo inicial dos produtos | `null` no cadastro inicial, populado via recebimentos |
| Estoque inicial | Zerado — primeira contagem geral de cada loja vira a linha zero |
| Cadência de importação e contagem | Semanal (import do PDV + contagem por amostragem) |
| Inventário geral | Trimestral ou semestral |
| Usuário admin inicial | `admin@saintgermainbrand.com.br` (senha temporária só pra ambiente de teste) |

---

## 3. Achados da análise dos arquivos enviados

### 3.1. `Info_Cadastro.csv` — export padrão da Nuvemshop

- **2.231 produtos**, encoding `latin-1`, separador `;`
- Colunas: `SKU`, `Nome (Português)`, `Código de barras`, dimensões, SEO, `Sexo`
- SKUs todos alfanuméricos (`HFB40`, `MBH40`, `NR32`, etc.)
- EAN populado em **2.227 dos 2.231** produtos (99,8%) — viável para bipagem
- **Lacunas a suprir:** o export não traz `categoria`, `subcategoria` nem `custo`. Vão precisar ser cadastrados no novo sistema (custo pode vir do recebimento; categoria precisa ser definida).

### 3.2. `pdv_analitico_.csv` — relatório do PDV físico

- **1.862 vendas** no período 01/04 a 30/04/2026 (1.823 vendas + 39 trocas)
- Encoding **UTF-8** (não latin-1), separador `,`
- Distribuição por loja: Balneário (552), Mooca (503), Garten (417), Neumarkt (390)
- **Formato:** relatório impresso, não export estruturado. Cabeçalho de campos repete a cada linha de venda. Vai exigir **parser por regex** (não dá pra usar `pd.read_csv` direto)
- Campos extraíveis por venda: loja, vendedor, doc, data, hora, valor, dinheiro, cartão, PIX, código do item, descrição, P. Praticado, P. Tabela, Operação (Venda/Troca), Qtd
- Datas vêm no formato `dd/mm/aa` (ano com 2 dígitos — atenção no parse)

### 3.3. ⚠️ Problema crítico: códigos divergentes entre PDV e Nuvemshop

Dos **199 códigos únicos** vendidos no período:

| Tipo | Qtd | Match com SKU canônico (Nuvemshop) |
|---|---|---|
| Alfanuméricos (`HFB40`, `CLG24`...) | 116 | 113 batem ✅ |
| Numéricos (`20139`, `20070`...) | 83 | 0 batem ❌ |

Os códigos `20xxx` apontam para **produtos que existem no cadastro Nuvemshop**, só estão registrados com SKU diferente no PDV (provavelmente código sequencial interno antigo). Conferimos por similaridade de nome — todos os testados correspondem.

**Implicação:** ~42% dos códigos da primeira importação serão "órfãos". A tabela `sku_aliases` é fundamental, e a tela de resolução com sugestão automática vai limpar esses 86 órfãos em ~10 minutos no início da operação.

---

## 4. Arquitetura do sistema

### 4.1. Stack escolhida

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Banco de dados + Auth + Realtime | Supabase (Postgres) | Auth pronta, RLS poderosa, Realtime pra dashboard ao vivo, custo baixo |
| App de contagem (tablet em loja) | PWA (Next.js + IndexedDB) | Funciona offline, atualização instantânea, não depende de loja de app |
| Painel de gestão (web) | Next.js | Mesma stack do app, simplifica manutenção |
| Bipagem | Câmera (`@zxing/browser`) ou leitor Bluetooth físico | Bluetooth físico é mais rápido em inventário grande; câmera serve de fallback |
| Importação de PDV | Parser server-side em Node ou Python | Função Edge no Supabase ou rota interna do Next |
| Hospedagem | Vercel (front) + Supabase (back) | Custo baixo, deploy fácil |

### 4.2. Modelo conceitual

O coração do sistema é um **ledger imutável** (`movimentos_estoque`). Toda alteração de estoque vira uma linha aqui — entrada, venda, perda, ajuste de contagem. O estoque atual é **sempre derivado** dessa soma, nunca editado direto. Isso elimina toda uma classe de bugs ("o estoque não bate com o histórico") e dá auditoria completa de graça.

```
                    ┌─────────────────────┐
                    │  movimentos_estoque │  (ledger imutável)
                    │  append-only        │
                    └──────────▲──────────┘
                               │
       ┌───────────────┬───────┴───────┬──────────────────┐
       │               │               │                  │
  ┌────┴─────┐  ┌──────┴─────┐  ┌──────┴─────┐  ┌─────────┴──────┐
  │recebimen-│  │imports_    │  │perdas      │  │contagens       │
  │tos       │  │vendas      │  │            │  │validadas       │
  │(entrada) │  │(saída)     │  │(saída)     │  │(reset/ajuste)  │
  └──────────┘  └────────────┘  └────────────┘  └────────────────┘

                    ┌─────────────────────┐
                    │   estoque_atual     │  (view materializada)
                    │   = SUM(movimentos) │
                    └─────────────────────┘
```

---

## 5. Estrutura final do banco

### 5.1. Cadastros base

```sql
lojas (
  id          uuid pk default gen_random_uuid(),
  nome        text not null,
  codigo      text unique not null,        -- 'BAL', 'MOO', 'GAR', 'NEU'
  nome_pdv    text,                         -- 'QUIOSQUE BALNEARIO SHOPPING' (pra match no import)
  ativa       boolean default true,
  criado_em   timestamptz default now()
)

produtos (
  id            uuid pk default gen_random_uuid(),
  sku           text unique not null,       -- SKU canônico = SKU da Nuvemshop
  ean           text,                        -- código de barras pra bipagem
  nome          text not null,
  categoria     text,                        -- relógio, óculos sol, óculos grau, bracelete, acessório...
  subcategoria  text,                        -- masculino, feminino, unissex (do campo 'Sexo')
  custo         numeric(12,2),              -- último custo conhecido (atualizado pelo recebimento)
  preco_venda   numeric(12,2),
  ativo         boolean default true,
  criado_em     timestamptz default now(),
  atualizado_em timestamptz default now()
)
-- ÍNDICES: ean, sku (já é unique), nome (gin trigram pra busca/similaridade)

sku_aliases (
  id            uuid pk default gen_random_uuid(),
  produto_id    uuid not null references produtos(id),
  codigo_alias  text not null,
  origem        text not null,              -- 'pdv_legado', 'ean', 'manual', 'nuvemshop_antigo'
  criado_em     timestamptz default now(),
  criado_por    uuid references usuarios(id),
  unique (codigo_alias, origem)
)
-- Importante: um produto pode ter N aliases (PDV legado + EAN curto + variantes históricas)

usuarios (
  id            uuid pk,                     -- referencia auth.users do Supabase
  nome          text not null,
  email         text unique not null,
  role          text not null,               -- 'contador', 'supervisor', 'gestor', 'admin'
  ativo         boolean default true,
  criado_em     timestamptz default now()
)

usuarios_lojas (
  usuario_id    uuid references usuarios(id),
  loja_id       uuid references lojas(id),
  primary key (usuario_id, loja_id)
)
```

### 5.2. Ledger e estoque

```sql
movimentos_estoque (
  id              uuid pk default gen_random_uuid(),
  loja_id         uuid not null references lojas(id),
  produto_id      uuid not null references produtos(id),
  tipo            text not null,             -- 'contagem_validada', 'venda', 'troca',
                                              -- 'entrada_compra', 'perda', 'ajuste_manual'
  qtd             numeric(12,3) not null,    -- positivo entra, negativo sai
  custo_unitario  numeric(12,2),             -- snapshot do custo no momento (pra valorização correta)
  data_evento     date not null,             -- data do fato (permite import retroativo)
  origem_tipo     text not null,             -- 'sessao_contagem', 'import_vendas',
                                              -- 'recebimento', 'perda', 'manual'
  origem_id       uuid not null,             -- aponta pra tabela de origem
  observacao      text,
  criado_em       timestamptz default now(),
  criado_por      uuid references usuarios(id)
)
-- ÍNDICES:
--   (loja_id, produto_id, data_evento)  -- pra calcular estoque
--   (origem_tipo, origem_id)             -- pra rastrear origem
--   (criado_em)                          -- pra auditoria

-- View materializada com estoque atual (refresh após operações)
create materialized view estoque_atual as
select
  loja_id,
  produto_id,
  sum(qtd)                                  as quantidade,
  max(case when tipo = 'contagem_validada'
           then data_evento end)            as ultima_contagem_em,
  max(criado_em)                            as atualizado_em
from movimentos_estoque
group by loja_id, produto_id;

create unique index on estoque_atual (loja_id, produto_id);
```

### 5.3. Entradas de mercadoria

```sql
recebimentos (
  id                 uuid pk default gen_random_uuid(),
  loja_id            uuid not null references lojas(id),
  fornecedor         text,
  nf_numero          text,
  data_recebimento   date not null,
  total_itens        int,
  total_valor        numeric(12,2),
  recebido_por       uuid references usuarios(id),
  observacao         text,
  criado_em          timestamptz default now()
)

recebimentos_itens (
  id              uuid pk default gen_random_uuid(),
  recebimento_id  uuid not null references recebimentos(id) on delete cascade,
  produto_id      uuid not null references produtos(id),
  qtd             numeric(12,3) not null,
  custo_unitario  numeric(12,2) not null
)
-- TRIGGER: ao inserir item, gera linha em movimentos_estoque (tipo='entrada_compra')
--          e atualiza produtos.custo (último custo conhecido)

perdas (
  id              uuid pk default gen_random_uuid(),
  loja_id         uuid not null references lojas(id),
  produto_id      uuid not null references produtos(id),
  qtd             numeric(12,3) not null,
  motivo          text not null,             -- 'furto', 'quebra', 'vencimento', 'avaria', 'outro'
  data_evento     date not null,
  registrado_por  uuid references usuarios(id),
  observacao      text,
  criado_em       timestamptz default now()
)
-- TRIGGER: gera movimentos_estoque com qtd negativa (tipo='perda')
```

### 5.4. Importação de vendas (PDV → sistema)

```sql
imports_vendas (
  id                            uuid pk default gen_random_uuid(),
  loja_id                       uuid not null references lojas(id),
  fonte                         text not null,    -- 'pdv_analitico', 'manual'
  periodo_inicio                date not null,
  periodo_fim                   date not null,
  arquivo_nome                  text,
  total_linhas                  int,
  total_vendas                  int,
  total_trocas                  int,
  total_skus_nao_encontrados    int,
  status                        text not null,    -- 'processando', 'aguardando_resolucao',
                                                   -- 'concluido', 'erro'
  importado_por                 uuid references usuarios(id),
  importado_em                  timestamptz default now()
)

imports_vendas_linhas (
  id                uuid pk default gen_random_uuid(),
  import_id         uuid not null references imports_vendas(id) on delete cascade,
  codigo_origem     text not null,               -- código bruto do CSV (SKU, alias, ou desconhecido)
  descricao_origem  text,                         -- descrição que veio no CSV (ajuda a casar órfãos)
  produto_id        uuid references produtos(id), -- null se órfão
  doc_pdv           text,                         -- número do documento PDV (pra deduplicação)
  data_venda        date not null,
  hora_venda        time,
  vendedor          text,
  qtd               numeric(12,3) not null,
  operacao          text not null,                -- 'venda', 'troca'
  preco_praticado   numeric(12,2),
  preco_tabela      numeric(12,2),
  status            text not null                 -- 'aplicado', 'orfao', 'duplicado_doc',
                                                   -- 'ignorado', 'resolvido_manualmente'
)
-- ÍNDICES: (import_id, status), (codigo_origem) pra busca de órfãos recorrentes
-- Constraint de deduplicação: (loja_id, doc_pdv, codigo_origem) único quando status='aplicado'
```

### 5.5. Contagem

```sql
sessoes_contagem (
  id              uuid pk default gen_random_uuid(),
  loja_id         uuid not null references lojas(id),
  tipo            text not null,                  -- 'geral', 'amostragem'
  status          text not null,                  -- 'aberta', 'em_contagem', 'em_revisao',
                                                   -- 'finalizada', 'cancelada'
  escopo          jsonb,                           -- {categorias:[], skus:[], etc} — só amostragem
  iniciada_em     timestamptz,
  finalizada_em   timestamptz,
  responsavel_id  uuid references usuarios(id),
  observacao      text,
  criado_em       timestamptz default now()
)

sessoes_snapshot (
  sessao_id    uuid not null references sessoes_contagem(id) on delete cascade,
  produto_id   uuid not null references produtos(id),
  qtd_teorica  numeric(12,3) not null,
  primary key (sessao_id, produto_id)
)
-- Congela o estoque teórico no início da sessão, pra comparação não ser afetada
-- por imports/movimentos que entrem durante a contagem.

contagens_item (
  id                uuid pk default gen_random_uuid(),
  sessao_id         uuid not null references sessoes_contagem(id) on delete cascade,
  produto_id        uuid not null references produtos(id),
  qtd_contada       numeric(12,3) not null,
  contador_id       uuid references usuarios(id),
  dispositivo_id    text,                          -- identifica o tablet (sync offline)
  contado_em        timestamptz not null,          -- timestamp local do tablet
  sincronizado_em   timestamptz default now()      -- chegou no servidor
)
-- Múltiplas linhas por (sessao, produto) são permitidas — bipagens incrementais
-- vão somando. Estoque contado final = SUM(qtd_contada).

divergencias (
  id                  uuid pk default gen_random_uuid(),
  sessao_id           uuid not null references sessoes_contagem(id),
  produto_id          uuid not null references produtos(id),
  qtd_teorica         numeric(12,3) not null,
  qtd_contada         numeric(12,3) not null,
  diferenca           numeric(12,3) not null,      -- contada - teorica
  valor_diferenca     numeric(12,2),                -- diferenca * custo
  status              text not null,                -- 'pendente', 'aprovada', 'rejeitada', 'recontar'
  motivo_provavel     text,                          -- 'furto_suspeito', 'erro_recebimento',
                                                     -- 'erro_import_vendas', 'outro'
  aprovado_por        uuid references usuarios(id),
  aprovado_em         timestamptz,
  observacao          text
)
```

---

## 6. Fluxos principais

### 6.1. Fluxo: Recebimento de mercadoria

1. Funcionário abre "Novo Recebimento" no painel
2. Informa fornecedor, NF, data
3. Bipa cada item ou seleciona produto + qtd + custo
4. Confirma → trigger gera linhas em `movimentos_estoque` (tipo `entrada_compra`)
5. Trigger atualiza `produtos.custo` com o último custo
6. Refresh de `estoque_atual`

### 6.2. Fluxo: Registro de perda

1. Gestor/supervisor abre "Registrar Perda"
2. Loja, produto, qtd, motivo (furto/quebra/vencimento/avaria), observação
3. Trigger gera linha em `movimentos_estoque` (tipo `perda`, qtd negativa)
4. Refresh de `estoque_atual`

### 6.3. Fluxo: Importação de vendas do PDV

1. Gestor faz upload do CSV `pdv_analitico` no painel
2. Backend identifica encoding (UTF-8) e parser custom extrai linhas
3. Identifica loja a partir do nome `"Loja :"` no cabeçalho — match em `lojas.nome_pdv`
4. Para cada linha de venda/troca:
   - Tenta resolver código: `produtos.sku` → `produtos.ean` → `sku_aliases.codigo_alias`
   - Se resolveu: cria linha em `imports_vendas_linhas` com status `aplicado` e gera movimento
   - Se não resolveu: cria com status `orfao` (sem movimento ainda)
   - Se já existe (mesma loja + doc + código): status `duplicado_doc` (não aplica)
5. Ao final, `imports_vendas.status`:
   - `concluido` se 0 órfãos
   - `aguardando_resolucao` se há órfãos
6. Gestor é direcionado pra tela de resolução de órfãos (se houver)

### 6.4. Fluxo: Resolução de SKUs órfãos

1. Tela lista órfãos da importação (código do PDV + descrição que veio no CSV + qtd total)
2. Para cada órfão, sistema **sugere automaticamente** os 3 produtos mais similares (similaridade de nome via `pg_trgm`, threshold ≥ 0.4)
3. Gestor:
   - **Aceita sugestão** → cria `sku_alias`, todas as linhas órfãs com esse código viram `resolvido_manualmente` e geram movimento
   - **Busca outro produto** → autocomplete por nome/SKU → mesmo efeito
   - **Marca como ignorar** → cria alias apontando pra "produto fantasma" (brindes, embalagens, etc.) — não gera movimento mas evita reaparecer como órfão
4. Status da importação atualiza pra `concluido` quando todos resolvidos

### 6.5. Fluxo: Sessão de contagem (geral)

1. Gestor cria sessão em "Nova Contagem" → tipo `geral`, loja X
2. Status `aberta` → sistema gera `sessoes_snapshot` com estoque teórico atual de todos os SKUs
3. Status muda pra `em_contagem`
4. Contadores abrem app em tablet, fazem login, selecionam sessão
5. Cada bipagem cria linha em `contagens_item` (online OU offline)
   - Offline: salva em IndexedDB, marca `sincronizado_em = null`
   - Online: salva direto no Supabase
   - Reconexão: sync automático
6. Supervisor acompanha progresso ao vivo via Realtime (% de SKUs com contagem)
7. Ao finalizar contagem (botão "Encerrar"):
   - Sessão vira `em_revisao`
   - Sistema gera `divergencias` comparando `sessoes_snapshot.qtd_teorica` com `SUM(contagens_item.qtd_contada)`
   - Para SKUs no snapshot que não foram contados: divergência com `qtd_contada = 0`
8. Gestor revisa divergências:
   - **Aprova** → vai pra batch de aplicação
   - **Recontar** → tablet recebe lista, conta de novo, refaz divergência
   - **Rejeita** → registra motivo, não gera movimento (SKU permanece com estoque teórico)
9. Ao validar a sessão (botão "Finalizar"):
   - Para cada divergência aprovada, gera `movimentos_estoque` com tipo `contagem_validada` e qtd que ajusta `SUM(movimentos_anteriores) → qtd_contada`
   - Sessão vira `finalizada`
   - Refresh de `estoque_atual`

### 6.6. Fluxo: Sessão de contagem (amostragem)

Igual à geral, mas:
- Escopo definido na criação (categorias, SKUs específicos, ou random N SKUs)
- Snapshot inclui só os SKUs do escopo
- Divergências geradas só pros SKUs contados

---

## 7. Permissões (RLS)

| Role | Pode |
|---|---|
| `contador` | Bipar em sessões abertas das suas lojas; ver suas próprias contagens |
| `supervisor` | Tudo do contador + abrir/fechar sessões da sua loja, registrar perdas, ver dashboard da loja |
| `gestor` | Tudo do supervisor + aprovar/rejeitar divergências, importar vendas, resolver órfãos, ver tudo |
| `admin` | Tudo + gerenciar usuários, lojas, produtos |

RLS aplicada em todas as tabelas; `usuarios_lojas` define quais lojas cada não-admin enxerga.

---

## 8. Análises e relatórios que o sistema vai destravar

Esses são o **valor real** do projeto — coisas que o PDV atual não dá:

1. **Quebra por loja por período** — `SUM(movimentos.qtd)` onde `tipo='contagem_validada' AND qtd<0`
2. **Quebra por categoria/SKU** — quais produtos somem mais (priorizar segurança/treinamento)
3. **Perda registrada vs. quebra "fantasma"** — diferença entre `SUM(perdas)` e `SUM(ajustes_de_contagem)` no mesmo período = furto não detectado / erro operacional
4. **Acurácia de contagem ao longo do tempo** — % de SKUs sem divergência por sessão (curva de melhoria)
5. **Health score por loja** — combina acurácia + valor de quebra + frequência de divergências
6. **Ruptura por SKU/loja** — produtos com estoque zerado por > N dias que continuaram tendo demanda
7. **Giro por SKU** — vendas no período / estoque médio
8. **Top SKUs em divergência crônica** — produtos que sempre dão diferença em toda contagem

---

## 9. Roadmap em fases

### Fase 1 — MVP (≈ 4-6 semanas)

**Objetivo:** uma loja piloto operando o ciclo completo (recebimento → vendas importadas → contagem → divergências → ajuste).

- Schema completo no Supabase + RLS
- Painel web: cadastros (loja, produto, usuário), recebimento, perda, importação de vendas com parser do PDV analítico
- Tela de resolução de órfãos com sugestão automática (`pg_trgm`)
- App de contagem PWA: login, lista de sessões, bipagem online, fechar contagem
- Tela de divergências: revisão e aprovação
- Dashboard básico: estoque atual da loja, últimas movimentações

**Loja piloto sugerida:** Balneário (maior volume, mais dados pra teste).

### Fase 2 — Robustez (≈ 3-4 semanas)

- **Modo offline completo** no PWA (IndexedDB + sync resiliente)
- **Dashboard de divergências históricas** (top 10 quebras, por categoria, por loja)
- **Análises avançadas:** acurácia, health score, ruptura, giro
- Rollout pras outras 3 lojas
- Importação de cadastro Nuvemshop por upload (refresh de produtos)

### Fase 3 — Otimização (≈ 2-3 semanas)

- Alertas automáticos (loja sem contagem há > N dias, divergência > R$ X)
- Relatórios exportáveis (Excel, PDF)
- Eventual integração direta Nuvemshop API (se virar prioridade)
- App mobile nativo (se PWA mostrar limitações)

---

## 10. Decisões finais (todas fechadas)

### 10.1. Categorias de produto

`Relógio`, `Óculos de Sol`, `Óculos de Grau`, `Semijoias`, `Embalagem`.

Observações:
- "Embalagem" será **excluída por padrão** das análises de quebra/divergência valorizada (não importa se sumiu uma sacola; importa se sumiu um relógio)
- Subcategoria virá do campo `Sexo` da Nuvemshop: `masculino`, `feminino`, `unissex`
- Categorias adicionais podem ser criadas no futuro, mas começamos com essas 5

### 10.2. Códigos de loja

| Código | Nome | Nome no PDV (pra match) |
|---|---|---|
| `BAL` | Balneário Shopping | `QUIOSQUE BALNEARIO SHOPPING` |
| `MOO` | Mooca Plaza | `QUIOSQUE MOOCA  PLAZA` (atenção: 2 espaços entre MOOCA e PLAZA no CSV) |
| `GAR` | Garten Shopping | `QUIOSQUE GARTEN SHOPPING` |
| `NEU` | Neumarkt Shopping | `QUIOSQUE NEUMARKT SHOPPING` |

### 10.3. Custo inicial dos produtos

`produtos.custo` fica `null` no cadastro inicial e é populado conforme cada SKU passa por seu primeiro recebimento. Na trigger de recebimento, `produtos.custo` é atualizado pra refletir o **último custo conhecido**.

Implicação aceita: nas primeiras semanas de operação, o `valor_diferenca` em divergências fica `null` para SKUs que ainda não tiveram recebimento registrado. Os relatórios de "quebra valorizada" começam parciais e ganham cobertura com o tempo.

### 10.4. Estoque inicial

**Estoque zerado.** A primeira contagem geral em cada loja é tratada como "sessão zero": todas as quantidades contadas viram movimentos de `contagem_validada` que estabelecem o ponto de partida. Não há divergência a aprovar nessa primeira sessão (não há estoque teórico anterior).

**Recomendação operacional:** fazer a primeira contagem geral em cada loja **antes** da primeira importação de vendas, pra evitar que vendas tirem estoque que ainda nem foi contado.

### 10.5. Cadastro de usuários iniciais

**Admin inicial:**
- Email: `admin@saintgermainbrand.com.br`
- Senha: `123456` (⚠️ ambiente de teste apenas — trocar antes de uso produtivo)
- Role: `admin`
- Lojas: todas (admin não precisa de vínculo em `usuarios_lojas`)

**Demais usuários:** serão cadastrados pelo admin via painel após o sistema estar no ar. Cada usuário vai ter seu role (`contador`, `supervisor`, `gestor`) e suas lojas vinculadas.

⚠️ **Ação obrigatória antes de produção:** trocar a senha do admin para uma forte e reativar Leaked Password Protection no Supabase Auth.

### 10.6. Cadência de operação

| Operação | Frequência |
|---|---|
| Importação do PDV analítico | **Semanal** (toda segunda, importa a semana anterior) |
| Contagem por amostragem | **Semanal** (rotativa por categoria) |
| Inventário geral | **Trimestral ou semestral** (decidir conforme ritmo) |
| Recebimento de mercadoria | Conforme NF chega na loja |
| Registro de perda | Conforme acontece (idealmente no mesmo dia) |

---

## 11. Riscos identificados

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Códigos novos surgirem no PDV no futuro | Alta | Médio | Tela de órfãos vira ferramenta perene, não temporária |
| Wifi instável nas lojas durante contagem | Alta | Alto | PWA com IndexedDB e sync resiliente (Fase 2) |
| Contadores bipando o produto errado | Média | Médio | Tela mostra nome do produto após bipar; modo "verificação" pra recontagem |
| EAN duplicado entre produtos diferentes | Baixa | Alto | Constraint de unicidade + alerta na primeira bipagem ambígua |
| Mudanças no formato do relatório PDV | Baixa | Alto | Parser bem testado + alerta quando achados não-esperados |
| Volume de divergências assustar gestor | Média | Médio | Primeira contagem sempre tem muito ruído; comunicar isso de antemão |

---

## 12. Próximo passo

Todas as decisões de planejamento estão fechadas. A execução pode começar nesta ordem:

1. **Subir schema completo no Supabase** (DDL + triggers + RLS + função de validação de contagem + função de similaridade `pg_trgm`)
2. **Cadastrar as 4 lojas** com nome_pdv exato (atenção: `MOOCA  PLAZA` tem 2 espaços no CSV)
3. **Importar cadastro de produtos da Nuvemshop** (2.231 produtos do `Info_Cadastro.csv`)
   - Categoria precisa ser deduzida do nome ou cadastrada manualmente em batch
4. **Pré-popular `sku_aliases`** com os 86 órfãos `20xxx` já identificados (de-para via similaridade — eu posso te entregar essa planilha pra revisar antes)
5. **Criar usuário admin** e ajustar configurações de Auth no Supabase
6. **Construir parser do PDV analítico** (server-side, com testes nos 1.862 registros do CSV de abril)
7. **Painel web Fase 1**: cadastros + recebimento + perda + importação + resolução de órfãos + divergências
8. **App PWA de contagem Fase 1** (online apenas no MVP, offline na Fase 2)
9. **Loja piloto: Balneário** — primeira contagem geral, primeira importação, primeiro ciclo completo
10. **Avaliar** após 2-3 ciclos semanais antes de rolar pras outras 3 lojas
