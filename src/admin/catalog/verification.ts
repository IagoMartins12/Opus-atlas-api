/**
 * Rótulos aceitos em `verificationStatus`.
 *
 * O campo é `String?` no schema, sem enum. `"disputed"` existe no comentário do
 * schema e é escrito por quem abre uma contestação, não por esta transição.
 */
export const VERIFICATION_STATUS = {
  verified: 'verified',
  pending: 'pending',
} as const;

/**
 * Campos de verificação comuns a compositor e obra.
 *
 * `verificationStatus` entra junto com `isVerified` de propósito: são dois
 * campos dizendo a mesma coisa, e manter só um é como eles passam a discordar.
 */
export interface VerificationCore {
  isVerified: boolean;
  verificationStatus: string;
  verifiedBy: string | null;
  verifiedAt: Date | null;
}

/** Compositor tem, além do núcleo, uma nota de verificação. Obra não tem. */
export interface VerificationState extends VerificationCore {
  verificationNotes: string | null;
}

/**
 * O núcleo da transição, sem a nota.
 *
 * **`verificationStatus` estava ficando para trás.** Ele existe em `Composer` e
 * em `Work`, é **lido** pela rota pública de detalhe do compositor, e o caminho
 * administrativo só escrevia `isVerified`. Um compositor desverificado pelo
 * painel continuava aparecendo como `verificationStatus: "verified"` para quem
 * consultasse o catálogo — dois campos sobre o mesmo fato, um atualizado e o
 * outro não. Agora a transição escreve os dois, e eles não têm como divergir.
 */
export function verificationCore(
  isVerified: boolean,
  adminUserId: string,
): VerificationCore {
  if (isVerified) {
    return {
      isVerified: true,
      verificationStatus: VERIFICATION_STATUS.verified,
      verifiedBy: adminUserId,
      verifiedAt: new Date(),
    };
  }

  return {
    isVerified: false,
    verificationStatus: VERIFICATION_STATUS.pending,
    verifiedBy: null,
    verifiedAt: null,
  };
}

/**
 * Monta a transição de verificação.
 *
 * Duas correções sobre o legado:
 *
 * 1. **Desverificar limpa a atribuição.** Antes, `verifiedBy`, `verifiedAt` e
 *    `verificationNotes` só eram escritos no ramo `if (isVerified)`. Ao
 *    desmarcar, os três campos ficavam com o valor antigo — o registro
 *    aparecia como não verificado e, ao mesmo tempo, "verificado por Fulano em
 *    tal data". Uma trilha de verificação que mente é pior que nenhuma.
 * 2. **A nota é gravada nos dois sentidos.** No legado, a justificativa escrita
 *    ao *retirar* a verificação era descartada em silêncio — exatamente a nota
 *    que mais importa registrar.
 */
export function verificationChange(
  isVerified: boolean,
  adminUserId: string,
  notes?: string,
): VerificationState {
  return {
    ...verificationCore(isVerified, adminUserId),
    verificationNotes: notes ?? null,
  };
}
