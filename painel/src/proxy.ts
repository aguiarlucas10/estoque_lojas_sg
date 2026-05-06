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
