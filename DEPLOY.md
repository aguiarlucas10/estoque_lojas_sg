# Deploy do painel na Vercel

Repositório: https://github.com/aguiarlucas10/estoque_lojas_sg

## Primeira vez

### 1. Importar o projeto na Vercel

1. Em [vercel.com](https://vercel.com) → **Add New… → Project**
2. **Import** o repositório `aguiarlucas10/estoque_lojas_sg` (autorize a GitHub App se for a primeira vez)
3. Na tela de configuração:
   - **Framework Preset:** Next.js (autodetect)
   - **Root Directory:** clique em `Edit` e selecione **`painel`** ⚠️ Importante: o app vive em `painel/`, não na raiz do repo.
   - **Build Command / Install Command / Output Directory:** mantenha os defaults (`next build`, `npm install`, `.next`)
   - **Node.js Version:** 20.x ou superior

### 2. Configurar variáveis de ambiente

Adicione as 4 variáveis abaixo em **Environment Variables** antes de clicar em **Deploy**:

| Nome | Valor | Notas |
|---|---|---|
| `SUPABASE_URL` | `https://fsfqnshkfwnfeswwdmxg.supabase.co` | Mesmo do `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | Secret key do Supabase. **Não vaza no client** — usado só nos Server Components/Actions. |
| `BASIC_AUTH_USER` | `estoque` (ou outro de sua escolha) | Login HTTP Basic |
| `BASIC_AUTH_PASS` | `<senha forte>` | Mín. 16 caracteres, mistura. Salve num gerenciador. |

> Em todas, deixe os 3 ambientes marcados (Production, Preview, Development).

### 3. Deploy

Clica em **Deploy**. Build leva ~2-3 min. Quando concluir:
- URL provisória: `estoque-lojas-sg-XXXX.vercel.app`
- Browser vai pedir usuário/senha (HTTP Basic) na primeira request

## Atualizações futuras

Push para `main` → deploy automático. Para testar antes:
```bash
git checkout -b feature/algo
# … mudanças …
git push origin feature/algo
```
A Vercel cria preview URL para cada branch/PR.

## Segurança

⚠️ **A proteção atual é Basic Auth** — solução temporária para o piloto. Limitações:
- Quem tiver usuário+senha tem **acesso total** (sem roles).
- Se a senha vazar, qualquer um manipula o banco.
- Não há log de quem fez o quê.

Próximo passo (Fase 1 oficial do plano): migrar para Auth Supabase com RLS por role (contador / supervisor / gestor / admin).

## Domínio próprio (opcional)

Quando tiver um domínio (ex: `estoque.saintgermainbrand.com.br`):
1. Vercel → Project → **Domains** → adicionar
2. Configurar CNAME no DNS apontando para `cname.vercel-dns.com`
3. HTTPS automático

## Troubleshooting

**Build falha com "Body exceeded 1MB":** já tratado em `painel/next.config.ts` com `bodySizeLimit: "10mb"`. Se precisar mais, aumentar lá.

**Páginas dão 401 sem perguntar senha:** confira que as 4 env vars estão setadas. Se `BASIC_AUTH_USER` ou `BASIC_AUTH_PASS` estiver vazio, o middleware libera (modo dev).

**Erro de conexão com Supabase:** verifique `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` na Vercel; o secret key deve começar com `sb_secret_`.
