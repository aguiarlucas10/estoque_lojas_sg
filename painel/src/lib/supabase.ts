import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cache } from "react";

export const getSupabase = cache(() => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar em .env.local");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
});

// Supabase REST aplica teto default de 1000 linhas. fetchAll repete
// .range() em janelas de PAGE até a query devolver menos que PAGE.
// build deve retornar uma query SEM .range() — o helper aplica.
const PAGE = 1000;
export async function fetchAll<T>(
  build: (sb: ReturnType<typeof getSupabase>) => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
): Promise<T[]> {
  const sb = getSupabase();
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(sb).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
