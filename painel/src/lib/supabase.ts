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
