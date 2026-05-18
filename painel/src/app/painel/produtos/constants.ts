export const CATEGORIAS_VALIDAS = [
  "Relógio",
  "Óculos de Sol",
  "Óculos de Grau",
  "Semijoias",
  "Embalagem",
] as const;

export type CategoriaProduto = (typeof CATEGORIAS_VALIDAS)[number];

export type ProdutoInput = {
  sku: string;
  ean: string | null;
  nome: string;
  categoria: string | null;
  subcategoria: string | null;
  custo: number | null;
  preco_venda: number | null;
  ativo: boolean;
};

export type ProdutoActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
