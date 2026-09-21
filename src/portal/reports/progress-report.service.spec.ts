import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DifficultyLevel, StudentInviteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PeerComparisonService } from './peer-comparison.service';
import { ProgressReportService } from './progress-report.service';
import { ReportSectionsService } from './report-sections.service';

describe('ProgressReportService', () => {
  let service: ProgressReportService;
  let prisma: {
    teacher: { findUnique: jest.Mock };
    student: { findUnique: jest.Mock };
    teacherStudent: { findFirst: jest.Mock };
    lesson: { findMany: jest.Mock };
    assignment: { findMany: jest.Mock };
    learned: { findMany: jest.Mock };
    wantToLearn: { findMany: jest.Mock; groupBy: jest.Mock };
    work: { findMany: jest.Mock };
  };
  let peers: { compare: jest.Mock };

  beforeEach(async () => {
    prisma = {
      teacher: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'teacher-1',
          userId: 'teacher-user',
          user: { firstName: 'Ana', lastName: 'Costa' },
        }),
      },
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          userId: 'student-user',
          level: DifficultyLevel.INTERMEDIATE,
          user: { firstName: 'João', lastName: 'Silva', image: null },
        }),
      },
      teacherStudent: {
        findFirst: jest.fn().mockResolvedValue({
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          isActive: true,
        }),
      },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
      learned: { findMany: jest.fn().mockResolvedValue([]) },
      wantToLearn: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      work: { findMany: jest.fn().mockResolvedValue([]) },
    };

    peers = {
      compare: jest.fn().mockResolvedValue({
        available: false,
        reason: 'cohort_too_small',
        cohortSize: 1,
        minimumCohort: 5,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressReportService,
        ReportSectionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeerComparisonService, useValue: peers },
      ],
    }).compile();

    service = module.get(ProgressReportService);
  });

  // -----------------------------------------------------------------
  describe('autorização', () => {
    // O legado trazia `isActive` no `select` e nunca o conferia: bastava a
    // linha do vínculo existir. Professor com convite recusado ou vínculo
    // encerrado continuava puxando presença, engajamento e anotações do aluno.
    it('exige vínculo ativo e aceito', async () => {
      await service.generate('teacher-user', 'student-1', {});

      expect(prisma.teacherStudent.findFirst.mock.calls[0][0].where).toEqual({
        teacherId: 'teacher-1',
        studentId: 'student-1',
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      });
    });

    it('recusa quando não há vínculo válido', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue(null);

      await expect(
        service.generate('teacher-user', 'student-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('exige perfil de professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(
        service.generate('teacher-user', 'student-1', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('aluno inexistente responde 404', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(
        service.generate('teacher-user', 'student-1', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -----------------------------------------------------------------
  describe('geração', () => {
    it('gera todas as seções por padrão', async () => {
      const result = await service.generate('teacher-user', 'student-1', {});

      expect(result.sections).toContain('overview');
      expect(result.sections).toContain('recommendations');
      expect(result.report).toHaveProperty('attendance');
      expect(result.report).toHaveProperty('repertoire');
    });

    it('gera só o que foi pedido', async () => {
      const result = await service.generate('teacher-user', 'student-1', {
        sections: ['overview', 'attendance'],
      });

      expect(result.report).toHaveProperty('overview');
      expect(result.report).toHaveProperty('attendance');
      expect(result.report).not.toHaveProperty('repertoire');
      expect(result.report).not.toHaveProperty('engagement');
    });

    // O legado repetia as mesmas consultas dentro de cada gerador de seção.
    it('carrega as aulas uma vez por período', async () => {
      await service.generate('teacher-user', 'student-1', {
        sections: ['overview', 'attendance', 'evolution', 'engagement'],
      });

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
    });

    it('a comparação carrega também o período anterior', async () => {
      await service.generate('teacher-user', 'student-1', {
        sections: ['comparison'],
      });

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(2);
      expect(peers.compare).toHaveBeenCalled();
    });

    // O legado truncava em 500 aulas e apresentava as estatísticas como se
    // cobrissem o período inteiro.
    it('avisa quando a carga foi truncada', async () => {
      prisma.lesson.findMany.mockResolvedValue(
        Array.from({ length: 500 }, () => ({
          id: 'l',
          status: 'COMPLETED',
          scheduledAt: new Date(),
          duration: 60,
          engagement: null,
          preparation: null,
          punctuality: null,
          topics: [],
          techniques: [],
          challenges: [],
          improvements: [],
          skillsWorked: [],
          studentPresent: true,
        })),
      );

      const result = await service.generate('teacher-user', 'student-1', {
        sections: ['overview'],
      });

      expect(result.coverage.truncated.lessons).toBe(true);
      expect(result.coverage.lessons).toBe(500);
    });

    it('não trunca quando cabe', async () => {
      const result = await service.generate('teacher-user', 'student-1', {
        sections: ['overview'],
      });

      expect(result.coverage.truncated.lessons).toBe(false);
    });

    it('o período pedido chega na consulta', async () => {
      await service.generate('teacher-user', 'student-1', {
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-03-01T00:00:00.000Z',
        sections: ['overview'],
      });

      const { where } = prisma.lesson.findMany.mock.calls[0][0];

      expect(where.scheduledAt.gte).toEqual(
        new Date('2026-02-01T00:00:00.000Z'),
      );
      expect(where.teacherId).toBe('teacher-1');
      expect(where.studentId).toBe('student-1');
    });
  });

  // -----------------------------------------------------------------
  describe('recomendações', () => {
    // No legado, `studentAppeal` era `Math.round(Math.random() * 30 + 70)`.
    it('a procura vem da contagem real de quem quer aprender', async () => {
      prisma.wantToLearn.groupBy.mockResolvedValue([
        { workId: 'work-1', _count: { _all: 42 } },
      ]);
      prisma.work.findMany.mockResolvedValue([
        {
          id: 'work-1',
          title: 'Nocturne op. 9 nº 2',
          composer: { id: 'c1', name: 'Chopin' },
        },
      ]);

      const result = await service.generate('teacher-user', 'student-1', {
        sections: ['recommendations'],
      });

      const recomendacoes = result.report.recommendations as {
        pieces: Array<{ studentAppeal: number }>;
      };

      expect(recomendacoes.pieces[0].studentAppeal).toBe(42);
    });

    it('não recomenda o que o aluno já aprendeu', async () => {
      prisma.learned.findMany.mockResolvedValue([
        {
          learnedAt: new Date(),
          mastery: 90,
          wouldRecommend: true,
          work: {
            id: 'work-1',
            title: 'Sonata',
            difficultyLevel: '5',
            composer: { name: 'Beethoven' },
          },
        },
      ]);

      await service.generate('teacher-user', 'student-1', {
        sections: ['recommendations'],
      });

      const { where } = prisma.wantToLearn.groupBy.mock.calls[0][0];

      expect(where.workId.notIn).toContain('work-1');
    });
  });
});
