"use server";

import { revalidatePath } from "next/cache";
import { importCSVCompleto, type ImportCSVResult } from "@/lib/import-vendas";

export type NovoImportState = ImportCSVResult | null;

export async function criarImport(_prev: NovoImportState, formData: FormData): Promise<NovoImportState> {
  const file = formData.get("arquivo") as File | null;

  if (!file || file.size === 0) {
    return { ok: false, error: "Selecione o arquivo CSV." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importCSVCompleto({
    arquivo_nome: file.name,
    content: buffer,
  });

  if (result.ok) {
    revalidatePath("/painel/imports");
  }
  return result;
}
