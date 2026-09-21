import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentStatus } from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { AssignmentsService } from './assignments.service';

/** Prazo futuro estável, para o teste não depender do relógio. */
const future = (daysAhead = 7): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString();
};

const past = (daysBehind = 7): Date => {
  const date = new Date();
  date.setDate(date.getDate() - daysBehind);
  return date;
};

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let prisma: {
    teacher: { findUnique: jest.Mock };
    student: { findUnique: jest.Mock };
    teacherStudent: { findFirst: jest.Mock };
    lesson: { findFirst: jest.Mock };
    workScore: { findMany: jest.Mock };
    storedAsset: { findUnique: jest.Mock; update: jest.Mock };
    assignment: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let notifications: { notify: jest.Mock };
  let storage: {
    confirmUpload: jest.Mock;
    deleteAsset: jest.Mock;
    deleteByEntity: jest.Mock;
  };

  const assignmentRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'assignment-1',
    title: 'Estudar a exposição',
    description: 'Mãos separadas',
    type: 'practice',
    priority: 'medium',
    status: AssignmentStatus.PENDING,
    dueDate: new Date(future()),
    estimatedTime: 60,
    actualTime: null,
    isCompleted: false,
    completedAt: null,
    progress: 0,
    workScoreIds: [],
    worksIds: [],
    exercises: [],
    practiceGoals: [],
    technicalGoals: [],
    musicalGoals: [],
    tempoTargets: null,
    teacherFeedback: null,
    teacherRating: null,
    studentNotes: null,
    studentRating: null,
    submissions: null,
    submissionDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    student: {
      id: 'student-1',
      userId: 'student-user',
      user: { firstName: 'João', lastName: 'Silva', image: null },
    },
    lesson: {
      id: 'lesson-1',
      title: 'Aula 3',
      scheduledAt: new Date(),
      teacher: {
        id: 'teacher-1',
        userId: 'teacher-user',
        user: { firstName: 'Ana', lastName: 'Costa', image: null },
      },
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      teacher: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'teacher-1', userId: 'teacher-user' }),
      },
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      teacherStudent: {
        findFirst: jest.fn().mockResolvedValue({ id: 'rel-1' }),
      },
      lesson: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'lesson-1',
          title: 'Aula 3',
          studentId: 'student-1',
          student: { userId: 'student-user' },
        }),
      },
      workScore: { findMany: jest.fn().mockResolvedValue([]) },
      storedAsset: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
        update: jest.fn().mockResolvedValue({}),
      },
      assignment: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(assignmentRow(args.data)),
        ),
        findUnique: jest.fn().mockResolvedValue(assignmentRow()),
        findMany: jest.fn().mockResolvedValue([assignmentRow()]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(assignmentRow(args.data)),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    storage = {
      confirmUpload: jest.fn().mockResolvedValue({
        id: 'asset-1',
        secureUrl: 'https://res.cloudinary.com/demo/video/upload/v1/a.mp4',
      }),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
      deleteByEntity: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: StorageService, useValue: storage },
        // A trilha escolar é efeito colateral: o dublê só registra a chamada.
        { provide: SchoolActivitiesService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(AssignmentsService);
  });

  const createDto = {
    lessonId: 'lesson-1',
    title: 'Estudar a exposição',
    description: 'Mãos separadas',
  };

  // -----------------------------------------------------------------
  describe('create', () => {
    it('deriva o aluno da aula', async () => {
      await service.create('teacher-user', createDto);

      expect(prisma.assignment.create.mock.calls[0][0].data.studentId).toBe(
        'student-1',
      );
    });

    it('recusa aula de outro professor', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);

      await expect(service.create('teacher-user', createDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    // O legado só exigia aluno, título e descrição — sem `lessonId` o Prisma
    // descartava o filtro e a tarefa colava numa aula qualquer do professor.
    it('filtra a aula pelo professor dono', async () => {
      await service.create('teacher-user', createDto);

      expect(prisma.lesson.findFirst.mock.calls[0][0].where).toEqual({
        id: 'lesson-1',
        teacherId: 'teacher-1',
      });
    });

    it('exige vínculo ativo e aceito com o aluno', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue(null);

      await expect(service.create('teacher-user', createDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('exige perfil de professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(service.create('teacher-user', createDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('recusa prazo no passado', async () => {
      await expect(
        service.create('teacher-user', {
          ...createDto,
          dueDate: past().toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifica o aluno', async () => {
      await service.create('teacher-user', createDto);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'student-user',
          type: 'NEW_ASSIGNMENT_CREATED',
        }),
      );
    });

    it('nasce pendente e sem progresso', async () => {
      await service.create('teacher-user', createDto);

      const { data } = prisma.assignment.create.mock.calls[0][0];

      expect(data.status).toBe(AssignmentStatus.PENDING);
      expect(data.progress).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  describe('autorização', () => {
    // O legado montava um `OR` com `lesson: { teacherId: perfilProfessor?.id }`
    // e `studentId: perfilAluno?.id`. Quem chama só tem um dos perfis, então o
    // outro id era `undefined`, o Prisma descartava o campo, o ramo virava
    // condição vazia — e casava com tudo. Qualquer professor ou aluno lia e
    // escrevia qualquer tarefa da base.
    it('não deixa terceiro ler a tarefa', async () => {
      await expect(service.findOne('estranho', 'assignment-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('não deixa terceiro editar a tarefa', async () => {
      await expect(
        service.update('estranho', 'assignment-1', { title: 'novo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('não deixa terceiro apagar a tarefa', async () => {
      await expect(service.remove('estranho', 'assignment-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('não deixa o aluno editar a tarefa', async () => {
      await expect(
        service.update('student-user', 'assignment-1', { title: 'novo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('não deixa o professor concluir pelo aluno', async () => {
      await expect(
        service.complete('teacher-user', 'assignment-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('não deixa o professor enviar pelo aluno', async () => {
      await expect(
        service.addSubmission('teacher-user', 'assignment-1', {
          kind: 'text',
          note: 'oi',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    // Responder 403 confirmaria que o id existe para quem está sondando.
    it('responde 404, e não 403, para tarefa inexistente', async () => {
      prisma.assignment.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('teacher-user', 'assignment-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------
  describe('update', () => {
    it('só grava os campos da lista fechada', async () => {
      await service.update('teacher-user', 'assignment-1', {
        title: 'novo título',
      });

      const { data } = prisma.assignment.update.mock.calls[0][0];

      // O legado repassava `{ ...body }` inteiro para o professor.
      expect(data).not.toHaveProperty('studentId');
      expect(data).not.toHaveProperty('lessonId');
      expect(data).not.toHaveProperty('isCompleted');
      expect(data).not.toHaveProperty('completedAt');
      expect(data).not.toHaveProperty('studentNotes');
      expect(data.title).toBe('novo título');
    });

    it('recusa corpo vazio', async () => {
      await expect(
        service.update('teacher-user', 'assignment-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('remove o prazo quando `dueDate` vem nulo', async () => {
      await service.update('teacher-user', 'assignment-1', { dueDate: null });

      expect(prisma.assignment.update.mock.calls[0][0].data.dueDate).toBeNull();
    });

    it('não mexe no prazo quando `dueDate` não vem', async () => {
      await service.update('teacher-user', 'assignment-1', { title: 'x' });

      expect(
        prisma.assignment.update.mock.calls[0][0].data.dueDate,
      ).toBeUndefined();
    });

    it('avisa o aluno só quando algo relevante muda', async () => {
      await service.update('teacher-user', 'assignment-1', {
        title: 'Estudar a exposição',
      });

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('avisa o aluno quando o prazo muda', async () => {
      await service.update('teacher-user', 'assignment-1', {
        dueDate: future(30),
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ASSIGNMENT_UPDATED_BY_TEACHER' }),
      );
    });
  });

  // -----------------------------------------------------------------
  describe('progresso do aluno', () => {
    it('tira a tarefa de pendente', async () => {
      await service.updateProgress('student-user', 'assignment-1', {
        progress: 40,
      });

      expect(prisma.assignment.update.mock.calls[0][0].data.status).toBe(
        AssignmentStatus.IN_PROGRESS,
      );
    });

    it('não rebaixa o status de quem já está em andamento', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({ status: AssignmentStatus.IN_PROGRESS }),
      );

      await service.updateProgress('student-user', 'assignment-1', {
        progress: 80,
      });

      expect(
        prisma.assignment.update.mock.calls[0][0].data.status,
      ).toBeUndefined();
    });

    it('recusa progresso em tarefa concluída', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({ isCompleted: true }),
      );

      await expect(
        service.updateProgress('student-user', 'assignment-1', {
          progress: 50,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // No legado o marco era gravado dentro de `submissions`, e a notificação
    // do professor disparava a cada mudança daquele campo — então cada marco
    // registrado virava um aviso de "o aluno enviou uma submissão".
    it('registrar marco não notifica o professor', async () => {
      await service.updateProgress('student-user', 'assignment-1', {
        progress: 50,
        milestone: 'Mãos separadas prontas',
      });

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('guarda o marco no histórico', async () => {
      await service.updateProgress('student-user', 'assignment-1', {
        progress: 50,
        milestone: 'Mãos separadas prontas',
      });

      const { data } = prisma.assignment.update.mock.calls[0][0];

      expect(data.submissions.milestones).toHaveLength(1);
      expect(data.submissions.milestones[0].label).toBe(
        'Mãos separadas prontas',
      );
    });
  });

  // -----------------------------------------------------------------
  describe('submissões', () => {
    it('confirma a posse do arquivo antes de anexar', async () => {
      await service.addSubmission('student-user', 'assignment-1', {
        kind: 'video',
        assetId: 'asset-1',
      });

      expect(storage.confirmUpload).toHaveBeenCalledWith(
        'asset-1',
        'student-user',
      );
    });

    it('propaga a recusa de arquivo alheio', async () => {
      storage.confirmUpload.mockRejectedValue(
        new NotFoundException('Upload não encontrado'),
      );

      await expect(
        service.addSubmission('student-user', 'assignment-1', {
          kind: 'video',
          assetId: 'asset-de-outro',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('recusa envio sem arquivo nem comentário', async () => {
      await expect(
        service.addSubmission('student-user', 'assignment-1', {
          kind: 'text',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    // O legado guardava um vídeo só e apagava o anterior a cada novo envio.
    it('acumula envios em vez de substituir o anterior', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({
          submissions: {
            entries: [
              {
                id: 'antigo',
                kind: 'video',
                note: null,
                assetId: null,
                url: 'https://exemplo/antigo.mp4',
                submittedAt: new Date().toISOString(),
              },
            ],
            milestones: [],
          },
        }),
      );

      await service.addSubmission('student-user', 'assignment-1', {
        kind: 'text',
        note: 'segunda tentativa',
      });

      const { data } = prisma.assignment.update.mock.calls[0][0];

      expect(data.submissions.entries).toHaveLength(2);
      expect(data.submissions.entries[0].id).toBe('antigo');
    });

    it('limita o número de envios', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({
          submissions: {
            entries: Array.from({ length: 10 }, (_, index) => ({
              id: `envio-${index}`,
              kind: 'text',
              note: 'x',
              assetId: null,
              url: null,
              submittedAt: new Date().toISOString(),
            })),
            milestones: [],
          },
        }),
      );

      await expect(
        service.addSubmission('student-user', 'assignment-1', {
          kind: 'text',
          note: 'mais um',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifica o professor no envio', async () => {
      await service.addSubmission('student-user', 'assignment-1', {
        kind: 'text',
        note: 'pronto',
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'teacher-user',
          type: 'STUDENT_SUBMITTED_ASSIGNMENT',
        }),
      );
    });

    it('remover envio apaga o arquivo', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({
          submissions: {
            entries: [
              {
                id: 'envio-1',
                kind: 'video',
                note: null,
                assetId: 'asset-1',
                url: 'https://exemplo/a.mp4',
                submittedAt: new Date().toISOString(),
              },
            ],
            milestones: [],
          },
        }),
      );

      await service.removeSubmission('student-user', 'assignment-1', 'envio-1');

      expect(storage.deleteAsset).toHaveBeenCalledWith('asset-1');
      expect(
        prisma.assignment.update.mock.calls[0][0].data.submissions.entries,
      ).toHaveLength(0);
    });

    it('recusa remover envio inexistente', async () => {
      await expect(
        service.removeSubmission('student-user', 'assignment-1', 'nao-existe'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------
  describe('conclusão', () => {
    // O legado deixava `status` e `isCompleted` divergirem, e telas diferentes
    // liam campos diferentes.
    it('grava conclusão, status e data juntos', async () => {
      await service.complete('student-user', 'assignment-1', {});

      const { data } = prisma.assignment.update.mock.calls[0][0];

      expect(data.isCompleted).toBe(true);
      expect(data.status).toBe(AssignmentStatus.COMPLETED);
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(data.progress).toBe(100);
    });

    it('recusa concluir duas vezes', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({ isCompleted: true }),
      );

      await expect(
        service.complete('student-user', 'assignment-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifica o professor', async () => {
      await service.complete('student-user', 'assignment-1', {});

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'teacher-user',
          type: 'STUDENT_COMPLETED_ASSIGNMENT',
        }),
      );
    });

    it('recusa envio depois de concluída', async () => {
      prisma.assignment.findUnique.mockResolvedValue(
        assignmentRow({ isCompleted: true }),
      );

      await expect(
        service.addSubmission('student-user', 'assignment-1', {
          kind: 'text',
          note: 'atrasado',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -----------------------------------------------------------------
  describe('feedback do professor', () => {
    it('grava e notifica o aluno', async () => {
      await service.giveFeedback('teacher-user', 'assignment-1', {
        feedback: 'Muito bom',
        rating: 5,
      });

      expect(prisma.assignment.update.mock.calls[0][0].data).toEqual({
        teacherFeedback: 'Muito bom',
        teacherRating: 5,
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'student-user',
          type: 'TEACHER_GAVE_FEEDBACK',
        }),
      );
    });

    // Vínculo encerrado não pode impedir o professor de fechar o que ficou
    // aberto — só de criar tarefa nova.
    it('não exige vínculo ativo', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue(null);

      await expect(
        service.giveFeedback('teacher-user', 'assignment-1', {
          feedback: 'ok',
        }),
      ).resolves.toBeDefined();
    });

    it('o aluno não dá feedback de professor', async () => {
      await expect(
        service.giveFeedback('student-user', 'assignment-1', {
          feedback: 'me dou 5',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------
  describe('listagem', () => {
    it('recorta pelo professor quando há perfil', async () => {
      await service.list('teacher-user', {});

      expect(prisma.assignment.findMany.mock.calls[0][0].where.lesson).toEqual({
        is: { teacherId: 'teacher-1' },
      });
    });

    it('recorta pelo aluno quando pedido', async () => {
      await service.list('student-user', { as: 'student' });

      expect(prisma.assignment.findMany.mock.calls[0][0].where.studentId).toBe(
        'student-1',
      );
    });

    // Deixar o aluno filtrar por `studentId` sobrescreveria o recorte dele.
    it('ignora filtro de aluno vindo do próprio aluno', async () => {
      await service.list('student-user', {
        as: 'student',
        studentId: 'outro-aluno',
      });

      expect(prisma.assignment.findMany.mock.calls[0][0].where.studentId).toBe(
        'student-1',
      );
    });

    it('traduz OVERDUE em prazo vencido sem conclusão', async () => {
      await service.list('teacher-user', { status: 'OVERDUE' });

      const { where } = prisma.assignment.findMany.mock.calls[0][0];

      expect(where.isCompleted).toBe(false);
      expect(where.dueDate.lt).toBeInstanceOf(Date);
      // No MongoDB `null` ordena antes de qualquer data: sem isto, tarefa sem
      // prazo entrava como atrasada.
      expect(where.dueDate.not).toBeNull();
    });

    it('não conta tarefa sem prazo entre as atrasadas', async () => {
      await service.list('teacher-user', {});

      // Contagens: a da consulta, depois total, pendentes, em andamento,
      // concluídas e atrasadas.
      const overdueCall = prisma.assignment.count.mock.calls[5][0];

      expect(overdueCall.where.dueDate).toEqual({
        lt: expect.any(Date),
        not: null,
      });
    });

    // No legado as estatísticas saíam de `.filter()` sobre a página atual, e a
    // partir do registro 51 os números do painel paravam de bater.
    it('calcula estatísticas no conjunto todo, não na página', async () => {
      prisma.assignment.count.mockResolvedValue(7);

      const result = await service.list('teacher-user', { limit: 1 });

      expect(result.stats.total).toBe(7);
      expect(prisma.assignment.count).toHaveBeenCalledTimes(6);
    });

    it('estatísticas ignoram o filtro de status aberto', async () => {
      await service.list('teacher-user', { status: 'COMPLETED' });

      // A primeira contagem é a da própria consulta filtrada; a do total do
      // conjunto não carrega `isCompleted`.
      const totalCall = prisma.assignment.count.mock.calls[1][0];

      expect(totalCall.where).not.toHaveProperty('isCompleted');
    });

    it('deriva atraso na projeção', async () => {
      prisma.assignment.findMany.mockResolvedValue([
        assignmentRow({ dueDate: past(2), isCompleted: false }),
      ]);

      const result = await service.list('teacher-user', {});

      expect(result.assignments[0].isOverdue).toBe(true);
      expect(result.assignments[0].effectiveStatus).toBe('OVERDUE');
    });

    it('não marca atraso em tarefa concluída', async () => {
      prisma.assignment.findMany.mockResolvedValue([
        assignmentRow({ dueDate: past(2), isCompleted: true }),
      ]);

      const result = await service.list('teacher-user', {});

      expect(result.assignments[0].isOverdue).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  describe('detalhe', () => {
    it('devolve permissões pelo papel de quem chama', async () => {
      const asTeacher = await service.findOne('teacher-user', 'assignment-1');
      const asStudent = await service.findOne('student-user', 'assignment-1');

      expect(asTeacher.permissions).toEqual({
        canEdit: true,
        canDelete: true,
        canGiveFeedback: true,
        canSubmit: false,
        canComplete: false,
      });

      // No legado `canAddFeedback` era verdadeiro para o **aluno**.
      expect(asStudent.permissions).toEqual({
        canEdit: false,
        canDelete: false,
        canGiveFeedback: false,
        canSubmit: true,
        canComplete: true,
      });
    });

    it('não busca partituras quando não há nenhuma', async () => {
      await service.findOne('teacher-user', 'assignment-1');

      expect(prisma.workScore.findMany).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('remoção', () => {
    // Apagar o registro antes deixaria o vídeo no armazenamento sem nada que
    // o referenciasse.
    it('apaga os arquivos antes do registro', async () => {
      await service.remove('teacher-user', 'assignment-1');

      const assetOrder = storage.deleteByEntity.mock.invocationCallOrder[0];
      const deleteOrder = prisma.assignment.delete.mock.invocationCallOrder[0];

      expect(assetOrder).toBeLessThan(deleteOrder);
      expect(storage.deleteByEntity).toHaveBeenCalledWith(
        'assignment',
        'assignment-1',
      );
    });

    it('falha na limpeza não impede a remoção', async () => {
      storage.deleteByEntity.mockRejectedValue(new Error('cloudinary fora'));

      await expect(
        service.remove('teacher-user', 'assignment-1'),
      ).resolves.toBeUndefined();
      expect(prisma.assignment.delete).toHaveBeenCalled();
    });
  });
});
