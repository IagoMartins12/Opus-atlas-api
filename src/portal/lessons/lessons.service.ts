import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LessonStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
  RecurrenceType,
  SchoolActivityAction,
  StudentInviteStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import {
  CancelLessonDto,
  CompleteLessonDto,
  RescheduleLessonDto,
  StudentFeedbackDto,
  StudentLessonNoticeDto,
} from './dto/lesson-actions.dto';
import { ListLessonsQueryDto } from './dto/list-lessons-query.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import {
  LessonConflict,
  LessonSchedulingService,
} from './lesson-scheduling.service';

const LESSON_SELECT = {
  id: true,
  title: true,
  description: true,
  scheduledAt: true,
  duration: true,
  status: true,
  type: true,
  location: true,
  objectives: true,
  worksIds: true,
  workScoreIds: true,
  topics: true,
  techniques: true,
  repertoire: true,
  homework: true,
  practiceGoals: true,
  publicNotes: true,
  lessonSummary: true,
  studentFeedback: true,
  studentPresent: true,
  isRecurring: true,
  recurrenceType: true,
  parentLessonId: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
} as const;

/** Campos que só o professor enxerga. */
const TEACHER_ONLY_SELECT = {
  teacherNotes: true,
  engagement: true,
  preparation: true,
} as const;

/** O mínimo que a criação devolve por aula da série. */
export interface CreatedLesson {
  id: string;
  scheduledAt: Date;
  title: string;
}

