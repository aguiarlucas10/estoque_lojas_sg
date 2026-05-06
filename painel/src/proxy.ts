import { NextRequest, NextResponse } from "next/server";

/**
 * Basic Auth multi-usuario com escopo por loja. Configurar via env var:
 *
 *   BASIC_AUTH_USERS = bal:senhaBAL:BAL,moo:senhaMOO:MOO,gar:senhaGAR:GAR,neu:senhaNEU:NEU,admin:senhaAdmin:*
 *
 * Formato: `user:senha:loja_codigo` separados por virgula.
 * Loja `*` = admin (acesso a todas as lojas).
 *
 * Compat: se BASIC_AUTH_USERS nao estiver setado mas BASIC_AUTH_USER e
 * BASIC_AUTH_PASS estiverem, esse usuario eh tratado como admin.
 *
 * Em dev local sem nenhuma das envs, libera tudo (admin).
 *
 * Apos validacao, injeta header `x-user-loja` (codigo ou `*`) no request.
 *
 * Next 16: arquivo eh `proxy.ts` exportando `proxy` (antes `middleware`).
 */
type Account = { user: string; pass: string; loja: string };

function parseAccounts(): Account[] {
  const multi = process.env.BASIC_AUTH_USERS;
  if (multi) {
    return multi
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(":");
        if (parts.length < 3) return null;
        const [user, pass, loja] = [parts[0], parts[1], parts.slice(2).join(":")];
        return { user, pass, loja };
      })
      .filter((x): x is Account => x !== null && !!x.user && !!x.pass && !!x.loja);
  }
  const u = process.env.BASIC_AUTH_USER;
  const p = process.env.BASIC_AUTH_PASS;
  if (u && p) return [{ user: u, pass: p, loja: "*" }];
  return [];
}

export function proxy(req: NextRequest) {
  const accounts = parseAccounts();

  // Rota especial /logout: força 401 com realm novo para invalidar
  // credentials cacheadas pelo browser. O body explica os proximos passos.
  if (req.nextUrl.pathname === "/logout") {
    return new NextResponse(LOGOUT_HTML, {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Realm dinamico evita cache de credentials no browser
        "WWW-Authenticate": `Basic realm="logout-${Date.now()}", charset="UTF-8"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Sem nenhuma config -> dev mode, libera como admin
  if (accounts.length === 0) {
    const headers = new Headers(req.headers);
    headers.set("x-user-loja", "*");
    return NextResponse.next({ request: { headers } });
  }

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      if (sep > 0) {
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        const match = accounts.find((a) => a.user === user && a.pass === pass);
        if (match) {
          const headers = new Headers(req.headers);
          headers.set("x-user-loja", match.loja);
          headers.set("x-user-name", match.user);
          return NextResponse.next({ request: { headers } });
        }
      }
    } catch {
      // base64 invalido -> 401 abaixo
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Estoque Saint Germain", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: [
    // Aplica em todas as rotas exceto assets do Next e favicon.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

const LOGOUT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sessão encerrada — Saint Germain Estoque</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f5;color:#0c0a09;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:40px}
    h1{font-family:Georgia,"Times New Roman",serif;font-weight:300;font-size:32px;line-height:1.13;letter-spacing:-0.32px;margin-bottom:16px}
    p{font-size:15px;line-height:1.5;color:#4e4e4e;margin-bottom:12px}
    ol{margin:16px 0 24px 22px}
    li{font-size:14px;line-height:1.6;color:#4e4e4e;margin-bottom:6px}
    .btn{display:inline-block;background:#292524;color:#fff;border-radius:9999px;padding:10px 20px;text-decoration:none;font-size:15px;font-weight:500;transition:background .15s}
    .btn:hover{background:#0c0a09}
    .label{font-size:12px;font-weight:600;letter-spacing:0.96px;text-transform:uppercase;color:#777169;margin-bottom:12px}
  </style>
</head>
<body>
  <div class="card">
    <p class="label">Saint Germain · Estoque</p>
    <h1>Sessão encerrada</h1>
    <p>Para entrar com outra conta no mesmo computador:</p>
    <ol>
      <li>Feche todas as abas deste site (ou o navegador inteiro)</li>
      <li>Abra a URL novamente — o login vai aparecer</li>
    </ol>
    <p style="margin-bottom:24px;font-size:13px;color:#777169">Em PC compartilhado, prefira modo anônimo.</p>
    <a class="btn" href="/">Entrar de novo</a>
  </div>
</body>
</html>`;
