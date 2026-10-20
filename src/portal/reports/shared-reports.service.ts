import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationPriority,
  NotificationType,
  Prisma,
  ReportVisibility,
  SchoolActivityAction,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toJsonInput } from '../../common/utils/json.util';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import {
  CreateReportCommentDto,
  ListSharedReportsQueryDto,
  ShareReportDto,
  UpdateSharedReportDto,
} from './dto/share-report.dto';
import { ProgressReportService } from './progress-report.service';

const MAX_COMMENTS_PAGE = 50;

const SHARED_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  periodStart: true,
  periodEnd: true,
  periodLabel: true,
  selectedSections: true,
  allowComments: true,
  visibility: true,
  sharedAt: true,
  isActive: true,
  viewCount: true,
  lastViewedAt: true,
  expiresAt: true,
  createdAt: true,
  teacher: {
    select: {
      id: true,
      userId: true,
      user: { select: { firstName: true, lastName: true, image: true } },
    },
  },
  student: {
    select: {
      id: true,
      userId: true,
      user: { select: { firstName: true, lastName: true, image: true } },
    },
  },
} as const;

@Injectable()
export class SharedReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ProgressReportService,
    private readonly notifications: NotificationsService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  /**
   * Compartilha um relatório com o aluno.
   *
   * **O conteúdo é gerado aqui, não recebido.** O legado gravava o
   * `reportData` que o cliente mandava no corpo — sem validação e sem conferir
   * contra o banco —, de modo que quem chamasse a rota escolhia os números que
   * o aluno leria num documento formal sobre o próprio aprendizado. Gerar no
   * servidor elimina a questão: o relatório compartilhado é, por construção, o
   * mesmo que a geração produz.
   *
   * A autorização é a de `ProgressReportService.generate`, que exige vínculo
   * ativo e aceito — o legado aqui só conferia que a linha do vínculo existia.
   */
  async share(teacherUserId: string, dto: ShareReportDto) {
    const generated = await this.reports.generate(
      teacherUserId,
      dto.studentId,
      {
        period: dto.period,
        from: dto.from,
        to: dto.to,
        sections: dto.sections,
      },
    );

    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const visibility = dto.visibility ?? ReportVisibility.SHARED;
    const shared = await this.prisma.sharedProgressReport.create({
      data: {
        teacherId: generated.teacher.id,
        studentId: generated.student.id,
        title: dto.title,
        description: dto.description,
        teacherMessage: dto.teacherMessage,
        periodStart: generated.period.start,
        periodEnd: generated.period.end,
        periodLabel: generated.period.label,
        selectedSections: generated.sections,
        reportData: toJsonInput(
          generated.report as Record<string, unknown>,
        ) as Prisma.InputJsonValue,
        allowComments: dto.allowComments ?? false,
        // Nunca público: o relatório traz presença, engajamento e observações
        // sobre uma pessoa, muitas vezes menor de idade.
        isPublic: false,
        isActive: true,
        visibility,
        sharedAt: visibility === ReportVisibility.SHARED ? new Date() : null,
        expiresAt,
      },
      select: SHARED_LIST_SELECT,
    });

    // Relatório só do professor é acompanhamento: o aluno não é avisado.
    if (visibility === ReportVisibility.SHARED) {
      await this.notifyShared(
        generated.student.userId,
        generated.teacher.name,
        dto.title,
        shared.id,
      );
    }

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.REPORT_SHARED,
      entityType: 'report',
      entityId: shared.id,
      entityName: dto.title,
      title:
        visibility === ReportVisibility.SHARED
          ? `Compartilhou um relatório com ${generated.student.name}`
          : `Gerou um relatório de ${generated.student.name} só para você`,
    });

    return shared;
  }

  /**
   * Compartilha com o aluno um relatório que era só do professor (04/10/2026).
   * O conteúdo não muda — é o mesmo retrato do período, gerado no servidor.
   */
  async publish(teacherUserId: string, reportId: string) {
    const report = await this.prisma.sharedProgressReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        title: true,
        visibility: true,
        teacher: {
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        student: { select: { userId: true } },
      },
    });
    if (!report || report.teacher.userId !== teacherUserId) {
      throw new NotFoundException('Relatório não encontrado');
    }
    if (report.visibility === ReportVisibility.SHARED) {
      return this.prisma.sharedProgressReport.findUniqueOrThrow({
        where: { id: reportId },
        select: SHARED_LIST_SELECT,
      });
    }

    const updated = await this.prisma.sharedProgressReport.update({
      where: { id: reportId },
      data: {
        visibility: ReportVisibility.SHARED,
        sharedAt: new Date(),
        isActive: true,
      },
      select: SHARED_LIST_SELECT,
    });
    const name = [report.teacher.user.firstName, report.teacher.user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    await this.notifyShared(
      report.student.userId,
      name || 'Seu professor',
      report.title,
      reportId,
    );
    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.REPORT_SHARED,
      entityType: 'report',
      entityId: reportId,
      entityName: report.title,
      title: 'Compartilhou um relatório que era só seu',
    });
    return updated;
  }

  private notifyShared(
    studentUserId: string,
    teacherName: string,
    title: string,
    reportId: string,
  ) {
    return this.notifications.notify({
      userId: studentUserId,
      type: NotificationType.PROGRESS_REPORT_SHARED,
      priority: NotificationPriority.HIGH,
      title: 'Novo relatório de progresso',
      message: `${teacherName} compartilhou "${title}" com você.`,
      actionText: 'Ver relatório',
      actionUrl: `/student/progress/${reportId}`,
      relatedEntityType: 'sharedProgressReport',
      relatedEntityId: reportId,
    });
  }

  /** Relatórios compartilhados de quem chamou, nos dois papéis. */
  async list(userId: string, query: ListSharedReportsQueryDto) {
    const scope = await this.resolveScope(userId, query.as);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.SharedProgressReportWhereInput = {
      ...scope.where,
      ...(query.studentId && scope.role === 'teacher'
        ? { studentId: query.studentId }
        : {}),
      ...(query.visibility && scope.role === 'teacher'
        ? { visibility: query.visibility }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
      // O aluno não vê o que foi desativado nem o que expirou; o professor vê,
      // porque é ele quem administra os próprios compartilhamentos.
      ...(scope.role === 'student'
        ? {
            isActive: true,
            // O que é só do professor nunca aparece para o aluno.
            visibility: ReportVisibility.SHARED,
            OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
          }
        : {}),
    };

    const [reports, total] = await Promise.all([
      this.prisma.sharedProgressReport.findMany({
        where,
        select: SHARED_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sharedProgressReport.count({ where }),
    ]);

    return {
      reports,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Abre um relatório compartilhado.
   *
   * **O professor autor também pode abrir.** No legado só o aluno podia: quem
   * compartilhou não conseguia rever o que tinha enviado.
   *
   * A contagem de visualizações só sobe para o aluno — o professor conferindo o
   * próprio relatório não é audiência.
   */
  async findOne(userId: string, reportId: string) {
    const report = await this.prisma.sharedProgressReport.findUnique({
      where: { id: reportId },
      select: { ...SHARED_LIST_SELECT, reportData: true, teacherMessage: true },
    });

    if (!report) {
      throw new NotFoundException('Relatório não encontrado');
    }

    const isStudent = report.student.userId === userId;
    const isTeacher = report.teacher.userId === userId;

    if (!isStudent && !isTeacher) {
      throw new NotFoundException('Relatório não encontrado');
    }

    if (isStudent) {
      // "Só professor" responde como inexistente: nem a existência vaza.
      if (report.visibility !== ReportVisibility.SHARED) {
        throw new NotFoundException('Relatório não encontrado');
      }
      this.assertAvailable(report);

      await this.prisma.sharedProgressReport.update({
        where: { id: reportId },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      });
    }

    return {
      ...report,
      viewerRole: isTeacher ? ('teacher' as const) : ('student' as const),
    };
  }

  async update(
    teacherUserId: string,
    reportId: string,
    dto: UpdateSharedReportDto,
  ) {
    const report = await this.requireAuthor(teacherUserId, reportId);

    return this.prisma.sharedProgressReport.update({
      where: { id: report.id },
      data: {
        title: dto.title,
        description: dto.description,
        teacherMessage: dto.teacherMessage,
        allowComments: dto.allowComments,
        isActive: dto.isActive,
      },
      select: SHARED_LIST_SELECT,
    });
  }

  /** Revoga o compartilhamento sem apagar o histórico. */
  async revoke(teacherUserId: string, reportId: string): Promise<void> {
    const report = await this.requireAuthor(teacherUserId, reportId);

    await this.prisma.sharedProgressReport.update({
      where: { id: report.id },
      data: { isActive: false },
    });
  }

  // -------------------------------------------------------------------
  // Comentários
  // -------------------------------------------------------------------

  /**
   * Comentários do relatório, paginados.
   *
   * O legado carregava todos de uma vez junto do relatório, cada um com o
   * `User` inteiro do aluno — incluindo o hash da senha — só para comparar um
   * id.
   */
  async listComments(userId: string, reportId: string, page = 1) {
    const report = await this.requireParticipant(userId, reportId);

    const [comments, total] = await Promise.all([
      this.prisma.sharedReportComment.findMany({
        where: { reportId: report.id },
        select: {
          id: true,
          content: true,
          section: true,
          isRead: true,
          createdAt: true,
          student: {
            select: {
              id: true,
              user: {
                select: { firstName: true, lastName: true, image: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * MAX_COMMENTS_PAGE,
        take: MAX_COMMENTS_PAGE,
      }),
      this.prisma.sharedReportComment.count({ where: { reportId: report.id } }),
    ]);

    // Abrir os comentários como professor marca os do aluno como lidos.
    if (report.teacher.userId === userId) {
      await this.prisma.sharedReportComment.updateMany({
        where: { reportId: report.id, isRead: false },
        data: { isRead: true },
      });
    }

    return { comments, total, page, pageSize: MAX_COMMENTS_PAGE };
  }

  async addComment(
    studentUserId: string,
    reportId: string,
    dto: CreateReportCommentDto,
  ) {
    const report = await this.prisma.sharedProgressReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        title: true,
        isActive: true,
        expiresAt: true,
        allowComments: true,
        student: { select: { id: true, userId: true } },
        teacher: {
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!report || report.student.userId !== studentUserId) {
      throw new NotFoundException('Relatório não encontrado');
    }

    this.assertAvailable(report);

    if (!report.allowComments) {
      throw new ForbiddenException(
        'Este relatório não está aberto para comentários',
      );
    }

    const comment = await this.prisma.sharedReportComment.create({
      data: {
        reportId: report.id,
        studentId: report.student.id,
        content: dto.content.trim(),
        section: dto.section,
      },
      select: {
        id: true,
        content: true,
        section: true,
        isRead: true,
        createdAt: true,
      },
    });

    // O legado gravava o comentário e não avisava ninguém: o professor só
    // descobria se abrisse o relatório por conta própria.
    await this.notifications.notify({
      userId: report.teacher.userId,
      type: NotificationType.STUDENT_GAVE_LESSON_FEEDBACK,
      title: 'Comentário no relatório',
      message: `O aluno comentou o relatório "${report.title}".`,
      actionText: 'Ver comentário',
      actionUrl: `/teacher/reports/${report.id}`,
      relatedEntityType: 'sharedProgressReport',
      relatedEntityId: report.id,
    });

    await this.activities.record({
      userId: studentUserId,
      userType: 'student',
      action: SchoolActivityAction.REPORT_COMMENTED,
      entityType: 'report',
      entityId: report.id,
      entityName: report.title,
      title: `Comentou o relatório "${report.title}"`,
      description: dto.content.trim().slice(0, 200),
    });

    return comment;
  }

  // -------------------------------------------------------------------

  /** Ativo e dentro da validade. */
  private assertAvailable(report: {
    isActive: boolean;
    expiresAt: Date | null;
  }): void {
    if (!report.isActive) {
      throw new GoneException('Este relatório não está mais disponível');
    }

    if (report.expiresAt && report.expiresAt < new Date()) {
      throw new GoneException('Este relatório expirou');
    }
  }

  private async requireAuthor(teacherUserId: string, reportId: string) {
    const report = await this.prisma.sharedProgressReport.findUnique({
      where: { id: reportId },
      select: { id: true, teacher: { select: { userId: true } } },
    });

    if (!report || report.teacher.userId !== teacherUserId) {
      throw new NotFoundException('Relatório não encontrado');
    }

    return report;
  }

  private async requireParticipant(userId: string, reportId: string) {
    const report = await this.prisma.sharedProgressReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        visibility: true,
        teacher: { select: { userId: true } },
        student: { select: { userId: true } },
      },
    });

    if (
      !report ||
      (report.teacher.userId !== userId && report.student.userId !== userId) ||
      (report.student.userId === userId &&
        report.visibility !== ReportVisibility.SHARED)
    ) {
      throw new NotFoundException('Relatório não encontrado');
    }

    return report;
  }

  private async resolveScope(userId: string, as?: 'teacher' | 'student') {
    if (as !== 'student') {
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (teacher) {
        return {
          role: 'teacher' as const,
          where: { teacherId: teacher.id },
        };
      }

      if (as === 'teacher') {
        throw new ForbiddenException('Você não tem perfil de professor');
      }
    }

    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!student) {
      throw new ForbiddenException('Você não tem perfil de aluno');
    }

    return { role: 'student' as const, where: { studentId: student.id } };
  }
}