const PARTICIPANTS_SELECT = {
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
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: LessonSchedulingService,
    private readonly notifications: NotificationsService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  // -------------------------------------------------------------------
  // Criação
  // -------------------------------------------------------------------

  /**
   * Agenda uma aula, ou uma série recorrente.
   *
   * A verificação de conflito cobre **todas** as ocorrências, não apenas a
   * primeira. No legado a série era criada depois de validar só a data inicial,
   * então uma recorrência semanal podia sobrepor silenciosamente as ocorrências
   * seguintes.
   */
  async create(teacherUserId: string, dto: CreateLessonDto) {
    const teacher = await this.requireTeacher(teacherUserId);
    const relationship = await this.requireActiveRelationship(
      teacher.id,
      dto.studentId,
    );

    const scheduledAt = new Date(dto.scheduledAt);
    const duration = dto.duration ?? relationship.lessonDuration ?? 60;

    if (scheduledAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Não é possível agendar uma aula no passado',
      );
    }

    const occurrences = this.resolveOccurrences(dto, scheduledAt);

    const conflictsByDate = await this.collectConflicts(
      teacher.id,
      dto.studentId,
      occurrences,
      duration,
    );

    if (conflictsByDate.length > 0 && !dto.force) {
      throw new ConflictException({
        message: 'Conflito de horário',
        conflicts: conflictsByDate,
        suggestions: await this.scheduling.suggestAlternatives({
          teacherId: teacher.id,
          studentId: dto.studentId,
          scheduledAt,
          duration,
        }),
      });
    }

    const lessons = await this.createOccurrences(
      teacher.id,
      dto,
      occurrences,
      duration,
    );

    await this.notifications.notify({
      userId: relationship.student.userId,
      type: NotificationType.NEW_LESSON_SCHEDULED,
      priority: NotificationPriority.MEDIUM,
      title: 'Nova aula agendada',
      message:
        occurrences.length > 1
          ? `${occurrences.length} aulas foram agendadas para você.`
          : `Sua aula "${dto.title}" foi agendada.`,
      actionText: 'Ver aula',
      actionUrl: `/student/lessons/${lessons[0].id}`,
      relatedEntityType: 'lesson',
      relatedEntityId: lessons[0].id,
    });

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.LESSON_CREATED,
      entityType: 'lesson',
      entityId: lessons[0].id,
      entityName: dto.title,
      title:
        occurrences.length > 1
          ? `Agendou ${occurrences.length} aulas`
          : 'Agendou uma aula',
      description: dto.title,
      metadata: { occurrences: occurrences.length, studentId: dto.studentId },
    });

    return {
      lessons,
      created: lessons.length,
      acceptedConflicts: dto.force ? conflictsByDate : [],
    };
  }

  /** Datas da série, já validando a coerência dos campos de recorrência. */
  private resolveOccurrences(dto: CreateLessonDto, scheduledAt: Date): Date[] {
    const recurrence = dto.recurrenceType ?? RecurrenceType.NONE;

    if (!dto.isRecurring || recurrence === RecurrenceType.NONE) {
      return [scheduledAt];
    }

    if (!dto.recurrenceEnd) {
      throw new BadRequestException(
        'Informe a data final da recorrência (`recurrenceEnd`)',
      );
    }

    const end = new Date(dto.recurrenceEnd);

    if (end <= scheduledAt) {
      throw new BadRequestException(
        'A data final da recorrência deve ser posterior à primeira aula',
      );
    }

    return this.scheduling.calculateOccurrences(scheduledAt, recurrence, end);
  }

  /** Verifica conflito em cada ocorrência da série. */
  private async collectConflicts(
    teacherId: string,
    studentId: string,
    occurrences: Date[],
    duration: number,
    excludeLessonId?: string,
  ): Promise<Array<{ scheduledAt: Date; conflicts: LessonConflict[] }>> {
    const results = await Promise.all(
      occurrences.map(async (scheduledAt) => ({
        scheduledAt,
        conflicts: await this.scheduling.findConflicts({
          teacherId,
          studentId,
          scheduledAt,
          duration,
          excludeLessonId,
        }),
      })),
    );

    return results.filter((entry) => entry.conflicts.length > 0);
  }

  /**
   * Cria as aulas da série numa transação.
   *
   * A primeira ocorrência vira a aula-mãe e as demais apontam para ela, o que
   * permite cancelar ou remarcar a série inteira depois. Tudo numa transação:
   * uma série parcialmente criada seria pior que nenhuma, porque o professor
   * veria algumas aulas e acharia que deu tudo certo.
   */
  private async createOccurrences(
    teacherId: string,
    dto: CreateLessonDto,
    occurrences: Date[],
    duration: number,
  ): Promise<CreatedLesson[]> {
    const isSeries = occurrences.length > 1;

    // `tx` é anotado explicitamente: sem isso a inferência do retorno da
    // transação e a do `create` dentro dela ficam circulares.
    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<CreatedLesson[]> => {
        const created: CreatedLesson[] = [];
        let parentLessonId: string | null = null;

        for (const [index, scheduledAt] of occurrences.entries()) {
          const lesson: CreatedLesson = await tx.lesson.create({
            data: {
              teacherId,
              studentId: dto.studentId,
              title: isSeries ? `${dto.title} (${index + 1})` : dto.title,
              description: dto.description,
              scheduledAt,
              duration,
              type: dto.type,
              location: dto.location,
              objectives: dto.objectives ?? [],
              worksIds: dto.worksIds ?? [],
              workScoreIds: dto.workScoreIds ?? [],
              topics: dto.topics ?? [],
              techniques: dto.techniques ?? [],
              repertoire: dto.repertoire ?? [],
              homework: dto.homework,
              practiceGoals: dto.practiceGoals ?? [],
              teacherNotes: dto.teacherNotes,
              publicNotes: dto.publicNotes,
              isRecurring: isSeries,
              recurrenceType: isSeries
                ? (dto.recurrenceType ?? RecurrenceType.NONE)
                : RecurrenceType.NONE,
              recurrenceEnd: dto.recurrenceEnd
                ? new Date(dto.recurrenceEnd)
                : null,
              parentLessonId,
            },
            select: { id: true, scheduledAt: true, title: true },
          });

          if (index === 0 && isSeries) {
            parentLessonId = lesson.id;
          }

          created.push(lesson);
        }

        await tx.teacherStudent.updateMany({
          where: { teacherId, studentId: dto.studentId },
          data: { totalLessons: { increment: created.length } },
        });

        return created;
      },
    );
  }

  // -------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------

  /**
   * Lista as aulas de quem chamou.
   *
   * O papel decide o recorte e o que aparece: o professor vê as próprias aulas
   * com as anotações privadas, o aluno vê as dele sem elas.
   */
  async list(userId: string, query: ListLessonsQueryDto) {
    const scope = await this.resolveScope(userId, query.as);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.LessonWhereInput = {
      ...scope.where,
      ...(query.status ? { status: query.status } : {}),
      ...(query.studentId && scope.role === 'teacher'
        ? { studentId: query.studentId }
        : {}),
      ...(query.from || query.to
        ? {
            scheduledAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [lessons, total] = await Promise.all([
      this.prisma.lesson.findMany({
        where,
        select: {
          ...LESSON_SELECT,
          ...(scope.role === 'teacher' ? TEACHER_ONLY_SELECT : {}),
          ...PARTICIPANTS_SELECT,
        },
        orderBy: { scheduledAt: query.order ?? 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lesson.count({ where }),
    ]);

    return {
      lessons,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Detalhe da aula, com as obras e partituras vinculadas já resolvidas — a
   * tela mostra título, compositor e link, e a aula só guarda os ids. Mesmo
   * formato de `workScores` do detalhe de tarefa.
   */
  async findOne(userId: string, lessonId: string) {
    const { lesson, role } = await this.requireParticipant(userId, lessonId);

    const detail = await this.prisma.lesson.findUnique({
      where: { id: lesson.id },
      select: {
        ...LESSON_SELECT,
        ...(role === 'teacher' ? TEACHER_ONLY_SELECT : {}),
        ...PARTICIPANTS_SELECT,
      },
    });

    if (!detail) {
      return detail;
    }

    const [workScores, works] = await Promise.all([
      detail.workScoreIds.length > 0
        ? this.prisma.workScore.findMany({
            where: { id: { in: detail.workScoreIds } },
            select: {
              id: true,
              title: true,
              type: true,
              source: true,
              downloadUrl: true,
              work: {
                select: {
                  id: true,
                  title: true,
                  composer: {
                    select: { id: true, name: true, fullName: true },
                  },
                },
              },
            },
          })
        : [],
      detail.worksIds.length > 0
        ? this.prisma.work.findMany({
            where: { id: { in: detail.worksIds } },
            select: {
              id: true,
              title: true,
              composer: { select: { id: true, name: true, fullName: true } },
            },
          })
        : [],
    ]);

    return { ...detail, workScores, works };
  }

  // -------------------------------------------------------------------
  // Alterações
  // -------------------------------------------------------------------

  async update(teacherUserId: string, lessonId: string, dto: UpdateLessonDto) {
    const { lesson } = await this.requireTeacherOfLesson(
      teacherUserId,
      lessonId,
    );

    if (lesson.status !== LessonStatus.SCHEDULED) {
      throw new BadRequestException(
        'Só é possível editar aula que ainda está agendada',
      );
    }

    const updated = await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: dto.title,
        description: dto.description,
        duration: dto.duration,
        type: dto.type,
        location: dto.location,
        objectives: dto.objectives,
        worksIds: dto.worksIds,
        workScoreIds: dto.workScoreIds,
        topics: dto.topics,
        techniques: dto.techniques,
        repertoire: dto.repertoire,
        homework: dto.homework,
        practiceGoals: dto.practiceGoals,
        teacherNotes: dto.teacherNotes,
        publicNotes: dto.publicNotes,
      },
      select: { ...LESSON_SELECT, ...TEACHER_ONLY_SELECT },
    });

    await this.notifications.notify({
      userId: lesson.student.userId,
      type: NotificationType.ASSIGNMENT_UPDATED_BY_TEACHER,
      title: 'Aula atualizada',
      message: `A aula "${updated.title}" foi alterada pelo professor.`,
      actionUrl: `/student/lessons/${lessonId}`,
      relatedEntityType: 'lesson',
      relatedEntityId: lessonId,
    });

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.LESSON_UPDATED,
      entityType: 'lesson',
      entityId: lessonId,
      entityName: updated.title,
      title: 'Editou uma aula',
      changes: Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
    });

    return updated;
  }

  async reschedule(
    teacherUserId: string,
    lessonId: string,
    dto: RescheduleLessonDto,
  ) {
    const { lesson } = await this.requireTeacherOfLesson(
      teacherUserId,
      lessonId,
    );

    if (lesson.status !== LessonStatus.SCHEDULED) {
      throw new BadRequestException(
        'Só é possível remarcar aula que ainda está agendada',
      );
    }

    const scheduledAt = new Date(dto.scheduledAt);
    const duration = dto.duration ?? lesson.duration;

    const conflicts = await this.scheduling.findConflicts({
      teacherId: lesson.teacherId,
      studentId: lesson.studentId,
      scheduledAt,
      duration,
      excludeLessonId: lessonId,
    });

    if (conflicts.length > 0 && !dto.force) {
      throw new ConflictException({
        message: 'Conflito de horário',
        conflicts,
        suggestions: await this.scheduling.suggestAlternatives({
          teacherId: lesson.teacherId,
          studentId: lesson.studentId,
          scheduledAt,
          duration,
          excludeLessonId: lessonId,
        }),
      });
    }

    const updated = await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        scheduledAt,
        duration,
        // Guarda o horário anterior: o aluno precisa saber de onde a aula saiu.
        rescheduledFrom: lesson.scheduledAt,
        rescheduleReason: dto.reason,
      },
      select: LESSON_SELECT,
    });

    await this.notifications.notify({
      userId: lesson.student.userId,
      type: NotificationType.LESSON_RESCHEDULED_BY_TEACHER,
      priority: NotificationPriority.HIGH,
      title: 'Aula remarcada',
      message: `A aula "${lesson.title}" foi remarcada.`,
      actionText: 'Ver nova data',
      actionUrl: `/student/lessons/${lessonId}`,
      relatedEntityType: 'lesson',
      relatedEntityId: lessonId,
    });

    return updated;
  }

  async cancel(teacherUserId: string, lessonId: string, dto: CancelLessonDto) {
    const { lesson, teacher } = await this.requireTeacherOfLesson(
      teacherUserId,
      lessonId,
    );

    if (lesson.status !== LessonStatus.SCHEDULED) {
      throw new BadRequestException('Esta aula não está agendada');
    }

    // Cancelar a série atinge só as ocorrências futuras: as passadas já
    // aconteceram e apagá-las do calendário reescreveria o histórico.
    const seriesFilter: Prisma.LessonWhereInput = dto.cancelSeries
      ? {
          status: LessonStatus.SCHEDULED,
          scheduledAt: { gte: new Date() },
          OR: [
            { id: lesson.parentLessonId ?? lesson.id },
            { parentLessonId: lesson.parentLessonId ?? lesson.id },
          ],
        }
      : { id: lessonId };

    const result = await this.prisma.lesson.updateMany({
      where: { ...seriesFilter, teacherId: teacher.id },
      data: {
        status: LessonStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: dto.reason,
        cancelledBy: teacherUserId,
      },
    });

    await this.notifications.notify({
      userId: lesson.student.userId,
      type: NotificationType.LESSON_CANCELLED_BY_TEACHER,
      priority: NotificationPriority.HIGH,
      title: dto.cancelSeries ? 'Aulas canceladas' : 'Aula cancelada',
      message: dto.cancelSeries
        ? `${result.count} aula(s) foram canceladas: ${dto.reason}`
        : `A aula "${lesson.title}" foi cancelada: ${dto.reason}`,
      relatedEntityType: 'lesson',
      relatedEntityId: lessonId,
    });

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.LESSON_STATUS_CHANGED,
      entityType: 'lesson',
      entityId: lessonId,
      entityName: lesson.title,
      title:
        result.count > 1
          ? `Cancelou ${result.count} aulas da série`
          : 'Cancelou uma aula',
      description: dto.reason,
      metadata: { cancelled: result.count, series: dto.cancelSeries === true },
    });

    return { cancelled: result.count };
  }

  /**
   * Registra o resultado da aula.
   *
   * Ausência do aluno vira `NO_SHOW`, não `COMPLETED`: são coisas diferentes
   * no histórico e nas estatísticas do vínculo.
   */
  async complete(
    teacherUserId: string,
    lessonId: string,
    dto: CompleteLessonDto,
  ) {
    const { lesson, teacher } = await this.requireTeacherOfLesson(
      teacherUserId,
      lessonId,
    );

    if (lesson.status !== LessonStatus.SCHEDULED) {
      throw new BadRequestException('Esta aula já foi encerrada');
    }

    const present = dto.studentPresent ?? true;
    const status = present ? LessonStatus.COMPLETED : LessonStatus.NO_SHOW;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.lesson.update({
        where: { id: lessonId },
        data: {
          status,
          studentPresent: present,
          actualEndTime: new Date(),
          lessonSummary: dto.lessonSummary,
          engagement: dto.engagement,
          preparation: dto.preparation,
          homework: dto.homework,
          teacherNotes: dto.teacherNotes,
          publicNotes: dto.publicNotes,
        },
        select: { ...LESSON_SELECT, ...TEACHER_ONLY_SELECT },
      });

      await tx.teacherStudent.updateMany({
        where: { teacherId: teacher.id, studentId: lesson.studentId },
        data: present
          ? { completedLessons: { increment: 1 } }
          : { noShowLessons: { increment: 1 } },
      });

      if (present) {
        await tx.student.update({
          where: { id: lesson.studentId },
          data: {
            totalLessonsAttended: { increment: 1 },
            lastLessonAt: new Date(),
          },
        });
      }

      return result;
    });

    if (!present) {
      await this.notifications.notify({
        userId: lesson.student.userId,
        type: NotificationType.LESSON_MARKED_NO_SHOW,
        priority: NotificationPriority.HIGH,
        title: 'Falta registrada',
        message: `Você foi marcado como ausente na aula "${lesson.title}".`,
        relatedEntityType: 'lesson',
        relatedEntityId: lessonId,
      });
    }

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.LESSON_STATUS_CHANGED,
      entityType: 'lesson',
      entityId: lessonId,
      entityName: lesson.title,
      title: present ? 'Concluiu uma aula' : 'Registrou falta do aluno',
      metadata: { present, studentId: lesson.studentId },
    });

    return updated;
  }

  /** Feedback do aluno sobre a aula, permitido só depois de ela acontecer. */
  async submitStudentFeedback(
    studentUserId: string,
    lessonId: string,
    dto: StudentFeedbackDto,
  ) {
    const { lesson, role } = await this.requireParticipant(
      studentUserId,
      lessonId,
    );

    if (role !== 'student') {
      throw new ForbiddenException('Apenas o aluno da aula pode dar feedback');
    }

    if (lesson.status === LessonStatus.SCHEDULED) {
      throw new BadRequestException(
        'O feedback só pode ser enviado depois da aula',
      );
    }

    const updated = await this.prisma.lesson.update({
      where: { id: lessonId },
      data: { studentFeedback: dto.feedback },
      select: LESSON_SELECT,
    });

    await this.notifications.notify({
      userId: lesson.teacher.userId,
      type: NotificationType.STUDENT_GAVE_LESSON_FEEDBACK,
      title: 'Feedback recebido',
      message: `O aluno comentou sobre a aula "${lesson.title}".`,
      actionUrl: `/teacher/lessons/${lessonId}`,
      relatedEntityType: 'lesson',
      relatedEntityId: lessonId,
    });

    return updated;
  }

  /**
   * O aluno avisa que vai faltar, ou pede para remarcar.
   *
   * **Por que existe.** Era a última coisa que a tela de aula do aluno ainda
   * pedia ao legado (`PATCH /api/lessons/:id` com `messageType`), e não havia
   * equivalente aqui: o `PATCH /lessons/:id` da API é só do professor. Os dois
   * tipos de notificação já existiam no schema sem ninguém para emiti-los.
   *
   * **A aula não muda.** Quem remarca ou cancela é o professor; isto é um
   * recado, e é assim que o legado se comportava. Só vale para aula ainda
   * agendada — avisar ausência numa aula que já aconteceu não quer dizer nada.
   */
  async sendStudentNotice(
    studentUserId: string,
    lessonId: string,
    dto: StudentLessonNoticeDto,
  ) {
    const { lesson, role } = await this.requireParticipant(
      studentUserId,
      lessonId,
    );

    if (role !== 'student') {
      throw new ForbiddenException(
        'Apenas o aluno da aula pode enviar este aviso',
      );
    }

    if (lesson.status !== LessonStatus.SCHEDULED) {
      throw new BadRequestException(
        'A aula não está mais agendada: o aviso não se aplica',
      );
    }

    const ausencia = dto.type === 'absence';
    const recado = dto.message?.trim();

    await this.notifications.notify({
      userId: lesson.teacher.userId,
      type: ausencia
        ? NotificationType.STUDENT_INFORMED_ABSENCE
        : NotificationType.STUDENT_REQUESTED_RESCHEDULE,
      title: ausencia ? 'Aluno avisou ausência' : 'Aluno pediu remarcação',
      message:
        (ausencia
          ? `O aluno avisou que não poderá comparecer à aula "${lesson.title}".`
          : `O aluno pediu para remarcar a aula "${lesson.title}".`) +
        (recado ? ` Recado: "${recado}"` : ''),
      actionUrl: `/teacher/lessons/${lessonId}`,
      relatedEntityType: 'lesson',
      relatedEntityId: lessonId,
    });

    return { success: true };
  }

  // -------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------

  private async requireTeacher(userId: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId },
      select: { id: true, userId: true, defaultLessonDuration: true },
    });

    if (!teacher) {
      throw new ForbiddenException(
        'Você precisa de um perfil de professor para esta ação',
      );
    }

    return teacher;
  }

  /** Só há aula onde há vínculo aceito e ativo. */
  private async requireActiveRelationship(
    teacherId: string,
    studentId: string,
  ) {
    const relationship = await this.prisma.teacherStudent.findFirst({
      where: {
        teacherId,
        studentId,
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      },
      select: {
        id: true,
        lessonDuration: true,
        student: { select: { id: true, userId: true } },
      },
    });

    if (!relationship) {
      throw new ForbiddenException(
        'Este aluno não está vinculado a você, ou o convite ainda não foi aceito',
      );
    }

    return relationship;
  }

  private async requireTeacherOfLesson(
    teacherUserId: string,
    lessonId: string,
  ) {
    const teacher = await this.requireTeacher(teacherUserId);
    const lesson = await this.loadLesson(lessonId);

    if (lesson.teacherId !== teacher.id) {
      throw new NotFoundException('Aula não encontrada');
    }

    return { lesson, teacher };
  }

  /** Carrega a aula garantindo que quem chamou é professor ou aluno dela. */
  private async requireParticipant(userId: string, lessonId: string) {
    const lesson = await this.loadLesson(lessonId);

    if (lesson.teacher.userId === userId) {
      return { lesson, role: 'teacher' as const };
    }

    if (lesson.student.userId === userId) {
      return { lesson, role: 'student' as const };
    }

    throw new NotFoundException('Aula não encontrada');
  }

  private async loadLesson(lessonId: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        status: true,
        duration: true,
        scheduledAt: true,
        teacherId: true,
        studentId: true,
        parentLessonId: true,
        teacher: { select: { userId: true } },
        student: { select: { userId: true } },
      },
    });

    if (!lesson) {
      throw new NotFoundException('Aula não encontrada');
    }

    return lesson;
  }

  /** Resolve se a consulta é do lado do professor ou do aluno. */
  private async resolveScope(userId: string, as?: 'teacher' | 'student') {
    if (as !== 'student') {
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (teacher) {
        return { role: 'teacher' as const, where: { teacherId: teacher.id } };
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
