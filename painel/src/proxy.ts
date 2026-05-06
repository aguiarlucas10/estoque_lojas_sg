import { NextRequest, NextResponse } from "next/server";

/**
 * Basic Auth para proteger o painel em producao. Solucao temporaria
 * ate Auth Supabase estar pronto. Configurar BASIC_AUTH_USER e
 * BASIC_AUTH_PASS nas env vars do Vercel.
 *
 * Em dev local (sem env vars setadas), nao bloqueia.
 *
 * Next 16: o arquivo deve se chamar `proxy.ts` e exportar `proxy`
 * (antes era `middleware.ts` exportando `middleware`).
 */
export function proxy(req: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;

  // Se nao configurado, libera (modo dev)
  if (!expectedUser || !expectedPass) {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      if (sep > 0) {
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        if (user === expectedUser && pass === expectedPass) {
          return NextResponse.next();
        }
      }
    } catch {
      // base64 invalido — cai no 401 abaixo
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
