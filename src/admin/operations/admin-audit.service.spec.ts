import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';

describe('AdminAuditService', () => {
  let service: AdminAuditService;
  let prisma: {
    adminAuditLog: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    user: { findMany: jest.Mock };
  };

  const registro = (over: Record<string, unknown> = {}) => ({
    id: 'audit-1',
    actorId: 'admin-1',
    actorRole: 'SUPER_ADMIN',
    action: 'user.update',
    entityType: 'user',
    entityId: 'user-9',
    metadata: null,
    ipAddress: '203.0.113.10',
    userAgent: 'jest',
    requestId: 'req-1',
    success: true,
    createdAt: new Date('2026-03-10T12:00:00.000Z'),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      adminAuditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminAuditService);
  });

  // -----------------------------------------------------------------
  describe('listagem', () => {
    it('resolve o nome de quem agiu em lote', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([
        registro({ id: 'a1', actorId: 'admin-1' }),
        registro({ id: 'a2', actorId: 'admin-1' }),
        registro({ id: 'a3', actorId: 'admin-2' }),
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-1', firstName: 'Ana', lastName: 'Costa', email: null },
      ]);

      const result = await service.list({});

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany.mock.calls[0][0].where.id.in).toEqual([
        'admin-1',
        'admin-2',
      ]);
      expect(result.entries[0].actorName).toBe('Ana Costa');
    });

    // A trilha guarda só o id de propósito: precisa continuar legível mesmo
    // depois de a conta ser removida.
    it('conta removida deixa o id e o nome nulo', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([registro()]);

      const result = await service.list({});

      expect(result.entries[0].actorName).toBeNull();
      expect(result.entries[0].actorId).toBe('admin-1');
    });

    // É o filtro que uma investigação procura primeiro.
    it('filtra só as tentativas negadas', async () => {
      await service.list({ onlyFailures: true });

      expect(prisma.adminAuditLog.findMany.mock.calls[0][0].where.success).toBe(
        false,
      );
    });

    it('filtra por prefixo de ação', async () => {
      await service.list({ actionPrefix: 'newsletter' });

      expect(
        prisma.adminAuditLog.findMany.mock.calls[0][0].where.action,
      ).toEqual({ startsWith: 'newsletter' });
    });

    it('filtra pela entidade afetada', async () => {
      await service.list({ entityType: 'user', entityId: 'user-9' });

      const { where } = prisma.adminAuditLog.findMany.mock.calls[0][0];

      expect(where.entityType).toBe('user');
      expect(where.entityId).toBe('user-9');
    });

    it('sem ator, não consulta usuários', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([
        registro({ actorId: null }),
      ]);

      await service.list({});

      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('rolagem por cursor', () => {
    it('continua do cursor e não conta a base de novo', async () => {
      const result = await service.list({ cursor: '685d591c1e3db0c5aaa893e4' });

      const args = prisma.adminAuditLog.findMany.mock.calls[0][0];

      expect(args.cursor).toEqual({ id: '685d591c1e3db0c5aaa893e4' });
      expect(args.skip).toBe(1);
      expect(prisma.adminAuditLog.count).not.toHaveBeenCalled();
      expect(result.pagination.total).toBeNull();
    });

    // Sem o id no desempate, dois registros do mesmo instante trocam de lugar
    // entre uma busca e outra, e a rolagem pula ou repete linhas.
    it('ordena com o id como desempate', async () => {
      await service.list({});

      const { orderBy } = prisma.adminAuditLog.findMany.mock.calls[0][0];

      expect(Array.isArray(orderBy)).toBe(true);
      expect(orderBy[orderBy.length - 1]).toHaveProperty('id');
    });

    it('página cheia devolve o cursor seguinte; incompleta, nulo', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([
        registro({ id: 'a', actorId: null }),
        registro({ id: 'b', actorId: null }),
      ]);

      const cheia = await service.list({ limit: 2 });

      expect(cheia.pagination.nextCursor).toBe('b');

      prisma.adminAuditLog.findMany.mockResolvedValue([
        registro({ id: 'a', actorId: null }),
      ]);

      const fim = await service.list({ limit: 2 });

      expect(fim.pagination.nextCursor).toBeNull();
    });

    it('sem cursor, mantém página e total como antes', async () => {
      prisma.adminAuditLog.count.mockResolvedValue(120);

      const result = await service.list({ page: 3, limit: 10 });

      expect(prisma.adminAuditLog.findMany.mock.calls[0][0].skip).toBe(20);
      expect(result.pagination).toMatchObject({
        page: 3,
        total: 120,
        totalPages: 12,
      });
    });
  });

  // -----------------------------------------------------------------
  describe('resumo', () => {
    // Nenhuma ação registrada não é 0% de falha.
    it('taxa de falha é nula sem base', async () => {
      const result = await service.summary({});

      expect(result.failureRate).toBeNull();
    });

    it('calcula a taxa de recusa do período', async () => {
      prisma.adminAuditLog.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(10);

      const result = await service.summary({ days: 30 });

      expect(result.total).toBe(200);
      expect(result.failures).toBe(10);
      expect(result.failureRate).toBe(5);
    });

    it('a janela do período chega na consulta', async () => {
      await service.summary({ days: 7 });

      const { where } = prisma.adminAuditLog.count.mock.calls[0][0];

      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('nomeia quem mais agiu', async () => {
      prisma.adminAuditLog.groupBy
        .mockResolvedValueOnce([{ action: 'user.update', _count: { _all: 5 } }])
        .mockResolvedValueOnce([{ actorId: 'admin-1', _count: { _all: 5 } }]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-1', firstName: 'Ana', lastName: 'Costa', email: null },
      ]);

      const result = await service.summary({});

      expect(result.topActors[0]).toEqual({
        actorId: 'admin-1',
        name: 'Ana Costa',
        count: 5,
      });
    });
  });

  // -----------------------------------------------------------------
  describe('exportação', () => {
    it('limita e avisa quando trunca', async () => {
      const result = await service.export({ format: 'json' });

      expect(prisma.adminAuditLog.findMany.mock.calls[0][0].take).toBe(20_000);
      expect(result).toMatchObject({ truncated: false });
    });

    it('em CSV, escapa o conteúdo', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([
        registro({ action: '=SOMA(A1)' }),
      ]);

      const result = await service.export({ format: 'csv' });

      if (!('csv' in result)) {
        throw new Error('esperava CSV');
      }

      expect(result.csv).toContain('"\'=SOMA(A1)"');
    });

    it('a exportação registra sucesso e recusa', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([
        registro({ success: false }),
      ]);

      const result = await service.export({ format: 'csv' });

      if (!('csv' in result)) {
        throw new Error('esperava CSV');
      }

      expect(result.csv).toContain('"não"');
    });
  });
});
