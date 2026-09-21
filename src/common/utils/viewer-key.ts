import { createHash } from 'crypto';

export interface ViewerIdentity {
  userId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Quem está vendo, para contar uma vez por pessoa — visita de artigo do blog,
 * impressão e clique de anúncio.
 *
 * Logado, é a conta. Anônimo, é um resumo do IP com o navegador — **o IP não é
 * guardado**, só o resumo, e só enquanto dura a janela de contagem. Guardar o
 * IP cru de cada leitor para medir audiência seria dado pessoal sem
 * finalidade que o justifique (LGPD).
 *
 * Sem IP nenhum não há como distinguir uma visita de mil, e a visita não conta.
 */
export function viewerKey(identity: ViewerIdentity): string | null {
  if (identity.userId) {
    return `u:${identity.userId}`;
  }

  if (!identity.ipAddress) {
    return null;
  }

  const digest = createHash('sha256')
    .update(`${identity.ipAddress}|${identity.userAgent ?? ''}`)
    .digest('hex')
    .slice(0, 32);

  return `a:${digest}`;
}
