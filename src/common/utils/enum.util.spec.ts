import { IMSLPScoreType } from '@prisma/client';
import { parseScoreType } from './enum.util';

describe('parseScoreType', () => {
  it('aceita o valor exato do enum', () => {
    expect(parseScoreType('PARTS')).toBe(IMSLPScoreType.PARTS);
  });

  it('normaliza caixa e espaços', () => {
    expect(parseScoreType('  arrangements ')).toBe(IMSLPScoreType.ARRANGEMENTS);
  });

  // Antes o valor ia para o Prisma com `as any`: qualquer string passava e o
  // erro só aparecia na escrita, como falha de banco.
  it('cai no padrão SCORES quando o valor é desconhecido', () => {
    expect(parseScoreType('INVENTADO')).toBe(IMSLPScoreType.SCORES);
  });

  it('cai no padrão SCORES para vazio, null e undefined', () => {
    expect(parseScoreType('')).toBe(IMSLPScoreType.SCORES);
    expect(parseScoreType(null)).toBe(IMSLPScoreType.SCORES);
    expect(parseScoreType(undefined)).toBe(IMSLPScoreType.SCORES);
  });
});
