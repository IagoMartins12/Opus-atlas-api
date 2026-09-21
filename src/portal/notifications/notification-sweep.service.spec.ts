import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationSweepService } from './notification-sweep.service';
import { NotificationsService } from './notifications.service';

const lessonRow = (scheduledAt: Date) => ({
  id: 'aula-1',
  title: 'Aula',
  scheduledAt,
  teacher: {
    user: { id: 'user-professor', firstName: 'Clara', lastName: 'Schumann' },
  },
  student: {
    user: { id: 'user-aluno', firstName: 'João', lastName: 'Silva' },
  },
});

describe('NotificationSweepService', () => {
  let service: NotificationSweepService;
  let prisma: {
    lesson: { findMany: jest.Mock };
    assignment: { findMany: jest.Mock };
    teacherStudent: { findMany: jest.Mock };
  };
  let notifications: { notifyMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
      teacherStudent: { findMany: jest.fn().mockResolvedValue([]) },
    };

    notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationSweepService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(NotificationSweepService);
  });

  it('relata quantas notificações cada regra produziu', async () => {
    const result = await service.sweep();

    expect(Object.keys(result.created)).toEqual([
      'aulaComecando',
      'aulaAmanha',
      'aulaSemStatus',
      'tarefaVencendo',
      'tarefaAtrasada',
      'convitePendente',
    ]);
    expect(result.total).toBe(0);
  });

  // O bug do legado: a rota do professor consultava com o id do usuário num
  // campo que referencia o id do perfil, e não casava com nada, sempre.
  it('varre a base inteira, sem filtrar por usuário', async () => {
    await service.sweep();

    for (const call of prisma.lesson.findMany.mock.calls) {
      expect(call[0].where).not.toHaveProperty('teacherId');
      expect(call[0].where).not.toHaveProperty('studentId');
    }
  });

  it('resolve os dois usuários pela relação, não por id solto', async () => {
    prisma.lesson.findMany.mockResolvedValueOnce([
      lessonRow(new Date(Date.now() + 10 * 60 * 1000)),
    ]);

    await service.sweep();

    const avisos = notifications.notifyMany.mock.calls[0][0];

    expect(avisos.map((aviso: { userId: string }) => aviso.userId)).toEqual([
      'user-professor',
      'user-aluno',
    ]);
  });

  // Meia hora antes, a mesma aula não pode gerar "começa logo" e "amanhã".
  it('a janela de amanhã começa onde a de agora termina', async () => {
    await service.sweep();

    const comecando = prisma.lesson.findMany.mock.calls[0][0].where.scheduledAt;
    const amanha = prisma.lesson.findMany.mock.calls[1][0].where.scheduledAt;

    expect(amanha.gt.getTime()).toBe(comecando.lte.getTime());
  });

  // Cobrar status de uma aula que ainda está acontecendo seria ruído.
  it('só cobra status de aula que passou há mais de duas horas', async () => {
    await service.sweep();

    const semStatus = prisma.lesson.findMany.mock.calls[2][0].where.scheduledAt;
    const horas = (Date.now() - semStatus.lt.getTime()) / 3_600_000;

    expect(horas).toBeCloseTo(2, 1);
  });

  it('só considera aula agendada', async () => {
    await service.sweep();

    for (const call of prisma.lesson.findMany.mock.calls) {
      expect(call[0].where.status).toBe('SCHEDULED');
    }
  });

  it('só considera tarefa que ainda não foi entregue', async () => {
    await service.sweep();

    for (const call of prisma.assignment.findMany.mock.calls) {
      expect(call[0].where.status.in).toEqual(['PENDING', 'IN_PROGRESS']);
    }
  });

  it('limita quantas linhas cada regra examina', async () => {
    await service.sweep();

    for (const call of prisma.lesson.findMany.mock.calls) {
      expect(call[0].take).toBe(2_000);
    }
  });

  it('usa nome de reserva quando a conta não tem nome', async () => {
    prisma.lesson.findMany.mockResolvedValueOnce([
      {
        ...lessonRow(new Date(Date.now() + 10 * 60 * 1000)),
        student: {
          user: { id: 'user-aluno', firstName: null, lastName: null },
        },
      },
    ]);

    await service.sweep();

    const [professor] = notifications.notifyMany.mock.calls[0][0];

    expect(professor.message).toContain('sem nome');
  });

  // Se a primeira regra falhar, as demais nem começam — em vez de ficarem
  // pendentes e virarem rejeição sem dono.
  it('interrompe a varredura quando uma regra falha', async () => {
    prisma.lesson.findMany.mockRejectedValueOnce(new Error('banco fora'));

    await expect(service.sweep()).rejects.toThrow('banco fora');
    expect(prisma.assignment.findMany).not.toHaveBeenCalled();
  });
});
