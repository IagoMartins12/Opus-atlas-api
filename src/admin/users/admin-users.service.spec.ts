import { AppCacheService } from '../../common/cache/cache.service';
import { TeacherInvitationService } from './teacher-invitation.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  const invitations = { send: jest.fn().mockResolvedValue(true) };

  let service: AdminUsersService;
  let prisma: {
    user: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      update: jest.Mock;
    };
    teacher: { create: jest.Mock; update: jest.Mock };
    workAnnotation: { groupBy: jest.Mock };
    favoriteWork: { groupBy: jest.Mock };
    learned: { groupBy: jest.Mock };
    storedAsset: { groupBy: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    user: { update: jest.Mock };
    teacher: { create: jest.Mock; update: jest.Mock };
  };

  const alvo = (over: Record<string, unknown> = {}) => ({
    id: 'user-2',
    role: 0,
    isTeacher: false,
    teacherProfile: null,
    ...over,
  });

  beforeEach(async () => {
    tx = {
      user: { update: jest.fn().mockResolvedValue({}) },
      teacher: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(alvo()),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      teacher: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      workAnnotation: { groupBy: jest.fn().mockResolvedValue([]) },
      favoriteWork: { groupBy: jest.fn().mockResolvedValue([]) },
      learned: { groupBy: jest.fn().mockResolvedValue([]) },
      storedAsset: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppCacheService, useValue: { invalidateMany: jest.fn() } },
        { provide: TeacherInvitationService, useValue: invitations },
      ],
    }).compile();

    service = module.get(AdminUsersService);
  });

  // -----------------------------------------------------------------
  describe('alteração de papel', () => {
    // O guard compara `role < nívelExigido`: gravar 999 daria acesso a tudo.
    // A validação de domínio está no DTO; aqui garantimos que o serviço não
    // grava nada quando não há o que gravar.
    it('recusa corpo vazio', async () => {
      await expect(service.update('admin-1', 'user-2', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('usuário inexistente responde 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('admin-1', 'user-2', { role: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    // Perder o próprio acesso administrativo não tem caminho de volta pela API.
    it('ninguém rebaixa a si mesmo', async () => {
      prisma.user.findUnique.mockResolvedValue(
        alvo({ id: 'admin-1', role: 2 }),
      );

      await expect(
        service.update('admin-1', 'admin-1', { role: 0 }),
      ).rejects.toThrow(ConflictException);
    });

    it('promover a si mesmo é permitido', async () => {
      prisma.user.findUnique.mockResolvedValue(
        alvo({ id: 'admin-1', role: 1 }),
      );

      await expect(
        service.update('admin-1', 'admin-1', { role: 2 }),
      ).resolves.toBeDefined();
    });

    // Sem isso, a instalação fica sem ninguém capaz de administrar.
    it('o último super admin não é rebaixado', async () => {
      prisma.user.findUnique.mockResolvedValue(alvo({ id: 'user-2', role: 2 }));
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.update('admin-1', 'user-2', { role: 1 }),
      ).rejects.toThrow(ConflictException);
    });

    it('havendo outro super admin, o rebaixamento passa', async () => {
      prisma.user.findUnique.mockResolvedValue(alvo({ id: 'user-2', role: 2 }));
      prisma.user.count.mockResolvedValue(3);

      await expect(
        service.update('admin-1', 'user-2', { role: 1 }),
      ).resolves.toBeDefined();
    });
  });

  // -----------------------------------------------------------------
  describe('perfil de professor', () => {
    // No legado o `teacher.create` acontecia antes do `user.update`: falhando o
    // segundo, sobrava perfil de professor numa conta que não é professor.
    it('conta e perfil mudam na mesma transação', async () => {
      await service.update('admin-1', 'user-2', { isTeacher: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalled();
      expect(tx.teacher.create).toHaveBeenCalled();
      expect(prisma.teacher.create).not.toHaveBeenCalled();
    });

    it('promover a professor cria o perfil e marca a conta', async () => {
      await service.update('admin-1', 'user-2', { isTeacher: true });

      expect(tx.user.update.mock.calls[0][0].data.isTeacher).toBe(true);
    });

    // Promover a professor não é o mesmo que aprovar o professor.
    it('o perfil nasce pendente e não verificado', async () => {
      await service.update('admin-1', 'user-2', { isTeacher: true });

      expect(tx.teacher.create.mock.calls[0][0].data).toEqual({
        userId: 'user-2',
        status: 'PENDING',
        isVerified: false,
      });
    });

    it('não recria o perfil de quem já tem', async () => {
      prisma.user.findUnique.mockResolvedValue(
        alvo({ teacherProfile: { id: 'teacher-1' } }),
      );

      await service.update('admin-1', 'user-2', { isTeacher: true });

      expect(tx.teacher.create).not.toHaveBeenCalled();
    });

    // As aulas e o histórico dos alunos dependem do perfil continuar existindo.
    it('deixar de ser professor desativa em vez de apagar', async () => {
      prisma.user.findUnique.mockResolvedValue(
        alvo({ isTeacher: true, teacherProfile: { id: 'teacher-1' } }),
      );

      await service.update('admin-1', 'user-2', { isTeacher: false });

      expect(tx.teacher.update.mock.calls[0][0].data).toEqual({
        status: 'INACTIVE',
        isVerified: false,
      });
      expect(tx.user.update.mock.calls[0][0].data.isTeacher).toBe(false);
    });

    it('promover a professor envia o convite', async () => {
      await service.update('admin-1', 'user-2', { isTeacher: true });

      expect(invitations.send).toHaveBeenCalledWith('user-2', 'admin-1');
    });

    // Papel 1 é administrador. O legado usava role 1 para "fazer professor".
    it('promover a admin não transforma em professor', async () => {
      await service.update('admin-1', 'user-2', { role: 1 });

      expect(tx.teacher.create).not.toHaveBeenCalled();
      expect(tx.user.update.mock.calls[0][0].data.isTeacher).toBeUndefined();
    });

    it('rebaixar um admin professor não desativa o perfil de professor', async () => {
      prisma.user.findUnique.mockResolvedValue(
        alvo({ role: 1, isTeacher: true, teacherProfile: { id: 'teacher-1' } }),
      );

      await service.update('admin-1', 'user-2', { role: 0 });

      expect(tx.teacher.update).not.toHaveBeenCalled();
    });

    it('mudar só o tipo não mexe no perfil de professor', async () => {
      await service.update('admin-1', 'user-2', {
        userType: UserType.CASUAL_USER,
      });

      expect(tx.teacher.create).not.toHaveBeenCalled();
      expect(tx.teacher.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('listagem', () => {
    it('resolve as contagens em lote, não por usuário', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', firstName: 'A', lastName: 'B' },
        { id: 'u2', firstName: 'C', lastName: 'D' },
        { id: 'u3', firstName: 'E', lastName: 'F' },
      ]);
      prisma.workAnnotation.groupBy.mockResolvedValue([
        { userId: 'u1', _count: { _all: 4 } },
      ]);

      const result = await service.list({});

      expect(prisma.workAnnotation.groupBy).toHaveBeenCalledTimes(1);
      expect(result.users[0].counts.annotations).toBe(4);
      expect(result.users[1].counts.annotations).toBe(0);
    });

    it('a busca cobre nome, e-mail e usuário', async () => {
      await service.list({ search: 'maria' });

      const { where } = prisma.user.findMany.mock.calls[0][0];

      expect(where.OR).toHaveLength(4);
      expect(where.OR[0].email.mode).toBe('insensitive');
    });

    it('sem busca, não monta OR vazio', async () => {
      await service.list({});

      expect(prisma.user.findMany.mock.calls[0][0].where.OR).toBeUndefined();
    });

    // A projeção é declarada campo a campo; `hashedPassword` não está nela.
    it('a projeção não inclui o hash da senha', async () => {
      await service.list({});

      const { select } = prisma.user.findMany.mock.calls[0][0];

      expect(select).not.toHaveProperty('hashedPassword');
      expect(select.email).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  describe('rolagem por cursor', () => {
    it('continua do cursor e não conta a base de novo', async () => {
      const result = await service.list({ cursor: '685d591c1e3db0c5aaa893e4' });

      const args = prisma.user.findMany.mock.calls[0][0];

      expect(args.cursor).toEqual({ id: '685d591c1e3db0c5aaa893e4' });
      expect(args.skip).toBe(1);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(result.pagination.total).toBeNull();
    });

    // Sem o id no desempate, dois registros do mesmo instante trocam de lugar
    // entre uma busca e outra, e a rolagem pula ou repete linhas.
    it('ordena com o id como desempate', async () => {
      await service.list({});

      const { orderBy } = prisma.user.findMany.mock.calls[0][0];

      expect(Array.isArray(orderBy)).toBe(true);
      expect(orderBy[orderBy.length - 1]).toHaveProperty('id');
    });

    it('página cheia devolve o cursor seguinte; incompleta, nulo', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'a', firstName: 'A', lastName: 'A' },
        { id: 'b', firstName: 'B', lastName: 'B' },
      ]);

      const cheia = await service.list({ limit: 2 });

      expect(cheia.pagination.nextCursor).toBe('b');

      prisma.user.findMany.mockResolvedValue([
        { id: 'a', firstName: 'A', lastName: 'A' },
      ]);

      const fim = await service.list({ limit: 2 });

      expect(fim.pagination.nextCursor).toBeNull();
    });

    it('sem cursor, mantém página e total como antes', async () => {
      prisma.user.count.mockResolvedValue(120);

      const result = await service.list({ page: 3, limit: 10 });

      expect(prisma.user.findMany.mock.calls[0][0].skip).toBe(20);
      expect(result.pagination).toMatchObject({
        page: 3,
        total: 120,
        totalPages: 12,
      });
    });
  });

  // -----------------------------------------------------------------
  describe('analytics', () => {
    // Crescimento infinito a partir de zero não é informação.
    it('crescimento é nulo quando não havia base anterior', async () => {
      prisma.user.count.mockResolvedValue(0);

      const result = await service.analytics({});

      expect(result.growthRate).toBeNull();
    });

    it('calcula o crescimento sobre o período anterior', async () => {
      prisma.user.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(15) // novos
        .mockResolvedValueOnce(10) // anteriores
        .mockResolvedValueOnce(40) // ativos
        .mockResolvedValueOnce(5); // professores

      const result = await service.analytics({ period: '30d' });

      expect(result.growthRate).toBe(50);
      expect(result.total).toBe(100);
    });
  });

  // -----------------------------------------------------------------
  describe('exportação', () => {
    // Nome e e-mail são escritos pelo usuário, e quem abre a exportação é o
    // administrador — a conta de maior privilégio.
    it('neutraliza fórmula no CSV', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          firstName: '=HYPERLINK("http://x","c")',
          lastName: '',
          email: 'a@b.c',
          username: null,
          userType: null,
          experienceLevel: 'BEGINNER',
          role: 0,
          isTeacher: false,
          isStudent: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastSeen: null,
        },
      ]);

      const result = await service.export({ format: 'csv' });

      if (!('csv' in result)) {
        throw new Error('esperava CSV');
      }

      expect(result.csv).toContain('"\'=HYPERLINK');
    });

    it('limita e avisa quando trunca', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.export({ format: 'json' });

      expect(prisma.user.findMany.mock.calls[0][0].take).toBe(10_000);
      expect(result).toMatchObject({ truncated: false });
    });
  });
});
