import { PrismaService } from '../../prisma/prisma.service';
import { ReportDataService } from './report-data.service';

const start = new Date('2026-08-13T00:00:00Z');
const end = new Date('2026-09-12T00:00:00Z');
const WORK = '64b000000000000000000011';
const COMPOSER = '64b000000000000000000022';

/** `$runCommandRaw` devolve o cursor da agregação; aqui, por coleção. */
function aggregateBy(results: Record<string, unknown[]>) {
  return jest.fn(({ aggregate }: { aggregate: string }) =>
    Promise.resolve({ cursor: { firstBatch: results[aggregate] ?? [] } }),
  );
}

function prismaMock(aggregates: Record<string, unknown[]> = {}) {
  return {
    user: {
      count: jest.fn().mockResolvedValue(7),
      findMany: jest.fn().mockResolvedValue([]),
    },
    work: {
      count: jest.fn().mockResolvedValue(100),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    composer: {
      count: jest.fn().mockResolvedValue(20),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    workScore: { count: jest.fn().mockResolvedValue(30) },
    instrument: { count: jest.fn().mockResolvedValue(5) },
    userInstrument: { count: jest.fn().mockResolvedValue(9) },
    workAnnotation: {
      count: jest.fn().mockResolvedValue(4),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    epoch: { findMany: jest.fn().mockResolvedValue([]) },
    $runCommandRaw: aggregateBy(aggregates),
  };
}

const section = (data: { sections: Array<{ title: string }> }, title: string) =>
  data.sections.find((s) => s.title.startsWith(title)) as {
    title: string;
    rows: unknown[][];
  };

describe('ReportDataService', () => {
  describe('usuários', () => {
    it('perfis com nome legível, e perfil ausente como "Não informado"', async () => {
      const prisma = prismaMock({
        User: [
          { _id: 'TEACHER', count: 3 },
          { _id: null, count: 2 },
          { _id: 'LEGADO', count: 1 },
        ],
      });
      prisma.user.findMany
        .mockResolvedValueOnce([
          {
            firstName: 'Ana',
            lastName: null,
            createdAt: end,
            userType: null,
            experienceLevel: 'BEGINNER',
          },
        ])
        .mockResolvedValueOnce([
          { firstName: null, lastName: null, totalUploads: 4, uploadScore: 40 },
        ]);

      const data = await new ReportDataService(
        prisma as unknown as PrismaService,
      ).build('users-overview', start, end);

      expect(section(data, 'Usuários por perfil').rows).toEqual([
        ['Professor', 3],
        ['Não informado', 2],
        ['LEGADO', 1],
      ]);
      expect(section(data, 'Novos usuários').rows).toEqual([
        ['Ana', end.toISOString(), 'Ouvinte', 'BEGINNER'],
      ]);
      expect(section(data, 'Principais contribuidores').rows).toEqual([
        ['Usuário', 4, 40],
      ]);
      // "Ativo" é o último acesso, não a última escrita no cadastro.
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { lastSeen: { gte: start, lte: end } },
      });
    });

    it('lista cortada diz quantos havia', async () => {
      const prisma = prismaMock();
      prisma.user.count.mockResolvedValue(900);
      prisma.user.findMany.mockResolvedValueOnce(
        Array.from({ length: 2 }, () => ({
          firstName: 'X',
          lastName: 'Y',
          createdAt: end,
          userType: 'TEACHER',
          experienceLevel: 'ADVANCED',
        })),
      );

      const data = await new ReportDataService(
        prisma as unknown as PrismaService,
      ).build('users-overview', start, end);

      expect(section(data, 'Novos usuários').title).toBe(
        'Novos usuários (os 2 mais recentes de 900)',
      );
    });
  });

  it('conteúdo: populares por favorito, agrupados no banco', async () => {
    const prisma = prismaMock({
      FavoriteWork: [
        { _id: { $oid: WORK }, count: 12 },
        { _id: { $oid: '64b000000000000000000099' }, count: 3 },
        { _id: 42, count: 1 },
      ],
      FavoriteComposer: [{ _id: { $oid: COMPOSER }, count: 8 }],
    });
    prisma.work.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.id
          ? [{ id: WORK, title: 'Noturno', composer: { name: 'Chopin' } }]
          : [{ title: 'Nova', createdAt: end, composer: null }],
      ),
    );
    prisma.composer.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where?.id
          ? [{ id: COMPOSER, name: 'Chopin', epoch: { name: 'Romântico' } }]
          : [{ name: 'Novo', createdAt: end }],
      ),
    );
    prisma.workAnnotation.groupBy.mockResolvedValue([
      { workId: WORK, _count: { _all: 2 } },
    ]);
    prisma.work.groupBy.mockImplementation(({ by }) =>
      Promise.resolve(
        by[0] === 'composerId'
          ? [{ composerId: COMPOSER, _count: { _all: 50 } }]
          : [{ epochId: 'e1', _count: { _all: 70 } }],
      ),
    );
    prisma.composer.groupBy.mockResolvedValue([
      { epochId: 'e1', _count: { _all: 6 } },
    ]);
    prisma.epoch.findMany.mockResolvedValue([
      { id: 'e2', name: 'Barroco' },
      { id: 'e1', name: 'Romântico' },
    ]);

    const data = await new ReportDataService(
      prisma as unknown as PrismaService,
    ).build('content-analysis', start, end);

    // A obra favoritada que não existe mais some da lista.
    expect(section(data, 'Obras mais favoritadas').rows).toEqual([
      ['Noturno', 'Chopin', 12, 2],
    ]);
    expect(section(data, 'Compositores mais favoritados').rows).toEqual([
      ['Chopin', 'Romântico', 50, 8],
    ]);
    expect(section(data, 'Épocas').rows).toEqual([
      ['Romântico', 6, 70],
      ['Barroco', 0, 0],
    ]);
    expect(section(data, 'Obras novas').rows).toEqual([
      ['Nova', null, end.toISOString()],
    ]);
    expect(data.summary).toContainEqual(['Partituras ativas', 30]);
  });

  it('engajamento: anotações por categoria, com nome legível', async () => {
    const prisma = prismaMock({
      work_annotations: [
        { _id: 'TECHNIQUE', count: 5 },
        { _id: null, count: 1 },
      ],
    });

    const data = await new ReportDataService(
      prisma as unknown as PrismaService,
    ).build('engagement-metrics', start, end);

    expect(section(data, 'Anotações por categoria').rows).toEqual([
      ['Técnica', 5],
      ['Sem categoria', 1],
    ]);
    expect(data.summary).toEqual([
      ['Anotações públicas no período', 4],
      ['Usuários ativos no período', 7],
    ]);
  });
});
