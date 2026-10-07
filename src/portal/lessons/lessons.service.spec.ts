import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType, LessonStatus, RecurrenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LessonSchedulingService } from './lesson-scheduling.service';
import { ScheduleRulesService } from './schedule-rules.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { LessonsService } from './lessons.service';

/** Data futura estável, para não depender do relógio do teste. */
const future = (daysAhead = 7): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(19, 0, 0, 0);
  return date.toISOString();
};

describe('LessonsService', () => {
  let service: LessonsService;
  let prisma: {
    teacher: { findUnique: jest.Mock };
    student: { findUnique: jest.Mock; update: jest.Mock };
    teacherStudent: { findFirst: jest.Mock; updateMany: jest.Mock };
    lesson: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let scheduling: {
    calculateOccurrences: jest.Mock;
  };
  let rules: { check: jest.Mock };

  /** O resultado do motor de agenda para uma lista de ocorrências. */
  const checkResult = (
    dates: Date[],
    severities: Array<'ok' | 'warning' | 'conflict' | 'blocking'> = [],
  ) => {
    const occurrences = dates.map((scheduledAt, i) => {
      const severity = severities[i] ?? 'ok';
      return {
        scheduledAt,
        severity,
        findings:
          severity === 'ok'
            ? []
            : [
                {
                  code: 'TEACHER_CLASH',
                  severity,
                  message: 'Choca com a aula de Ana.',
                },
              ],
        suggestions: severity === 'conflict' ? [new Date(future(3))] : [],
      };
    });
    return {
      severity: severities.includes('conflict') ? 'conflict' : 'ok',
      occurrences,
      summary: {
        blocking: occurrences.filter((o) => o.severity === 'blocking').length,
        conflicts: occurrences.filter((o) => o.severity === 'conflict').length,
        warnings: occurrences.filter((o) => o.severity === 'warning').length,
      },
    };
  };
  let notifications: { notify: jest.Mock };
  let tx: {
    lesson: { create: jest.Mock; update: jest.Mock };
    teacherStudent: { updateMany: jest.Mock };
    student: { update: jest.Mock };
  };

  const scheduledLesson = {
    id: 'lesson-1',
    title: 'Sonata',
    status: LessonStatus.SCHEDULED,
    duration: 60,
    scheduledAt: new Date(future()),
    teacherId: 'teacher-1',
    studentId: 'student-1',
    parentLessonId: null,
    teacher: { userId: 'teacher-user' },
    student: { userId: 'student-user' },
  };

  beforeEach(async () => {
    tx = {
      lesson: {
        create: jest.fn(
          (args: { data: { scheduledAt: Date; title: string } }) =>
            Promise.resolve({
              id: `lesson-${Math.random()}`,
              scheduledAt: args.data.scheduledAt,
              title: args.data.title,
            }),
        ),
        update: jest.fn().mockResolvedValue({ id: 'lesson-1' }),
      },
      teacherStudent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      student: { update: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      teacher: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'teacher-1',
          userId: 'teacher-user',
          defaultLessonDuration: 60,
        }),
      },
      student: {
        findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      teacherStudent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rel-1',
          lessonDuration: 60,
          student: { id: 'student-1', userId: 'student-user' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      lesson: {
        findUnique: jest.fn().mockResolvedValue(scheduledLesson),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest
          .fn()
          .mockResolvedValue({ id: 'lesson-1', title: 'Sonata' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    scheduling = {
      calculateOccurrences: jest.fn((start: Date) => [start]),
    };
    rules = {
      check: jest.fn((params: { occurrences: Date[] }) =>
        Promise.resolve(checkResult(params.occurrences)),
      ),
    };

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LessonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LessonSchedulingService, useValue: scheduling },
        { provide: ScheduleRulesService, useValue: rules },
        { provide: NotificationsService, useValue: notifications },
        // A trilha escolar é efeito colateral: o dublê só registra a chamada.
        { provide: SchoolActivitiesService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(LessonsService);
  });

  describe('create', () => {
    const dto = {
      studentId: 'student-1',
      title: 'Sonata',
      scheduledAt: future(),
    };

    it('agenda a aula e avisa o aluno', async () => {
      const result = await service.create('teacher-user', dto);

      expect(result.created).toBe(1);
      expect(notifications.notify).toHaveBeenCalled();
    });

    it('recusa agendamento no passado', async () => {
      await expect(
        service.create('teacher-user', { ...dto, scheduledAt: future(-7) }),
      ).rejects.toThrow(BadRequestException);
    });

    // Só há aula onde há vínculo aceito: agendar com quem não aceitou o convite
    // criaria compromisso para alguém que nunca concordou.
    it('recusa aluno sem vínculo aceito', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue(null);

      await expect(service.create('teacher-user', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('recusa quem não é professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(service.create('qualquer', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('recusa quando há conflito, com sugestões', async () => {
      rules.check.mockImplementation((p: { occurrences: Date[] }) =>
        Promise.resolve(checkResult(p.occurrences, ['conflict'])),
      );

      const error = await service
        .create('teacher-user', dto)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as {
        suggestions: Date[];
      };
      expect(body.suggestions).toHaveLength(1);
    });

    // Aviso (folga curta, fora do atendimento) informa e não impede: a regra
    // do portal é que a agenda informa.
    it('marca com aviso e devolve os avisos', async () => {
      rules.check.mockImplementation((p: { occurrences: Date[] }) =>
        Promise.resolve(checkResult(p.occurrences, ['warning'])),
      );

      const result = await service.create('teacher-user', dto);

      expect(result.created).toBe(1);
      expect(result.warnings).toHaveLength(1);
    });

    it('cria mesmo com conflito quando forçado, e devolve os choques aceitos', async () => {
      rules.check.mockImplementation((p: { occurrences: Date[] }) =>
        Promise.resolve(checkResult(p.occurrences, ['conflict'])),
      );

      const result = await service.create('teacher-user', {
        ...dto,
        force: true,
      });

      expect(result.created).toBe(1);
      expect(result.acceptedConflicts).toHaveLength(1);
    });

    describe('série recorrente', () => {
      const start = future();
      const recurringDto = {
        ...dto,
        scheduledAt: start,
        isRecurring: true,
        recurrenceType: RecurrenceType.WEEKLY,
        recurrenceEnd: future(28),
      };

      it('exige data final da recorrência', async () => {
        await expect(
          service.create('teacher-user', {
            ...dto,
            isRecurring: true,
            recurrenceType: RecurrenceType.WEEKLY,
          }),
        ).rejects.toThrow(/recurrenceEnd/);
      });

      it('exige data final posterior à primeira aula', async () => {
        await expect(
          service.create('teacher-user', {
            ...recurringDto,
            recurrenceEnd: future(1),
          }),
        ).rejects.toThrow(BadRequestException);
      });

      // No legado a série era criada depois de validar só a data inicial, então
      // as ocorrências seguintes podiam sobrepor em silêncio.
      // Uma conferência só, com todas as ocorrências: a verificação antiga
      // fazia uma consulta por data.
      it('confere todas as ocorrências de uma vez', async () => {
        const dates = [1, 8, 15, 22].map((day) => new Date(future(day)));
        scheduling.calculateOccurrences.mockReturnValue(dates);

        await service.create('teacher-user', recurringDto);

        expect(rules.check).toHaveBeenCalledTimes(1);
        expect(rules.check.mock.calls[0][0].occurrences).toEqual(dates);
      });

      it('recusa quando uma ocorrência intermediária conflita', async () => {
        const dates = [1, 8, 15].map((day) => new Date(future(day)));
        scheduling.calculateOccurrences.mockReturnValue(dates);
        rules.check.mockImplementation((p: { occurrences: Date[] }) =>
          Promise.resolve(checkResult(p.occurrences, ['ok', 'conflict', 'ok'])),
        );

        await expect(
          service.create('teacher-user', recurringDto),
        ).rejects.toThrow(ConflictException);
      });

      it('pula as datas escolhidas e move as que chocavam', async () => {
        const dates = [1, 8, 15].map((day) => new Date(future(day)));
        const moved = new Date(future(9));
        scheduling.calculateOccurrences.mockReturnValue(dates);

        const result = await service.create('teacher-user', {
          ...recurringDto,
          skipOccurrences: [dates[2].toISOString()],
          moveOccurrences: [
            { from: dates[1].toISOString(), to: moved.toISOString() },
          ],
        });

        expect(rules.check.mock.calls[0][0].occurrences).toEqual([
          dates[0],
          moved,
        ]);
        expect(result.created).toBe(2);
      });

      it('recusa quando todas as datas foram puladas', async () => {
        const dates = [1, 8].map((day) => new Date(future(day)));
        scheduling.calculateOccurrences.mockReturnValue(dates);

        await expect(
          service.create('teacher-user', {
            ...recurringDto,
            skipOccurrences: dates.map((d) => d.toISOString()),
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('cria todas as ocorrências numa transação', async () => {
        const dates = [1, 8, 15].map((day) => new Date(future(day)));
        scheduling.calculateOccurrences.mockReturnValue(dates);

        const result = await service.create('teacher-user', recurringDto);

        expect(prisma.$transaction).toHaveBeenCalled();
        expect(result.created).toBe(3);
      });

      // A aula-mãe é o que permite cancelar a série inteira depois.
      it('liga as ocorrências seguintes à primeira', async () => {
        const dates = [1, 8, 15].map((day) => new Date(future(day)));
        scheduling.calculateOccurrences.mockReturnValue(dates);

        await service.create('teacher-user', recurringDto);

        const parentIds = tx.lesson.create.mock.calls.map(
          (call: [{ data: { parentLessonId: string | null } }]) =>
            call[0].data.parentLessonId,
        );

        expect(parentIds[0]).toBeNull();
        expect(parentIds[1]).not.toBeNull();
        expect(parentIds[2]).toBe(parentIds[1]);
      });
    });
  });

  describe('cancel', () => {
    it('cancela apenas a aula pedida por padrão', async () => {
      await service.cancel('teacher-user', 'lesson-1', {
        reason: 'Imprevisto',
      });

      expect(prisma.lesson.updateMany.mock.calls[0][0].where).toMatchObject({
        id: 'lesson-1',
      });
    });

    // As aulas passadas permanecem: apagá-las do calendário reescreveria o
    // histórico das duas partes.
    it('cancela só as ocorrências futuras da série', async () => {
      await service.cancel('teacher-user', 'lesson-1', {
        reason: 'Viagem',
        cancelSeries: true,
      });

      const where = prisma.lesson.updateMany.mock.calls[0][0].where;

      expect(where.scheduledAt.gte).toBeInstanceOf(Date);
      expect(where.status).toBe(LessonStatus.SCHEDULED);
    });

    it('recusa cancelar aula já encerrada', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        status: LessonStatus.COMPLETED,
      });

      await expect(
        service.cancel('teacher-user', 'lesson-1', { reason: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('avisa o aluno do cancelamento', async () => {
      await service.cancel('teacher-user', 'lesson-1', {
        reason: 'Imprevisto',
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'student-user' }),
      );
    });
  });

  describe('complete', () => {
    // Falta e aula dada são coisas diferentes no histórico e nas estatísticas.
    it('registra falta como NO_SHOW, não como concluída', async () => {
      await service.complete('teacher-user', 'lesson-1', {
        studentPresent: false,
      });

      expect(tx.lesson.update.mock.calls[0][0].data.status).toBe(
        LessonStatus.NO_SHOW,
      );
    });

    it('registra presença como concluída', async () => {
      await service.complete('teacher-user', 'lesson-1', {
        studentPresent: true,
      });

      expect(tx.lesson.update.mock.calls[0][0].data.status).toBe(
        LessonStatus.COMPLETED,
      );
    });

    it('incrementa o contador de faltas do vínculo', async () => {
      await service.complete('teacher-user', 'lesson-1', {
        studentPresent: false,
      });

      expect(tx.teacherStudent.updateMany.mock.calls[0][0].data).toEqual({
        noShowLessons: { increment: 1 },
      });
    });

    it('não conta presença do aluno quando ele faltou', async () => {
      await service.complete('teacher-user', 'lesson-1', {
        studentPresent: false,
      });

      expect(tx.student.update).not.toHaveBeenCalled();
    });

    it('avisa o aluno quando a falta é registrada', async () => {
      await service.complete('teacher-user', 'lesson-1', {
        studentPresent: false,
      });

      expect(notifications.notify).toHaveBeenCalled();
    });

    it('não avisa quando o aluno compareceu', async () => {
      await service.complete('teacher-user', 'lesson-1', {
        studentPresent: true,
      });

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('recusa encerrar aula já encerrada', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        status: LessonStatus.CANCELLED,
      });

      await expect(
        service.complete('teacher-user', 'lesson-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reschedule', () => {
    it('guarda o horário anterior', async () => {
      await service.reschedule('teacher-user', 'lesson-1', {
        scheduledAt: future(14),
      });

      expect(
        prisma.lesson.update.mock.calls[0][0].data.rescheduledFrom,
      ).toEqual(scheduledLesson.scheduledAt);
    });

    it('ignora a própria aula ao checar conflito', async () => {
      await service.reschedule('teacher-user', 'lesson-1', {
        scheduledAt: future(14),
      });

      expect(rules.check).toHaveBeenCalledWith(
        expect.objectContaining({ excludeLessonId: 'lesson-1' }),
      );
    });

    it('recusa quando o novo horário conflita', async () => {
      rules.check.mockImplementation((p: { occurrences: Date[] }) =>
        Promise.resolve(checkResult(p.occurrences, ['conflict'])),
      );

      await expect(
        service.reschedule('teacher-user', 'lesson-1', {
          scheduledAt: future(14),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('autorização', () => {
    // Confirmar a existência da aula de outro professor já é informação demais.
    it('esconde aula de outro professor como não encontrada', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        teacherId: 'outro-professor',
      });

      await expect(
        service.cancel('teacher-user', 'lesson-1', { reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('esconde aula de que o usuário não participa', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        teacher: { userId: 'outro' },
        student: { userId: 'mais-outro' },
      });

      await expect(service.findOne('estranho', 'lesson-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    const detail = {
      id: 'lesson-1',
      title: 'Sonata',
      worksIds: [] as string[],
      workScoreIds: [] as string[],
      teacher: { id: 'teacher-1', userId: 'teacher-user', user: {} },
      student: { id: 'student-1', userId: 'student-user', user: {} },
    };

    let catalog: {
      workScore: { findMany: jest.Mock };
      work: { findMany: jest.Mock };
    };

    beforeEach(() => {
      catalog = {
        workScore: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'score-1',
              title: 'Urtext',
              type: 'SCORES',
              source: 'IMSLP',
              downloadUrl: 'https://example.test/score.pdf',
              work: {
                id: 'work-1',
                title: 'Sonata K. 545',
                composer: { id: 'c-1', name: 'Mozart', fullName: null },
              },
            },
          ]),
        },
        work: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'work-2',
              title: 'Prelúdio',
              composer: { id: 'c-2', name: 'Bach', fullName: null },
            },
          ]),
        },
      };
      Object.assign(prisma, catalog);
    });

    // A aula só guarda ids; a tela precisa de título, compositor e link.
    it('resolve as obras e partituras vinculadas', async () => {
      prisma.lesson.findUnique
        .mockResolvedValueOnce(scheduledLesson)
        .mockResolvedValueOnce({
          ...detail,
          workScoreIds: ['score-1'],
          worksIds: ['work-2'],
        });

      const result = await service.findOne('teacher-user', 'lesson-1');

      expect(catalog.workScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['score-1'] } } }),
      );
      expect(catalog.work.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['work-2'] } } }),
      );
      expect(result).toMatchObject({
        workScores: [{ id: 'score-1', work: { id: 'work-1' } }],
        works: [{ id: 'work-2' }],
      });
    });

    it('não consulta o catálogo quando a aula não tem vínculos', async () => {
      prisma.lesson.findUnique
        .mockResolvedValueOnce(scheduledLesson)
        .mockResolvedValueOnce(detail);

      const result = await service.findOne('student-user', 'lesson-1');

      expect(catalog.workScore.findMany).not.toHaveBeenCalled();
      expect(catalog.work.findMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ workScores: [], works: [] });
    });
  });

  describe('submitStudentFeedback', () => {
    it('recusa feedback antes de a aula acontecer', async () => {
      await expect(
        service.submitStudentFeedback('student-user', 'lesson-1', {
          feedback: 'boa',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita feedback do aluno depois da aula', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        status: LessonStatus.COMPLETED,
      });

      await service.submitStudentFeedback('student-user', 'lesson-1', {
        feedback: 'Aula muito boa',
      });

      expect(prisma.lesson.update).toHaveBeenCalled();
    });

    it('recusa feedback vindo do professor', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        status: LessonStatus.COMPLETED,
      });

      await expect(
        service.submitStudentFeedback('teacher-user', 'lesson-1', {
          feedback: 'x',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // O aluno avisando o professor — era a última coisa que a tela de aula ainda
  // pedia à rota do legado.
  describe('sendStudentNotice', () => {
    it('avisa o professor da ausência sem mexer na aula', async () => {
      await expect(
        service.sendStudentNotice('student-user', 'lesson-1', {
          type: 'absence',
          message: 'Tenho prova nesse horário',
        }),
      ).resolves.toEqual({ success: true });

      expect(prisma.lesson.update).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'teacher-user',
          type: NotificationType.STUDENT_INFORMED_ABSENCE,
        }),
      );
      const [{ message }] = notifications.notify.mock.calls[0];
      expect(message).toContain('Tenho prova nesse horário');
    });

    it('pedido de remarcação usa o outro tipo de notificação', async () => {
      await service.sendStudentNotice('student-user', 'lesson-1', {
        type: 'reschedule',
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.STUDENT_REQUESTED_RESCHEDULE,
        }),
      );
    });

    it('recusa o aviso vindo do professor', async () => {
      await expect(
        service.sendStudentNotice('teacher-user', 'lesson-1', {
          type: 'absence',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    // Avisar ausência numa aula que já aconteceu não quer dizer nada.
    it('recusa o aviso em aula que não está mais agendada', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        ...scheduledLesson,
        status: LessonStatus.COMPLETED,
      });

      await expect(
        service.sendStudentNotice('student-user', 'lesson-1', {
          type: 'absence',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    // As anotações privadas do professor não podem vazar para o aluno.
    it('não devolve anotações privadas para o aluno', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await service.list('student-user', {});

      const select = prisma.lesson.findMany.mock.calls[0][0].select;

      expect(select).not.toHaveProperty('teacherNotes');
    });

    it('devolve anotações privadas para o professor', async () => {
      await service.list('teacher-user', {});

      expect(prisma.lesson.findMany.mock.calls[0][0].select).toHaveProperty(
        'teacherNotes',
      );
    });

    it('permite ao professor filtrar por aluno', async () => {
      await service.list('teacher-user', { studentId: 'student-1' });

      expect(prisma.lesson.findMany.mock.calls[0][0].where.studentId).toBe(
        'student-1',
      );
    });

    // O aluno não pode usar o filtro para ver as aulas de outro aluno.
    it('ignora o filtro por aluno quando quem consulta é aluno', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await service.list('student-user', { studentId: 'outro-aluno' });

      expect(prisma.lesson.findMany.mock.calls[0][0].where.studentId).toBe(
        'student-1',
      );
    });

    it('o aluno filtra por professor; o professor não troca o próprio recorte', async () => {
      prisma.teacher.findUnique.mockResolvedValueOnce(null);
      await service.list('student-user', { teacherId: 'teacher-2' });
      expect(prisma.lesson.findMany.mock.calls[0][0].where.teacherId).toBe(
        'teacher-2',
      );

      await service.list('teacher-user', { teacherId: 'teacher-2' });
      expect(prisma.lesson.findMany.mock.calls[1][0].where.teacherId).not.toBe(
        'teacher-2',
      );
    });

    // A busca procura o nome do outro lado da aula, com o texto escapado.
    it('a busca do aluno procura o professor, escapando o texto', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await service.list('student-user', { q: 'Bach (1)' });

      const or = prisma.lesson.findMany.mock.calls[0][0].where.OR;
      expect(or[1]).toHaveProperty('teacher');
      expect(or[0].title.contains).toBe('Bach \\(1\\)');
    });
  });
});
