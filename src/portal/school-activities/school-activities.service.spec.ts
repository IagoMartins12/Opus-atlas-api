import { Test, TestingModule } from '@nestjs/testing';
import { SchoolActivityAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SchoolActivitiesService } from './school-activities.service';

describe('SchoolActivitiesService', () => {
  let service: SchoolActivitiesService;
  let prisma: {
    schoolActivity: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    lesson: { findMany: jest.Mock };
    assignment: { findMany: jest.Mock };
    student: { findMany: jest.Mock };
  };

  const activity = (over: Record<string, unknown> = {}) => ({
    id: 'act-1',
    userId: 'user-1',
    userType: 'teacher',
    action: SchoolActivityAction.LESSON_CREATED,
    entityType: 'lesson',
    entityId: 'lesson-1',
    entityName: 'Sonata',
    title: 'Agendou uma aula',
    description: null,
    changes: null,
    metadata: null,
    createdAt: new Date('2026-03-10T19:00:00.000Z'),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      schoolActivity: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
      student: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchoolActivitiesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SchoolActivitiesService);
  });

  const input = {
    userId: 'user-1',
    userType: 'teacher' as const,
    action: SchoolActivityAction.LESSON_CREATED,
    entityType: 'lesson',
    title: 'Agendou uma aula',
  };

  // -----------------------------------------------------------------
  describe('registro', () => {
    it('grava a atividade', async () => {
      await service.record(input);

      expect(prisma.schoolActivity.create.mock.calls[0][0].data.action).toBe(
        SchoolActivityAction.LESSON_CREATED,
      );
    });

    // Registrar é efeito colateral de uma ação que já aconteceu: falhar aqui
    // não pode desfazer o agendamento nem devolver erro a quem agendou.
    it('nunca lança', async () => {
      prisma.schoolActivity.create.mockRejectedValue(new Error('banco fora'));

      await expect(service.record(input)).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  describe('listagem', () => {
    // O legado derivava `userType` do papel da sessão e filtrava por ele:
    // quem é aluno e professor via só metade da própria trilha.
    it('sem `as`, traz os dois papéis', async () => {
      await service.list('user-1', {});

      const { where } = prisma.schoolActivity.findMany.mock.calls[0][0];

      expect(where.userId).toBe('user-1');
      expect(where.userType).toBeUndefined();
    });

    it('com `as`, filtra o lado', async () => {
      await service.list('user-1', { as: 'student' });

      expect(
        prisma.schoolActivity.findMany.mock.calls[0][0].where.userType,
      ).toBe('student');
    });

    it('aplica filtro de ação e de período', async () => {
      await service.list('user-1', {
        action: SchoolActivityAction.LESSON_CREATED,
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-30T00:00:00.000Z',
      });

      const { where } = prisma.schoolActivity.findMany.mock.calls[0][0];

      expect(where.action).toBe(SchoolActivityAction.LESSON_CREATED);
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    });

    // O legado rodava quatro agregações em toda listagem, inclusive nas que só
    // queriam as cinco atividades recentes de um painel.
    it('as estatísticas são opcionais', async () => {
      await service.list('user-1', {});
      expect(prisma.schoolActivity.groupBy).not.toHaveBeenCalled();

      await service.list('user-1', { stats: true });
      expect(prisma.schoolActivity.groupBy).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------
  describe('enriquecimento', () => {
    // O legado resolvia a entidade dentro de um `map`: uma página de 20
    // atividades disparava até 20 consultas adicionais.
    it('resolve as entidades em lote, uma consulta por tipo', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue([
        activity({ id: 'a1', entityId: 'lesson-1' }),
        activity({ id: 'a2', entityId: 'lesson-2' }),
        activity({ id: 'a3', entityId: 'lesson-3' }),
      ]);
      prisma.lesson.findMany.mockResolvedValue([
        {
          id: 'lesson-1',
          title: 'Sonata',
          scheduledAt: new Date(),
          status: 'COMPLETED',
        },
      ]);

      const result = await service.list('user-1', {});

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.lesson.findMany.mock.calls[0][0].where.id.in).toHaveLength(
        3,
      );
      expect(result.activities[0].entity).toMatchObject({ title: 'Sonata' });
    });

    it('entidade removida vem nula e sinalizada', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue([activity()]);

      const result = await service.list('user-1', {});

      expect(result.activities[0].entity).toBeNull();
      expect(result.activities[0].entityExists).toBe(false);
      // O nome guardado no registro sobrevive à remoção da entidade.
      expect(result.activities[0].entityName).toBe('Sonata');
    });

    // O legado buscava o `User` do aluno e caía para o e-mail como texto de
    // exibição quando o nome estava vazio.
    it('aluno é resolvido pelo perfil, sem e-mail', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue([
        activity({ entityType: 'student', entityId: 'student-1' }),
      ]);
      prisma.student.findMany.mockResolvedValue([
        {
          id: 'student-1',
          user: { firstName: 'João', lastName: 'Silva', image: null },
        },
      ]);

      const result = await service.list('user-1', {});

      expect(
        prisma.student.findMany.mock.calls[0][0].select,
      ).not.toHaveProperty('email');
      expect(JSON.stringify(result.activities[0].entity)).not.toContain('@');
    });

    // A frase pronta ("3 campos alterados") é decisão de apresentação.
    it('devolve os campos alterados, não a frase', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue([
        activity({ changes: { title: {}, dueDate: {} }, entityId: null }),
      ]);

      const result = await service.list('user-1', {});

      expect(result.activities[0].changedFields).toEqual(['title', 'dueDate']);
    });

    it('não quebra com `changes` fora do formato', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue([
        activity({ changes: 'texto solto', entityId: null }),
      ]);

      const result = await service.list('user-1', {});

      expect(result.activities[0].changedFields).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  describe('exportação', () => {
    it('limita a 5.000 registros e avisa quando corta', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue(
        Array.from({ length: 5000 }, () => activity()),
      );

      const result = await service.export('user-1', {});

      expect(prisma.schoolActivity.findMany.mock.calls[0][0].take).toBe(5000);
      expect(result).toMatchObject({ truncated: true, count: 5000 });
    });

    it('em CSV, escapa o conteúdo', async () => {
      prisma.schoolActivity.findMany.mockResolvedValue([
        activity({ title: '=SOMA(A1)', entityName: 'Aula "1"' }),
      ]);

      const result = await service.export('user-1', { format: 'csv' });

      if (!('csv' in result)) {
        throw new Error('esperava CSV');
      }

      expect(result.csv).toContain('"\'=SOMA(A1)"');
      expect(result.csv).toContain('"Aula ""1"""');
    });
  });
});
