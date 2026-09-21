import { DifficultyLevel } from '@prisma/client';
import { audienceWhere, readSegments } from './newsletter-audience';

describe('público da campanha', () => {
  const base = {
    targetAll: false,
    targetSubscriberIds: [],
    targetSegments: null as unknown,
  };

  // A condição não vem da segmentação e não pode ser sobrescrita por ela:
  // quem cancelou, sofreu bounce ou está bloqueado nunca recebe.
  it('só assinante ativo entra, em qualquer cenário', () => {
    expect(audienceWhere(base).status).toBe('ACTIVE');
    expect(audienceWhere({ ...base, targetAll: true }).status).toBe('ACTIVE');
    expect(audienceWhere({ ...base, targetSubscriberIds: ['a'] }).status).toBe(
      'ACTIVE',
    );
  });

  // O legado fazia `...JSON.parse(campaign.targetSegments)` dentro do `where`:
  // qualquer JSON salvo virava filtro cru do Prisma.
  it('segmentação desconhecida é descartada, não vira filtro', () => {
    const where = audienceWhere({
      ...base,
      targetSegments: { status: 'UNSUBSCRIBED', email: { contains: '@' } },
    });

    expect(where.status).toBe('ACTIVE');
    expect(where).not.toHaveProperty('email');
  });

  it('destinatários exatos têm precedência', () => {
    const where = audienceWhere({
      ...base,
      targetAll: true,
      targetSubscriberIds: ['s1', 's2'],
    });

    expect(where.id).toEqual({ in: ['s1', 's2'] });
  });

  it('`targetAll` ignora os critérios', () => {
    const where = audienceWhere({
      ...base,
      targetAll: true,
      targetSegments: { interests: ['piano'] },
    });

    expect(where).not.toHaveProperty('interests');
  });

  it('traduz interesses para `hasSome`', () => {
    const where = audienceWhere({
      ...base,
      targetSegments: { interests: ['piano', 'violino'] },
    });

    expect(where.interests).toEqual({ hasSome: ['piano', 'violino'] });
  });

  it('traduz engajamento para data', () => {
    const where = audienceWhere({
      ...base,
      targetSegments: { engagedSince: '2026-01-01T00:00:00.000Z' },
    });

    expect(where.lastEmailOpenedAt).toEqual({
      gte: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  // Uma campanha com segmentação estranha precisa poder ser aberta e
  // corrigida, não derrubar a listagem.
  it('leitura nunca lança com valor inesperado', () => {
    expect(readSegments('texto solto')).toEqual({});
    expect(readSegments(null)).toEqual({});
    expect(readSegments([1, 2])).toEqual({});
    expect(readSegments({ interests: 'piano' }).interests).toBeUndefined();
  });

  it('nível fora do enum é descartado', () => {
    expect(
      readSegments({ experienceLevel: 'MESTRE' }).experienceLevel,
    ).toBeUndefined();
    expect(readSegments({ experienceLevel: 'ADVANCED' }).experienceLevel).toBe(
      DifficultyLevel.ADVANCED,
    );
  });
});
