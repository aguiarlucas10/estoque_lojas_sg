// Formatadores de data/hora fixados em America/Sao_Paulo (GMT-3 sem DST).
// Sem timeZone explicito, Intl.DateTimeFormat usa o TZ do ambiente de execucao
// — em Server Components rodando na Vercel isso eh UTC, exibindo 3h adiantado.
// Centralizado aqui pra evitar drift quando alguem adicionar mais uma tela.

const TZ = "America/Sao_Paulo";

export const dataBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TZ,
});

export const dataHoraBR = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
