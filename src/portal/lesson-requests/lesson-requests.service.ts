import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LessonRequestStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
  SchoolActivityAction,
  StudentInviteStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LessonsService } from '../lessons/lessons.service';
import { ScheduleRulesService } from '../lessons/schedule-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import {
  AcceptLessonRequestDto,
  CreateLessonRequestDto,
  DeclineLessonRequestDto,
  ListLessonRequestsQueryDto,
} from './dto/lesson-request.dto';

const HOUR_MS = 3_600_000;

const PERSON = {
  select: {
    id: true,
    userId: true,
    user: { select: { firstName: true, lastName: true, image: true } },
  },
} as const;

const REQUEST_SELECT = {
  id: true,
  scheduledAt: true,
  duration: true,
  note: true,
  status: true,
  lessonId: true,
  answer: true,
  respondedAt: true,
  createdAt: true,
  teacher: PERSON,
  student: PERSON,
} satisfies Prisma.LessonRequestSelect;

const nameOf = (u: { firstName: string | null; lastName: string | null }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim();

/**
 * Pedido de aula num horário livre (04/10/2026).
 *
 * O aluno vê as horas livres do professor e pede uma; nada fica marcado até
 * o professor aceitar. **Aceitar passa pelo mesmo caminho da marcação do
 * professor** (`LessonsService.create`), com as mesmas regras de agenda —
 * não existe "porta lateral" que crie aula sem a conferência.
 *
 * Na hora do pedido valem as regras que o professor declarou no esquema:
 * aceita pedidos, antecedência mínima, horizonte, e o horário precisa estar
 * livre para os dois (conflito barra o pedido; aviso, não).
 */
@Injectable()
export class LessonRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: ScheduleRulesService,
    private readonly lessons: LessonsService,
    private readonly notifications: NotificationsService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  async create(userId: string, dto: CreateLessonRequestDto) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: {
        id: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });
    if (!student) throw new ForbiddenException('Você não tem perfil de aluno');

    const relationship = await this.prisma.teacherStudent.findFirst({
      where: {
        teacherId: dto.teacherId,
        studentId: student.id,
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      },
      select: {
        lessonDuration: true,
        teacher: {
          select: {
            id: true,
            userId: true,
            acceptsLessonRequests: true,
            requestLeadHours: true,
            requestHorizonDays: true,
            defaultLessonDuration: true,
          },
        },
      },
    });
    if (!relationship)
      throw new ForbiddenException('Você não estuda com este professor');

    const { teacher } = relationship;
    if (!teacher.acceptsLessonRequests) {
      throw new ForbiddenException(
        'Este professor não está recebendo pedidos de aula agora',
      );
    }

    const scheduledAt = new Date(dto.scheduledAt);
    const now = Date.now();
    if (scheduledAt.getTime() < now + teacher.requestLeadHours * HOUR_MS) {
      throw new BadRequestException(
        `Pedidos precisam de ${teacher.requestLeadHours} h de antecedência`,
      );
    }
    if (
      scheduledAt.getTime() >
      now + teacher.requestHorizonDays * 24 * HOUR_MS
    ) {
      throw new BadRequestException(
        `Dá para pedir aula até ${teacher.requestHorizonDays} dias à frente`,
      );
    }

    const duration =
      dto.duration ??
      relationship.lessonDuration ??
      teacher.defaultLessonDuration;
    const check = await this.rules.check({
      teacherId: teacher.id,
      studentId: student.id,
      occurrences: [scheduledAt],
      duration,
      location: null,
    });
    const occurrence = check.occurrences[0];
    const outside = occurrence.findings.some(
      (f) => f.code === 'OUTSIDE_AVAILABILITY',
    );
    if (
      occurrence.severity === 'conflict' ||
      occurrence.severity === 'blocking' ||
      outside
    ) {
      throw new ConflictException({
        message: 'Este horário não está livre',
        findings: occurrence.findings,
        suggestions: occurrence.suggestions,
      });
    }

    // Um pedido pendente por horário: clicar duas vezes não gera dois.
    const duplicate = await this.prisma.lessonRequest.findFirst({
      where: {
        studentId: student.id,
        teacherId: teacher.id,
        scheduledAt,
        status: LessonRequestStatus.PENDING,
      },
      select: { id: true },
    });
    if (duplicate) {
      return this.prisma.lessonRequest.findUniqueOrThrow({
        where: { id: duplicate.id },
        select: REQUEST_SELECT,
      });
    }

    const request = await this.prisma.lessonRequest.create({
      data: {
        teacherId: teacher.id,
        studentId: student.id,
        scheduledAt,
        duration,
        note: dto.note?.trim() || null,
      },
      select: REQUEST_SELECT,
    });

    const studentName = nameOf(student.user) || 'Um aluno';
    await this.notifications.notify({
      userId: teacher.userId,
      type: NotificationType.LESSON_REQUESTED,
      priority: NotificationPriority.HIGH,
      title: 'Pedido de aula',
      message: `${studentName} pediu uma aula.`,
      actionText: 'Responder',
      actionUrl: `/teacher?request=${request.id}`,
      relatedEntityType: 'lesson-request',
      relatedEntityId: request.id,
    });
    await this.activities.record({
      userId,
      userType: 'student',
      action: SchoolActivityAction.LESSON_REQUESTED,
      entityType: 'lesson-request',
      entityId: request.id,
      entityName: 'Pedido de aula',
      title: 'Pediu uma aula',
      metadata: { scheduledAt: scheduledAt.toISOString(), duration },
    });

    return request;
  }

  async list(userId: string, query: ListLessonRequestsQueryDto) {
    const scope = await this.resolveScope(userId, query.as);
    await this.expireOld(scope);
    return this.prisma.lessonRequest.findMany({
      where: {
        ...(scope.role === 'teacher'
          ? { teacherId: scope.id }
          : { studentId: scope.id }),
        ...(query.status ? { status: query.status } : {}),
      },
      select: REQUEST_SELECT,
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }],
      take: 200,
    });
  }

  async accept(userId: string, requestId: string, dto: AcceptLessonRequestDto) {
    const request = await this.requirePendingForTeacher(userId, requestId);

    // A mesma porta da marcação do professor: mesmas regras, mesmo 409.
    const created = await this.lessons.create(userId, {
      studentId: request.studentId,
      title: dto.title?.trim() || 'Aula pedida',
      scheduledAt: request.scheduledAt.toISOString(),
      duration: request.duration,
      location: dto.location,
      force: dto.force,
    });

    const lessonId = created.lessons[0]?.id ?? null;
    const updated = await this.prisma.lessonRequest.update({
      where: { id: requestId },
      data: {
        status: LessonRequestStatus.ACCEPTED,
        lessonId,
        respondedAt: new Date(),
      },
      select: REQUEST_SELECT,
    });

    await this.notifications.notify({
      userId: request.student.userId,
      type: NotificationType.LESSON_REQUEST_ACCEPTED,
      priority: NotificationPriority.HIGH,
      title: 'Pedido de aula aceito',
      message: 'Sua aula foi marcada no horário que você pediu.',
      actionText: 'Ver aula',
      actionUrl: lessonId ? `/student/lessons/${lessonId}` : '/student/lessons',
      relatedEntityType: 'lesson',
      relatedEntityId: lessonId ?? undefined,
    });
    await this.recordAnswer(userId, requestId, 'Aceitou um pedido de aula');

    return { request: updated, lesson: created };
  }

  async decline(
    userId: string,
    requestId: string,
    dto: DeclineLessonRequestDto,
  ) {
    const request = await this.requirePendingForTeacher(userId, requestId);
    const updated = await this.prisma.lessonRequest.update({
      where: { id: requestId },
      data: {
        status: LessonRequestStatus.DECLINED,
        answer: dto.answer?.trim() || null,
        respondedAt: new Date(),
      },
      select: REQUEST_SELECT,
    });

    await this.notifications.notify({
      userId: request.student.userId,
      type: NotificationType.LESSON_REQUEST_DECLINED,
      priority: NotificationPriority.MEDIUM,
      title: 'Pedido de aula não aceito',
      message:
        dto.answer?.trim() ||
        'O professor não pôde aceitar o horário que você pediu.',
      actionText: 'Pedir outro horário',
      actionUrl: '/student/calendar',
      relatedEntityType: 'lesson-request',
      relatedEntityId: requestId,
    });
    await this.recordAnswer(userId, requestId, 'Recusou um pedido de aula');

    return updated;
  }

  async cancel(userId: string, requestId: string) {
    const student = await this.prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!student) throw new ForbiddenException('Você não tem perfil de aluno');
    const { count } = await this.prisma.lessonRequest.updateMany({
      where: {
        id: requestId,
        studentId: student.id,
        status: LessonRequestStatus.PENDING,
      },
      data: { status: LessonRequestStatus.CANCELLED, respondedAt: new Date() },
    });
    if (count === 0)
      throw new NotFoundException('Pedido pendente não encontrado');

    await this.activities.record({
      userId,
      userType: 'student',
      action: SchoolActivityAction.LESSON_REQUEST_CANCELLED,
      entityType: 'lesson-request',
      entityId: requestId,
      entityName: 'Pedido de aula',
      title: 'Cancelou um pedido de aula',
    });
  }

  /** Pedidos pendentes de um professor — o painel usa. */
  pendingFor(teacherId: string) {
    return this.prisma.lessonRequest.findMany({
      where: {
        teacherId,
        status: LessonRequestStatus.PENDING,
        scheduledAt: { gt: new Date() },
      },
      select: REQUEST_SELECT,
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
  }

  // -------------------------------------------------------------------

  /** Pedido cujo horário passou sem resposta vira EXPIRED (preguiçoso, na leitura). */
  private async expireOld(scope: { role: 'teacher' | 'student'; id: string }) {
    await this.prisma.lessonRequest.updateMany({
      where: {
        ...(scope.role === 'teacher'
          ? { teacherId: scope.id }
          : { studentId: scope.id }),
        status: LessonRequestStatus.PENDING,
        scheduledAt: { lt: new Date() },
      },
      data: { status: LessonRequestStatus.EXPIRED },
    });
  }

  private async requirePendingForTeacher(userId: string, requestId: string) {
    const request = await this.prisma.lessonRequest.findFirst({
      where: { id: requestId, teacher: { is: { userId } } },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        duration: true,
        studentId: true,
        student: { select: { userId: true } },
      },
    });
    if (!request) throw new NotFoundException('Pedido não encontrado');
    if (request.status !== LessonRequestStatus.PENDING) {
      throw new BadRequestException('Este pedido já foi respondido');
    }
    if (request.scheduledAt.getTime() < Date.now()) {
      await this.prisma.lessonRequest.update({
        where: { id: requestId },
        data: { status: LessonRequestStatus.EXPIRED },
      });
      throw new BadRequestException('O horário deste pedido já passou');
    }
    return request;
  }

  private recordAnswer(userId: string, requestId: string, title: string) {
    return this.activities.record({
      userId,
      userType: 'teacher',
      action: SchoolActivityAction.LESSON_REQUEST_ANSWERED,
      entityType: 'lesson-request',
      entityId: requestId,
      entityName: 'Pedido de aula',
      title,
    });
  }

  private async resolveScope(userId: string, as?: 'teacher' | 'student') {
    const [teacher, student] = await Promise.all([
      as === 'student'
        ? null
        : this.prisma.teacher.findUnique({
            where: { userId },
            select: { id: true },
          }),
      as === 'teacher'
        ? null
        : this.prisma.student.findUnique({
            where: { userId },
            select: { id: true },
          }),
    ]);
    if (teacher) return { role: 'teacher' as const, id: teacher.id };
    if (student) return { role: 'student' as const, id: student.id };
    throw new ForbiddenException('Você não participa do portal');
  }
}
