import {
  DifficultyLevel,
  LessonStatus,
  Prisma,
  SchoolActivityAction,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { PortalProfileService } from './profile.service';

describe('PortalProfileService', () => {
  let service: PortalProfileService;
  let activities: { record: jest.Mock };
  let prisma: {
    student: { findUnique: jest.Mock; create: jest.Mock };
    teacher: { findUnique: jest.Mock; create: jest.Mock };
    teacherStudent: { findMany: jest.Mock };
    lesson: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }),
        create: jest.fn().mockResolvedValue({ id: 'student-1' }),
      },
      teacher: {
        findUnique: jest.fn().mockResolvedValue({ id: 'teacher-1' }),
        create: jest.fn().mockResolvedValue({ id: 'teacher-1' }),
      },
      teacherStudent: { findMany: jest.fn().mockResolvedValue([]) },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
    };
    // A trilha escolar é efeito colateral: o dublê só registra a chamada.
    activities = { record: jest.fn().mockResolvedValue(undefined) };
    service = new PortalProfileService(
      prisma as unknown as PrismaService,
      activities as unknown as SchoolActivitiesService,
    );
  });

  // -----------------------------------------------------------------
  describe('seções', () => {
    it('professor: perfil, se é novo e os alunos', async () => {
      await expect(service.teacherSection('user-1')).resolves.toEqual({
        profile: { id: 'teacher-1' },
        isNew: false,
        students: [],
      });
    });

    it('aluno: perfil, se é novo e os professores', async () => {
      await expect(service.studentSection('user-1')).resolves.toEqual({
        profile: { id: 'student-1' },
        isNew: false,
        teachers: [],
      });
    });

    it('alunos do professor, com a próxima aula de cada um', async () => {
      prisma.teacherStudent.findMany.mockResolvedValue([
        {
          id: 'rel-1',
          isActive: true,
          inviteStatus: 'ACCEPTED',
          startDate: new Date('2026-01-10T00:00:00.000Z'),
          endDate: null,
          maxLessonsPerWeek: 2,
          lessonDuration: 60,
          totalLessons: 3,
          student: {
            id: 'student-9',
            userId: 'aluno-user',
            level: 'BEGINNER',
            mainInstrument: 'Piano',
            user: { firstName: 'Bia', lastName: null, image: null },
          },
        },
      ]);
      prisma.lesson.findMany.mockResolvedValue([
        {
          teacherId: 'teacher-1',
          studentId: 'student-9',
          scheduledAt: new Date('2026-10-01T19:00:00.000Z'),
        },
      ]);

      const { students } = await service.teacherSection('user-1');

      expect(students[0]).toMatchObject({
        studentId: 'student-9',
        name: 'Bia',
        mainInstrument: 'Piano',
        nextLessonAt: new Date('2026-10-01T19:00:00.000Z'),
      });
    });
  });

  // -----------------------------------------------------------------
  describe('provisionamento', () => {
    it('cria o perfil do aluno na primeira visita', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      const result = await service.studentSection('user-1');

      expect(prisma.student.create).toHaveBeenCalled();
      expect(result.isNew).toBe(true);
    });

    it('não recria quando já existe', async () => {
      const result = await service.studentSection('user-1');

      expect(prisma.student.create).not.toHaveBeenCalled();
      expect(result.isNew).toBe(false);
    });

    it('o professor nasce pendente e não verificado', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await service.ensureTeacher('user-1');

      expect(prisma.teacher.create.mock.calls[0][0].data).toEqual({
        userId: 'user-1',
        status: 'PENDING',
        isVerified: false,
      });
    });

    // Duas requisições simultâneas — o que acontece sempre que a tela dispara
    // duas chamadas ao montar — batiam no índice único e a segunda dava 500.
    it('relê o perfil quando perde a corrida de criação', async () => {
      prisma.student.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'student-1' });
      prisma.student.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '6.19.0',
        }),
      );

      const result = await service.studentSection('user-1');

      expect(result.isNew).toBe(false);
      expect(result.profile).toEqual({ id: 'student-1' });
    });

    it('também para o professor', async () => {
      prisma.teacher.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'teacher-1' });
      prisma.teacher.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '6.19.0',
        }),
      );

      await expect(service.ensureTeacher('user-1')).resolves.toEqual({
        profile: { id: 'teacher-1' },
        created: false,
      });
    });

    it('erro que não é de corrida sobe', async () => {
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.student.create.mockRejectedValue(new Error('banco fora'));

      await expect(service.studentSection('user-1')).rejects.toThrow(
        'banco fora',
      );
    });

    it('corrida sem registro para reler sobe o erro original', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);
      prisma.teacher.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '6.19.0',
        }),
      );

      await expect(service.ensureTeacher('user-1')).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('conversão', () => {
    // O `PATCH { field, value }` do legado gravava qualquer campo do modelo.
    it('não deixa o aluno tocar nos próprios contadores', () => {
      const data = service.studentData({
        level: DifficultyLevel.ADVANCED,
        currentStreak: 99,
        totalLessonsAttended: 99,
        userId: 'outra-conta',
      } as never);

      expect(data.level).toBe(DifficultyLevel.ADVANCED);
      expect(data).not.toHaveProperty('currentStreak');
      expect(data).not.toHaveProperty('totalLessonsAttended');
      expect(data).not.toHaveProperty('userId');
    });

    // O diretório público filtra por `isVerified` e ordena por `averageRating`.
    it('não deixa o professor se verificar nem se avaliar', () => {
      const data = service.teacherData({
        bio: 'Professor de piano',
        isVerified: true,
        averageRating: 5,
        status: 'APPROVED',
      } as never);

      expect(data.bio).toBe('Professor de piano');
      expect(data).not.toHaveProperty('isVerified');
      expect(data).not.toHaveProperty('averageRating');
      expect(data).not.toHaveProperty('status');
    });

    it('texto em branco vira nulo; ausente fica de fora', () => {
      const student = service.studentData({ mainInstrument: '   ' });
      expect(student.mainInstrument).toBeNull();
      expect(student.musicalGoals).toBeUndefined();

      const teacher = service.teacherData({
        website: '',
        socialMedia: { instagram: '@a' },
      });
      expect(teacher.website).toBeNull();
      expect(teacher.socialMedia).toEqual({ instagram: '@a' });
    });
  });

  // -----------------------------------------------------------------
  describe('trilha escolar', () => {
    it('registra só os nomes dos campos, com a ação e o papel do bloco alterado', async () => {
      await service.recordProfileChange(
        'user-1',
        { isTeacher: true, isStudent: false },
        { professor: ['bio'] },
      );
      expect(activities.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          userType: 'teacher',
          action: SchoolActivityAction.TEACHER_PROFILE_UPDATED,
          changes: { professor: ['bio'] },
        }),
      );

      await service.recordProfileChange(
        'user-1',
        { isTeacher: true, isStudent: true },
        { aluno: ['level'] },
      );
      expect(activities.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          userType: 'student',
          action: SchoolActivityAction.STUDENT_PROFILE_UPDATED,
        }),
      );

      await service.recordProfileChange(
        'user-1',
        { isTeacher: false, isStudent: true },
        { conta: ['city'] },
      );
      expect(activities.record).toHaveBeenLastCalledWith(
        expect.objectContaining({
          userType: 'student',
          action: SchoolActivityAction.USER_PROFILE_UPDATED,
        }),
      );
    });

    it('conta sem papel no portal não entra na trilha escolar', async () => {
      await service.recordProfileChange(
        'user-1',
        { isTeacher: false, isStudent: false },
        { conta: ['city'] },
      );

      expect(activities.record).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('vínculos do aluno', () => {
    beforeEach(() => {
      prisma.teacherStudent.findMany.mockResolvedValue([
        {
          id: 'rel-1',
          isActive: true,
          inviteStatus: 'ACCEPTED',
          startDate: new Date('2026-01-10T00:00:00.000Z'),
          endDate: null,
          maxLessonsPerWeek: 2,
          lessonDuration: 60,
          totalLessons: 9,
          teacher: {
            id: 'teacher-1',
            userId: 'teacher-user',
            specialties: ['Piano'],
            instruments: ['Piano'],
            isVerified: true,
            user: { firstName: 'Ana', lastName: 'Costa', image: null },
          },
        },
      ]);
    });

    // O legado disparava duas consultas por professor dentro de um `map`.
    it('resolve a próxima aula de todos numa consulta só', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        {
          teacherId: 'teacher-1',
          studentId: 'student-1',
          scheduledAt: new Date('2026-10-01T19:00:00.000Z'),
        },
        {
          teacherId: 'teacher-1',
          studentId: 'student-1',
          scheduledAt: new Date('2026-10-08T19:00:00.000Z'),
        },
      ]);

      const { teachers } = await service.studentSection('user-1');

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
      expect(teachers[0].nextLessonAt).toEqual(
        new Date('2026-10-01T19:00:00.000Z'),
      );
      expect(teachers[0].name).toBe('Ana Costa');
    });

    it('usa o contador já mantido no vínculo', async () => {
      const { teachers } = await service.studentSection('user-1');

      expect(teachers[0].totalLessons).toBe(9);
    });

    it('vínculo sem aula marcada vem com próxima nula', async () => {
      const { teachers } = await service.studentSection('user-1');

      expect(teachers[0].nextLessonAt).toBeNull();
    });

    it('só busca aula agendada no futuro', async () => {
      await service.studentSection('user-1');

      const { where } = prisma.lesson.findMany.mock.calls[0][0];

      expect(where.status).toBe(LessonStatus.SCHEDULED);
      expect(where.scheduledAt.gte).toBeInstanceOf(Date);
    });

    it('não consulta aula quando não há vínculo', async () => {
      prisma.teacherStudent.findMany.mockResolvedValue([]);

      await service.studentSection('user-1');

      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    });
  });
});
