import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUploadsService } from './admin-uploads.service';

const at = (iso: string) => new Date(iso);

describe('AdminUploadsService', () => {
  let service: AdminUploadsService;
  let prisma: {
    uploadHistory: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    composer: { findMany: jest.Mock };
    work: { findMany: jest.Mock };
    workScore: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };

  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'h1',
    entityType: 'composer',
    entityId: 'composer-1',
    action: 'update',
    reason: 'Admin verification',
    changes: null,
    createdAt: at('2026-03-10T12:00:00.000Z'),
    user: { id: 'u1', firstName: 'Ana', lastName: 'Costa', image: null },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      uploadHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      composer: { findMany: jest.fn().mockResolvedValue([]) },
      work: { findMany: jest.fn().mockResolvedValue([]) },
      workScore: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUploadsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminUploadsService);
  });

  // -----------------------------------------------------------------
  describe('listagem', () => {
    // O legado resolvia a entidade dentro de um `map`: 50 linhas, 50 consultas.
    it('resolve as entidades em lote, uma consulta por tipo', async () => {
      prisma.uploadHistory.findMany.mockResolvedValue([
        entry({ id: 'h1', entityId: 'composer-1' }),
        entry({ id: 'h2', entityId: 'composer-2' }),
        entry({ id: 'h3', entityType: 'work', entityId: 'work-1' }),
      ]);
      prisma.composer.findMany.mockResolvedValue([
        { id: 'composer-1', name: 'Bach', isVerified: true },
      ]);

      const result = await service.list({});

      expect(prisma.composer.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.composer.findMany.mock.calls[0][0].where.id.in).toEqual([
        'composer-1',
        'composer-2',
      ]);
      expect(prisma.work.findMany).toHaveBeenCalledTimes(1);
      expect(result.entries[0].entity).toMatchObject({ name: 'Bach' });
    });

    // A contribuição sobre algo removido é a prova de que a remoção aconteceu.
    it('entidade removida vem nula e sinalizada', async () => {
      prisma.uploadHistory.findMany.mockResolvedValue([entry()]);

      const result = await service.list({});

      expect(result.entries[0].entity).toBeNull();
      expect(result.entries[0].entityExists).toBe(false);
    });

    it('não consulta tipo que não aparece na página', async () => {
      prisma.uploadHistory.findMany.mockResolvedValue([entry()]);

      await service.list({});

      expect(prisma.work.findMany).not.toHaveBeenCalled();
      expect(prisma.workScore.findMany).not.toHaveBeenCalled();
    });

    it('aplica os filtros pedidos', async () => {
      await service.list({
        entityType: 'work',
        action: 'delete',
        userId: '685d591c1e3db0c5aaa893e4',
      });

      const { where } = prisma.uploadHistory.findMany.mock.calls[0][0];

      expect(where.entityType).toBe('work');
      expect(where.action).toBe('delete');
      expect(where.userId).toBe('685d591c1e3db0c5aaa893e4');
    });

    describe('rolagem por cursor', () => {
      it('continua do cursor e não conta a base de novo', async () => {
        const result = await service.list({
          cursor: '685d591c1e3db0c5aaa893e4',
        });

        const args = prisma.uploadHistory.findMany.mock.calls[0][0];

        expect(args.cursor).toEqual({ id: '685d591c1e3db0c5aaa893e4' });
        expect(args.skip).toBe(1);
        expect(prisma.uploadHistory.count).not.toHaveBeenCalled();
        expect(result.pagination.total).toBeNull();
      });

      // Sem o id no desempate, dois registros do mesmo instante trocam de
      // lugar entre uma busca e outra e a rolagem pula ou repete linhas.
      it('ordena com o id como desempate', async () => {
        await service.list({});

        const { orderBy } = prisma.uploadHistory.findMany.mock.calls[0][0];

        expect(Array.isArray(orderBy)).toBe(true);
        expect(orderBy[orderBy.length - 1]).toHaveProperty('id');
      });

      it('página cheia devolve o cursor seguinte; incompleta, nulo', async () => {
        prisma.uploadHistory.findMany.mockResolvedValue([
          entry({ id: 'a' }),
          entry({ id: 'b' }),
        ]);

        const cheia = await service.list({ limit: 2 });

        expect(cheia.pagination.nextCursor).toBe('b');

        prisma.uploadHistory.findMany.mockResolvedValue([entry({ id: 'a' })]);

        const fim = await service.list({ limit: 2 });

        expect(fim.pagination.nextCursor).toBeNull();
      });

      it('sem cursor, mantém page/total como antes', async () => {
        prisma.uploadHistory.count.mockResolvedValue(120);

        const result = await service.list({ page: 3, limit: 10 });

        expect(prisma.uploadHistory.findMany.mock.calls[0][0].skip).toBe(20);
        expect(result.pagination).toMatchObject({
          page: 3,
          total: 120,
          totalPages: 12,
        });
      });
    });
  });

  // -----------------------------------------------------------------
  describe('linha do tempo', () => {
    // O legado disparava três contagens por dia: 42 consultas para 14 dias.
    it('usa uma consulta só para a janela inteira', async () => {
      await service.stats({});

      expect(prisma.uploadHistory.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.uploadHistory.count).toHaveBeenCalledTimes(1);
    });

    it('devolve um balde por dia pedido', async () => {
      const result = await service.stats({ days: 7 });

      expect(result.timeline).toHaveLength(7);
    });

    // Os limites do legado usavam a hora corrente: o balde de hoje cobria
    // `[agora, agora + 24h)` e dava zero sempre.
    it('o último balde é hoje e recebe o que aconteceu hoje', async () => {
      const agora = new Date();

      prisma.uploadHistory.findMany.mockResolvedValue([
        { createdAt: agora, action: 'create' },
      ]);

      const result = await service.stats({ days: 14 });
      const hoje = result.timeline[result.timeline.length - 1];

      expect(hoje.total).toBe(1);
      expect(hoje.creates).toBe(1);
      expect(hoje.date.getHours()).toBe(0);
    });

    it('a janela começa à meia-noite', async () => {
      await service.stats({ days: 3 });

      const inicio = prisma.uploadHistory.findMany.mock.calls[0][0].where
        .createdAt.gte as Date;

      expect(inicio.getHours()).toBe(0);
      expect(inicio.getMinutes()).toBe(0);
    });

    it('separa criação, edição e remoção', async () => {
      const agora = new Date();

      prisma.uploadHistory.findMany.mockResolvedValue([
        { createdAt: agora, action: 'create' },
        { createdAt: agora, action: 'update' },
        { createdAt: agora, action: 'delete' },
        { createdAt: agora, action: 'update' },
      ]);

      const result = await service.stats({ days: 1 });

      expect(result.timeline[0]).toMatchObject({
        total: 4,
        creates: 1,
        updates: 2,
        deletes: 1,
      });
    });

    it('ignora registro fora da janela', async () => {
      prisma.uploadHistory.findMany.mockResolvedValue([
        { createdAt: at('2020-01-01T00:00:00.000Z'), action: 'create' },
      ]);

      const result = await service.stats({ days: 3 });

      expect(result.timeline.every((dia) => dia.total === 0)).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  describe('contribuidores', () => {
    it('junta contagem e usuário em duas consultas', async () => {
      prisma.uploadHistory.groupBy.mockResolvedValue([
        { userId: 'u1', _count: { _all: 12 } },
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', firstName: 'Ana', lastName: 'Costa', image: null },
      ]);

      const result = await service.topContributors();

      expect(result[0]).toEqual({
        userId: 'u1',
        name: 'Ana Costa',
        image: null,
        contributions: 12,
      });
    });

    it('sem contribuição, não consulta usuários', async () => {
      const result = await service.topContributors();

      expect(result).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('usuário removido não quebra a lista', async () => {
      prisma.uploadHistory.groupBy.mockResolvedValue([
        { userId: 'sumiu', _count: { _all: 3 } },
      ]);

      const result = await service.topContributors();

      expect(result[0].name).toBeNull();
      expect(result[0].contributions).toBe(3);
    });
  });
});
