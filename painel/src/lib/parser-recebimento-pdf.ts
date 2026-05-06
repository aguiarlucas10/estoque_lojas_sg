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
  // Procura padrão `<SKU> UN <qtd em BR> <preço em BR>` em qualquer lugar do
  // texto (unpdf pode retornar tudo numa string contínua, sem newlines).
  // Grupos: 1=sku, 2=qtd, 3=preço (preço ignorado a pedido).
  const itemRe =
    /([A-Z0-9][A-Z0-9_\-]+)\s+UN\s+(\d+(?:,\d+)?)\s+(\d+(?:\.\d{3})*(?:,\d+)?)/g;
  const out: ItemPDF[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(texto)) !== null) {
    const sku = m[1].trim();
    // Filtra falsos positivos do cabeçalho da tabela ("Código UN Quantidade Preço")
    if (sku === "UN" || sku === "Código" || sku === "CODIGO") continue;
    const qtd = parseFloat(m[2].replace(",", "."));
    if (!Number.isFinite(qtd) || qtd <= 0) continue;
    // Descrição: pega o trecho antes do SKU (limitado a 200 chars)
    const inicioSku = m.index;
    const descBruta = texto.slice(lastEnd, inicioSku).trim();
    const desc = descBruta.length > 200 ? descBruta.slice(-200).trim() : descBruta;
    out.push({
      sku_pdv: sku,
      descricao: desc,
      qtd,
    });
    lastEnd = itemRe.lastIndex;
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
