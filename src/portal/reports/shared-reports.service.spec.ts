import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProgressReportService } from './progress-report.service';
import { SharedReportsService } from './shared-reports.service';

const futuro = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const passado = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

describe('SharedReportsService', () => {
  let service: SharedReportsService;
  let prisma: {
    sharedProgressReport: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    sharedReportComment: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    teacher: { findUnique: jest.Mock };
    student: { findUnique: jest.Mock };
  };
  let reports: { generate: jest.Mock };
  let notifications: { notify: jest.Mock };

  const shared = (over: Record<string, unknown> = {}) => ({
    id: 'report-1',
    title: 'Primeiro semestre',
    isActive: true,
    expiresAt: null,
    allowComments: true,
    teacher: {
      id: 'teacher-1',
      userId: 'teacher-user',
      user: { firstName: 'Ana', lastName: 'Costa', image: null },
    },
    student: {
      id: 'student-1',
      userId: 'student-user',
      user: { firstName: 'João', lastName: 'Silva', image: null },
    },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      sharedProgressReport: {
        create: jest.fn().mockResolvedValue(shared()),
        findUnique: jest.fn().mockResolvedValue(shared()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(shared()),
      },
      sharedReportComment: {
        create: jest.fn().mockResolvedValue({ id: 'comment-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      teacher: { findUnique: jest.fn().mockResolvedValue({ id: 'teacher-1' }) },
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }) },
    };

    reports = {
      generate: jest.fn().mockResolvedValue({
        student: {
          id: 'student-1',
          userId: 'student-user',
          name: 'João Silva',
        },
        teacher: { id: 'teacher-1', userId: 'teacher-user', name: 'Ana Costa' },
        period: {
          start: new Date('2026-01-01T00:00:00.000Z'),
          end: new Date('2026-06-30T00:00:00.000Z'),
          label: 'custom',
        },
        sections: ['overview'],
        report: { overview: { totalLessons: 12 } },
      }),
    };

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProgressReportService, useValue: reports },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(SharedReportsService);
  });

  const shareDto = { studentId: 'student-1', title: 'Primeiro semestre' };

  // -----------------------------------------------------------------
  describe('compartilhar', () => {
    // No legado o `reportData` vinha pronto no corpo e era gravado sem
    // validação: quem chamasse a rota escolhia os números que o aluno leria.
    it('gera o conteúdo no servidor, não aceita do cliente', async () => {
      await service.share('teacher-user', shareDto);

      expect(reports.generate).toHaveBeenCalledWith(
        'teacher-user',
        'student-1',
        expect.any(Object),
      );

      expect(
        prisma.sharedProgressReport.create.mock.calls[0][0].data.reportData,
      ).toEqual({ overview: { totalLessons: 12 } });
    });

    it('usa o período que a geração resolveu', async () => {
      await service.share('teacher-user', shareDto);

      const { data } = prisma.sharedProgressReport.create.mock.calls[0][0];

      expect(data.periodStart).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(data.periodLabel).toBe('custom');
    });

    // O relatório traz presença, engajamento e observações sobre uma pessoa.
    it('nunca nasce público', async () => {
      await service.share('teacher-user', shareDto);

      expect(
        prisma.sharedProgressReport.create.mock.calls[0][0].data.isPublic,
      ).toBe(false);
    });

    it('herda a autorização da geração', async () => {
      reports.generate.mockRejectedValue(
        new ForbiddenException('Este aluno não está vinculado a você'),
      );

      await expect(service.share('teacher-user', shareDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.sharedProgressReport.create).not.toHaveBeenCalled();
    });

    it('avisa o aluno', async () => {
      await service.share('teacher-user', shareDto);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'student-user' }),
      );
    });

    it('comentários vêm desligados por padrão', async () => {
      await service.share('teacher-user', shareDto);

      expect(
        prisma.sharedProgressReport.create.mock.calls[0][0].data.allowComments,
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  describe('abrir', () => {
    // No legado só o aluno podia abrir: quem compartilhou não revia o que
    // tinha enviado.
    it('o professor autor também abre', async () => {
      const result = await service.findOne('teacher-user', 'report-1');

      expect(result.viewerRole).toBe('teacher');
    });

    it('a visualização só conta para o aluno', async () => {
      await service.findOne('teacher-user', 'report-1');
      expect(prisma.sharedProgressReport.update).not.toHaveBeenCalled();

      await service.findOne('student-user', 'report-1');
      expect(
        prisma.sharedProgressReport.update.mock.calls[0][0].data.viewCount,
      ).toEqual({ increment: 1 });
    });

    it('terceiro não abre', async () => {
      await expect(service.findOne('estranho', 'report-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('relatório revogado responde 410 ao aluno', async () => {
      prisma.sharedProgressReport.findUnique.mockResolvedValue(
        shared({ isActive: false }),
      );

      await expect(service.findOne('student-user', 'report-1')).rejects.toThrow(
        GoneException,
      );
    });

    it('relatório expirado responde 410 ao aluno', async () => {
      prisma.sharedProgressReport.findUnique.mockResolvedValue(
        shared({ expiresAt: passado() }),
      );

      await expect(service.findOne('student-user', 'report-1')).rejects.toThrow(
        GoneException,
      );
    });

    // O professor administra os próprios compartilhamentos, então precisa
    // enxergar o que revogou.
    it('o professor abre mesmo revogado', async () => {
      prisma.sharedProgressReport.findUnique.mockResolvedValue(
        shared({ isActive: false }),
      );

      await expect(
        service.findOne('teacher-user', 'report-1'),
      ).resolves.toBeDefined();
    });

    it('dentro da validade abre normalmente', async () => {
      prisma.sharedProgressReport.findUnique.mockResolvedValue(
        shared({ expiresAt: futuro() }),
      );

      await expect(
        service.findOne('student-user', 'report-1'),
      ).resolves.toBeDefined();
    });
  });

  // -----------------------------------------------------------------
  describe('listar', () => {
    it('o aluno vê só ativo e dentro da validade', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await service.list('student-user', { as: 'student' });

      const { where } = prisma.sharedProgressReport.findMany.mock.calls[0][0];

      expect(where.isActive).toBe(true);
      expect(where.OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gte: expect.any(Date) } },
      ]);
    });

    it('o professor vê tudo o que criou', async () => {
      await service.list('teacher-user', {});

      const { where } = prisma.sharedProgressReport.findMany.mock.calls[0][0];

      expect(where.teacherId).toBe('teacher-1');
      expect(where.isActive).toBeUndefined();
    });

    it('o filtro de aluno só vale para o professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await service.list('student-user', {
        as: 'student',
        studentId: 'outro-aluno',
      });

      const { where } = prisma.sharedProgressReport.findMany.mock.calls[0][0];

      expect(where.studentId).toBe('student-1');
    });
  });

  // -----------------------------------------------------------------
  describe('revogar', () => {
    // Desativar em vez de apagar mantém o histórico do que foi enviado.
    it('desativa sem apagar', async () => {
      await service.revoke('teacher-user', 'report-1');

      expect(prisma.sharedProgressReport.update.mock.calls[0][0].data).toEqual({
        isActive: false,
      });
    });

    it('só o autor revoga', async () => {
      await expect(service.revoke('student-user', 'report-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('comentários', () => {
    it('só o aluno dono comenta', async () => {
      await expect(
        service.addComment('teacher-user', 'report-1', { content: 'oi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('respeita o professor ter fechado os comentários', async () => {
      prisma.sharedProgressReport.findUnique.mockResolvedValue(
        shared({ allowComments: false }),
      );

      await expect(
        service.addComment('student-user', 'report-1', { content: 'oi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('não comenta relatório revogado', async () => {
      prisma.sharedProgressReport.findUnique.mockResolvedValue(
        shared({ isActive: false }),
      );

      await expect(
        service.addComment('student-user', 'report-1', { content: 'oi' }),
      ).rejects.toThrow(GoneException);
    });

    // No legado o comentário era gravado e ninguém era avisado.
    it('avisa o professor', async () => {
      await service.addComment('student-user', 'report-1', { content: 'oi' });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'teacher-user' }),
      );
    });

    it('abrir como professor marca os comentários como lidos', async () => {
      await service.listComments('teacher-user', 'report-1');

      expect(prisma.sharedReportComment.updateMany).toHaveBeenCalledWith({
        where: { reportId: 'report-1', isRead: false },
        data: { isRead: true },
      });
    });

    it('abrir como aluno não marca nada', async () => {
      await service.listComments('student-user', 'report-1');

      expect(prisma.sharedReportComment.updateMany).not.toHaveBeenCalled();
    });

    // O legado carregava todos de uma vez, cada um com o `User` inteiro do
    // aluno — hash de senha incluído — só para comparar um id.
    it('a listagem é paginada', async () => {
      await service.listComments('student-user', 'report-1', 2);

      const call = prisma.sharedReportComment.findMany.mock.calls[0][0];

      expect(call.take).toBe(50);
      expect(call.skip).toBe(50);
    });
  });
});
