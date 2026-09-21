import { IMSLPScoreType } from '@prisma/client';

/**
 * Converte o tipo de partitura enviado pelo cliente no membro correspondente do
 * enum `IMSLPScoreType`.
 *
 * Antes o valor era convertido com `toUpperCase() as any`, o que deixava
 * qualquer string chegar até o Prisma e falhar só na escrita, com erro de banco
 * em vez de erro de validação. Aqui um valor desconhecido cai no padrão
 * `SCORES`, que é o comportamento que o legado já tinha na prática.
 */
export function parseScoreType(
  value: string | undefined | null,
): IMSLPScoreType {
  if (!value) {
    return IMSLPScoreType.SCORES;
  }

  const normalized = value.trim().toUpperCase();
  const known = Object.values(IMSLPScoreType) as string[];

  return known.includes(normalized)
    ? (normalized as IMSLPScoreType)
    : IMSLPScoreType.SCORES;
}
