/**
 * Percentual com uma casa decimal.
 *
 * `null` quando não há base para dividir — a mesma resposta que o resto da
 * plataforma dá a métrica sem denominador.
 */
export function rate(part: number, total: number): number | null {
  if (total === 0) {
    return null;
  }

  return Math.round((part / total) * 1000) / 10;
}

/**
 * Taxa de entrega da newsletter.
 *
 * **`emailsDelivered` passou a ter quem escreva**: o webhook do provedor
 * (`POST /webhook/email`). Antes dele o disparo contava só `emailsSent` — o
 * que o servidor de saída aceitou —, e dividir um pelo outro daria **0% de
 * entrega em toda campanha**, que se lê como "nada chegou". Não era o que
 * acontecia: é que ninguém media.
 *
 * O legado resolvia copiando `emailsSent` para `emailsDelivered` no fim do
 * envio, com o comentário "assumindo entrega imediata" — o que produzia **100%
 * de entrega em toda campanha**, inclusive nas que caíram inteiras no spam.
 *
 * **Com o canal aberto, "zero entregue" ficou ambíguo**, e é por isso que os
 * retornos entram na conta: uma campanha em que o provedor não reportou nada —
 * nem entrega, nem retorno — é uma campanha **não medida**, e a resposta
 * continua sendo `null`. Uma campanha em que só chegaram retornos foi medida,
 * e `0%` ali é um fato: tudo voltou. É a diferença entre "não sei" e "deu
 * errado", e ela não pode aparecer igual no painel.
 */
export function deliveryRate(
  delivered: number,
  sent: number,
  bounced = 0,
): number | null {
  if (sent === 0) {
    return null;
  }

  // Nenhum evento do provedor chegou para esta campanha.
  if (delivered === 0 && bounced === 0) {
    return null;
  }

  return rate(delivered, sent);
}
