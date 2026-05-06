import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

export type ItemPDF = {
  /** SKU como veio no PDF (pode estar truncado pelo layout do Bling). */
  sku_pdv: string;
  descricao: string;
  qtd: number;
};

export type ParsedRecebimentoPDF = {
  numero_pedido: string | null;
  cliente: string | null;
  itens: ItemPDF[];
  total_itens: number;
  total_unidades: number;
  texto_bruto: string;
};

/**
 * Faz parse do texto bruto do PDF do Bling em itens de recebimento.
 * Cada linha de item tem o padrão `<descrição> <SKU> UN <qtd> <preço>`.
 * O preço é ignorado a pedido (PDF de reposição não traz custo real).
 */
function extrairItensDoTexto(texto: string): ItemPDF[] {
  const linhas = texto.split(/\r?\n/);
  // Padrão: termina com UN <qtd em BR> <preço em BR>
  // Grupos: 1=desc, 2=sku, 3=qtd, 4=preço (preço ignorado a pedido).
  const itemRe =
    /^(.+?)\s+([A-Z0-9][A-Z0-9_\-]+)\s+UN\s+(\d+(?:,\d+)?)\s+(\d+(?:\.\d{3})*(?:,\d+)?)\s*$/;
  const out: ItemPDF[] = [];
  for (const raw of linhas) {
    const linha = raw.trim();
    if (!linha) continue;
    const m = itemRe.exec(linha);
    if (!m) continue;
    const qtd = parseFloat(m[3].replace(",", "."));
    if (!Number.isFinite(qtd) || qtd <= 0) continue;
    out.push({
      sku_pdv: m[2].trim(),
      descricao: m[1].trim(),
      qtd,
    });
  }
  return out;
}

function extrairCabecalho(texto: string): {
  numero_pedido: string | null;
  cliente: string | null;
} {
  // Número do pedido: "Número do pedido\n905163" ou similar
  const pedidoMatch =
    /N[úu]mero do pedido[\s\S]{0,80}?(\d{5,})/.exec(texto) ??
    /Pedido\s*[\s:]*(\d{5,})/.exec(texto);
  const numero_pedido = pedidoMatch ? pedidoMatch[1] : null;

  // Cliente: aparece como "Cliente *" depois o nome
  const clienteMatch =
    /Cliente\s*\*?\s*\n?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ \-_]+?)\s*\n/.exec(texto);
  const cliente = clienteMatch ? clienteMatch[1].trim() : null;

  return { numero_pedido, cliente };
}

export async function parseRecebimentoPDF(
  buffer: Buffer | Uint8Array,
): Promise<ParsedRecebimentoPDF> {
  // unpdf exige Uint8Array "puro" — Buffer (ainda que seja subclasse) é
  // rejeitado. Cria uma cópia em Uint8Array nativo.
  const data = Uint8Array.from(buffer);
  // unpdf é projetado pra serverless/edge — não depende de Web Workers
  // nem de APIs de browser indisponíveis em runtime Node serverless.
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  const texto_bruto = Array.isArray(text) ? text.join("\n") : text;
  const itens = extrairItensDoTexto(texto_bruto);
  const cab = extrairCabecalho(texto_bruto);
  return {
    numero_pedido: cab.numero_pedido,
    cliente: cab.cliente,
    itens,
    total_itens: itens.length,
    total_unidades: itens.reduce((acc, i) => acc + i.qtd, 0),
    texto_bruto,
  };
}
