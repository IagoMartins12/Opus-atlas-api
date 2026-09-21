import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
  SchoolActivityAction,
  StorageAssetStatus,
  StudentInviteStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import { NotificationsService } from '../notifications/notifications.service';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import {
  SubmissionEntry,
  newSubmissionId,
  readSubmissions,
  writeSubmissions,
} from './assignment-types';
import {
  AssignmentFeedbackDto,
  CompleteAssignmentDto,
  CreateSubmissionDto,
} from './dto/assignment-actions.dto';
import {
  CreateAssignmentDto,
  UpdateAssignmentDto,
  UpdateProgressDto,
} from './dto/create-assignment.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments-query.dto';

/** Entidade dona dos arquivos de tarefa, no registro de armazenamento. */
const ASSET_ENTITY_TYPE = 'assignment';

/** Teto de envios por tarefa, para o histórico não crescer sem limite. */
const MAX_SUBMISSIONS = 10;

const MAX_MILESTONES = 30;

const ASSIGNMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  priority: true,
  status: true,
  dueDate: true,
  estimatedTime: true,
  actualTime: true,
  isCompleted: true,
  completedAt: true,
  progress: true,
  workScoreIds: true,
  worksIds: true,
  exercises: true,
  practiceGoals: true,
  technicalGoals: true,
  musicalGoals: true,
  tempoTargets: true,
  teacherFeedback: true,
  teacherRating: true,
  studentNotes: true,
  studentRating: true,
  submissions: true,
  submissionDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PARTICIPANTS_SELECT = {
  student: {
    select: {
      id: true,
      userId: true,
      user: { select: { firstName: true, lastName: true, image: true } },
    },
  },
  lesson: {
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      teacher: {
        select: {
          id: true,
          userId: true,
          user: { select: { firstName: true, lastName: true, image: true } },
        },
      },
    },
  },
} as const;

/** Projeção completa: a tarefa e quem participa dela. */
const ASSIGNMENT_FULL_SELECT = {
  ...ASSIGNMENT_SELECT,
  ...PARTICIPANTS_SELECT,
} as const;

type AssignmentRow = Prisma.AssignmentGetPayload<{
  select: typeof ASSIGNMENT_FULL_SELECT;
}>;

/** Papel de quem consulta, dentro de uma tarefa específica. */
type ParticipantRole = 'teacher' | 'student';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  // -------------------------------------------------------------------
  // Criação
  // -------------------------------------------------------------------

  /**
   * Cria uma tarefa a partir de uma aula.
   *
   * **O aluno não é informado no corpo: ele vem da aula.** No legado o
   * professor mandava `lessonId` e `studentUserId` soltos, e nada checava que
   * um correspondia ao outro nem que o aluno era dele — bastava trocar o
   * `studentUserId` para criar tarefa em nome de qualquer aluno da base,
   * pendurada numa aula de que aquele aluno não participa. Derivar o aluno da
   * aula elimina a divergência inteira em vez de tentar validá-la.
   *
   * `lessonId` também passa a ser obrigatório. Como o legado só exigia aluno,
   * título e descrição, omitir a aula fazia o Prisma descartar o filtro e a
   * tarefa acabava presa a uma aula qualquer do professor.
   */
  async create(teacherUserId: string, dto: CreateAssignmentDto) {
    const teacher = await this.requireTeacher(teacherUserId);

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: dto.lessonId, teacherId: teacher.id },
      select: {
        id: true,
        title: true,
        studentId: true,
        student: { select: { userId: true } },
      },
    });

    if (!lesson) {
      throw new NotFoundException('Aula não encontrada');
    }

    await this.requireActiveRelationship(teacher.id, lesson.studentId);

    if (dto.dueDate && new Date(dto.dueDate).getTime() < Date.now()) {
      throw new BadRequestException('O prazo precisa estar no futuro');
    }

    const assignment = await this.prisma.assignment.create({
      data: {
        lessonId: lesson.id,
        studentId: lesson.studentId,
        title: dto.title,
        description: dto.description,
        type: dto.type ?? 'practice',
        priority: dto.priority ?? 'medium',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        estimatedTime: dto.estimatedTime,
        workScoreIds: dto.workScoreIds ?? [],
        worksIds: dto.worksIds ?? [],
        exercises: dto.exercises ?? [],
        practiceGoals: dto.practiceGoals ?? [],
        technicalGoals: dto.technicalGoals ?? [],
        musicalGoals: dto.musicalGoals ?? [],
        tempoTargets: dto.tempoTargets
          ? dto.tempoTargets.map((target) => ({ ...target }))
          : undefined,
        status: AssignmentStatus.PENDING,
        progress: 0,
      },
      select: ASSIGNMENT_FULL_SELECT,
    });

    await this.notifications.notify({
      userId: lesson.student.userId,
      type: NotificationType.NEW_ASSIGNMENT_CREATED,
      priority:
        dto.priority === 'high'
          ? NotificationPriority.HIGH
          : NotificationPriority.MEDIUM,
      title: 'Nova tarefa',
      message: `${this.teacherName(assignment)} criou a tarefa "${assignment.title}".`,
      actionText: 'Ver tarefa',
      actionUrl: `/student/assignments/${assignment.id}`,
      relatedEntityType: ASSET_ENTITY_TYPE,
      relatedEntityId: assignment.id,
    });

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.ASSIGNMENT_CREATED,
      entityType: 'assignment',
      entityId: assignment.id,
      entityName: assignment.title,
      title: 'Criou uma tarefa',
      description: assignment.title,
      metadata: { lessonId: lesson.id, studentId: lesson.studentId },
    });

    return this.toView(assignment);
  }

  // -------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------

  /**
   * Lista as tarefas de quem chamou.
   *
   * As estatísticas ignoram o filtro de status de propósito: elas descrevem o
   * conjunto todo ("3 pendentes, 1 atrasada"), e recalculá-las dentro do
   * próprio filtro devolveria sempre o total da aba aberta. No legado eram
   * piores que isso — vinham de `assignments.filter(...)` sobre a **página
   * atual**, então a partir do quinquagésimo primeiro registro os números do
   * painel simplesmente paravam de bater.
   */
  async list(userId: string, query: ListAssignmentsQueryDto) {
    const scope = await this.resolveScope(userId, query.as);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const baseWhere = this.buildBaseWhere(scope, query);
    const where: Prisma.AssignmentWhereInput = {
      ...baseWhere,
      ...this.statusCondition(query.status),
    };

    const [rows, total, stats] = await Promise.all([
      this.prisma.assignment.findMany({
        where,
        select: ASSIGNMENT_FULL_SELECT,
        orderBy: [{ dueDate: query.order ?? 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.assignment.count({ where }),
      this.computeStats(baseWhere),
    ]);

    return {
      assignments: rows.map((row) => this.toView(row)),
      stats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(userId: string, assignmentId: string) {
    const { assignment, role } = await this.requireParticipant(
      userId,
      assignmentId,
    );

    const workScores =
      assignment.workScoreIds.length > 0
        ? await this.prisma.workScore.findMany({
            where: { id: { in: assignment.workScoreIds } },
            select: {
              id: true,
              title: true,
              type: true,
              downloadUrl: true,
              work: {
                select: {
                  id: true,
                  title: true,
                  composer: { select: { id: true, name: true } },
                },
              },
            },
          })
        : [];

    const view = this.toView(assignment);

    return {
      ...view,
      workScores,
      permissions: {
        canEdit: role === 'teacher',
        canDelete: role === 'teacher',
        // Quem dá feedback é o professor. No legado esta permissão era
        // devolvida como verdadeira para o **aluno**, invertendo os papéis.
        canGiveFeedback: role === 'teacher',
        canSubmit: role === 'student' && !assignment.isCompleted,
        canComplete: role === 'student' && !assignment.isCompleted,
      },
    };
  }

  // -------------------------------------------------------------------
  // Alterações do professor
  // -------------------------------------------------------------------

  async update(
    teacherUserId: string,
    assignmentId: string,
    dto: UpdateAssignmentDto,
  ) {
    const { assignment } = await this.requireTeacherOfAssignment(
      teacherUserId,
      assignmentId,
    );

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        priority: dto.priority,
        dueDate:
          dto.dueDate === undefined
            ? undefined
            : dto.dueDate === null
              ? null
              : new Date(dto.dueDate),
        estimatedTime: dto.estimatedTime,
        workScoreIds: dto.workScoreIds,
        worksIds: dto.worksIds,
        exercises: dto.exercises,
        practiceGoals: dto.practiceGoals,
        technicalGoals: dto.technicalGoals,
        musicalGoals: dto.musicalGoals,
        tempoTargets: dto.tempoTargets
          ? dto.tempoTargets.map((target) => ({ ...target }))
          : undefined,
      },
      select: ASSIGNMENT_FULL_SELECT,
    });

    const changed = this.describeChanges(assignment, dto);

    if (changed.length > 0) {
      await this.notifications.notify({
        userId: assignment.student.userId,
        type: NotificationType.ASSIGNMENT_UPDATED_BY_TEACHER,
        title: 'Tarefa atualizada',
        message: `A tarefa "${updated.title}" teve alteração de ${changed.join(', ')}.`,
        actionText: 'Ver tarefa',
        actionUrl: `/student/assignments/${assignmentId}`,
        relatedEntityType: ASSET_ENTITY_TYPE,
        relatedEntityId: assignmentId,
      });
    }

    return this.toView(updated);
  }

  /**
   * Feedback do professor.
   *
   * Não exige vínculo ativo: encerrada a relação, o professor ainda pode
   * fechar o que ficou em aberto. O que ele não pode é criar tarefa nova.
   */
  async giveFeedback(
    teacherUserId: string,
    assignmentId: string,
    dto: AssignmentFeedbackDto,
  ) {
    const { assignment } = await this.requireTeacherOfAssignment(
      teacherUserId,
      assignmentId,
    );

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { teacherFeedback: dto.feedback, teacherRating: dto.rating },
      select: ASSIGNMENT_FULL_SELECT,
    });

    await this.notifications.notify({
      userId: assignment.student.userId,
      type: NotificationType.TEACHER_GAVE_FEEDBACK,
      priority: NotificationPriority.HIGH,
      title: 'Feedback do professor',
      message: `${this.teacherName(assignment)} comentou a tarefa "${assignment.title}".`,
      actionText: 'Ver feedback',
      actionUrl: `/student/assignments/${assignmentId}`,
      relatedEntityType: ASSET_ENTITY_TYPE,
      relatedEntityId: assignmentId,
    });

    await this.activities.record({
      userId: teacherUserId,
      userType: 'teacher',
      action: SchoolActivityAction.ASSIGNMENT_FEEDBACK_GIVEN,
      entityType: 'assignment',
      entityId: assignmentId,
      entityName: assignment.title,
      title: 'Deu feedback numa tarefa',
      metadata: { rating: dto.rating ?? null },
    });

    return this.toView(updated);
  }

  /**
   * Apaga a tarefa e os arquivos que o aluno enviou nela.
   *
   * Os arquivos saem primeiro: se a remoção do registro viesse antes e a
   * limpeza falhasse, o vídeo ficaria no armazenamento sem nada que o
   * referenciasse — órfão pago para sempre.
   */
  async remove(teacherUserId: string, assignmentId: string): Promise<void> {
    await this.requireTeacherOfAssignment(teacherUserId, assignmentId);

    await this.discardAssets(assignmentId);

    await this.prisma.assignment.delete({ where: { id: assignmentId } });
  }

  // -------------------------------------------------------------------
  // Ações do aluno
  // -------------------------------------------------------------------

  async updateProgress(
    studentUserId: string,
    assignmentId: string,
    dto: UpdateProgressDto,
  ) {
    const { assignment } = await this.requireStudentOfAssignment(
      studentUserId,
      assignmentId,
    );

    if (assignment.isCompleted) {
      throw new BadRequestException('A tarefa já foi concluída');
    }

    const submissions = readSubmissions(assignment.submissions);

    if (dto.milestone) {
      submissions.milestones = [
        ...submissions.milestones,
        {
          label: dto.milestone,
          progress: dto.progress ?? assignment.progress ?? 0,
          reachedAt: new Date().toISOString(),
        },
      ].slice(-MAX_MILESTONES);
    }

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        progress: dto.progress,
        actualTime: dto.actualTime,
        studentNotes: dto.studentNotes,
        studentRating: dto.studentRating,
        // Relatar progresso tira a tarefa de "pendente" sozinho: exigir que o
        // aluno mude o status à mão é o tipo de passo que ninguém dá.
        status:
          assignment.status === AssignmentStatus.PENDING
            ? AssignmentStatus.IN_PROGRESS
            : undefined,
        submissions: dto.milestone ? writeSubmissions(submissions) : undefined,
      },
      select: ASSIGNMENT_FULL_SELECT,
    });

    return this.toView(updated);
  }

  /**
   * Registra um envio do aluno.
   *
   * O histórico é mantido: cada envio entra na lista em vez de substituir o
   * anterior. O legado guardava um vídeo só e apagava o antigo a cada novo
   * upload, o que descartava justamente o que mostra a evolução do estudo.
   *
   * A notificação ao professor sai **aqui**, e só aqui. No legado ela disparava
   * sempre que o campo `submissions` mudava — e como os marcos de progresso
   * eram gravados dentro desse mesmo campo, o professor recebia "o aluno
   * enviou uma submissão" a cada marco registrado.
   */
  async addSubmission(
    studentUserId: string,
    assignmentId: string,
    dto: CreateSubmissionDto,
  ) {
    const { assignment, student } = await this.requireStudentOfAssignment(
      studentUserId,
      assignmentId,
    );

    if (assignment.isCompleted) {
      throw new BadRequestException(
        'A tarefa já foi concluída; não é possível enviar mais arquivos',
      );
    }

    if (!dto.assetId && !dto.note) {
      throw new BadRequestException('Envie um arquivo ou um comentário');
    }

    const submissions = readSubmissions(assignment.submissions);

    if (submissions.entries.length >= MAX_SUBMISSIONS) {
      throw new BadRequestException(
        `Limite de ${MAX_SUBMISSIONS} envios por tarefa atingido. Remova um envio anterior.`,
      );
    }

    const entry: SubmissionEntry = {
      id: newSubmissionId(),
      kind: dto.kind,
      note: dto.note ?? null,
      assetId: dto.assetId ?? null,
      url: dto.assetId
        ? await this.attachAsset(dto.assetId, student.userId, assignmentId)
        : null,
      submittedAt: new Date().toISOString(),
    };

    submissions.entries = [...submissions.entries, entry];

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        submissions: writeSubmissions(submissions),
        submissionDate: new Date(),
        status:
          assignment.status === AssignmentStatus.PENDING
            ? AssignmentStatus.IN_PROGRESS
            : undefined,
      },
      select: ASSIGNMENT_FULL_SELECT,
    });

    await this.notifications.notify({
      userId: assignment.lesson.teacher.userId,
      type: NotificationType.STUDENT_SUBMITTED_ASSIGNMENT,
      title: 'Nova submissão',
      message: `${this.studentName(assignment)} enviou material na tarefa "${assignment.title}".`,
      actionText: 'Ver submissão',
      actionUrl: `/teacher/assignments/${assignmentId}`,
      relatedEntityType: ASSET_ENTITY_TYPE,
      relatedEntityId: assignmentId,
    });

    await this.activities.record({
      userId: studentUserId,
      userType: 'student',
      action: SchoolActivityAction.ASSIGNMENT_SUBMISSION,
      entityType: 'assignment',
      entityId: assignmentId,
      entityName: assignment.title,
      title: 'Enviou material numa tarefa',
      metadata: { kind: dto.kind, hasFile: Boolean(dto.assetId) },
    });

    return this.toView(updated);
  }

  async removeSubmission(
    studentUserId: string,
    assignmentId: string,
    submissionId: string,
  ) {
    const { assignment } = await this.requireStudentOfAssignment(
      studentUserId,
      assignmentId,
    );

    if (assignment.isCompleted) {
      throw new BadRequestException('A tarefa já foi concluída');
    }

    const submissions = readSubmissions(assignment.submissions);
    const entry = submissions.entries.find((item) => item.id === submissionId);

    if (!entry) {
      throw new NotFoundException('Envio não encontrado');
    }

    if (entry.assetId) {
      await this.safeDeleteAsset(entry.assetId);
    }

    submissions.entries = submissions.entries.filter(
      (item) => item.id !== submissionId,
    );

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { submissions: writeSubmissions(submissions) },
      select: ASSIGNMENT_FULL_SELECT,
    });

    return this.toView(updated);
  }

  /**
   * Conclusão pelo aluno.
   *
   * `isCompleted`, `status` e `completedAt` são gravados juntos, sempre. O
   * legado deixava o aluno mandar `status: 'COMPLETED'` sem `isCompleted`, e
   * as duas coisas eram lidas por telas diferentes: a tarefa aparecia
   * concluída na lista e pendente no painel.
   */
  async complete(
    studentUserId: string,
    assignmentId: string,
    dto: CompleteAssignmentDto,
  ) {
    const { assignment } = await this.requireStudentOfAssignment(
      studentUserId,
      assignmentId,
    );

    if (assignment.isCompleted) {
      throw new BadRequestException('A tarefa já foi concluída');
    }

    const now = new Date();
    const submissions = readSubmissions(assignment.submissions);

    const updated = await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        isCompleted: true,
        status: AssignmentStatus.COMPLETED,
        completedAt: now,
        progress: 100,
        actualTime: dto.actualTime,
        studentNotes: dto.studentNotes,
        studentRating: dto.studentRating,
        submissionDate:
          assignment.submissionDate ??
          (submissions.entries.length > 0 ? now : null),
      },
      select: ASSIGNMENT_FULL_SELECT,
    });

    await this.notifications.notify({
      userId: assignment.lesson.teacher.userId,
      type: NotificationType.STUDENT_COMPLETED_ASSIGNMENT,
      title: 'Tarefa concluída',
      message: `${this.studentName(assignment)} concluiu a tarefa "${assignment.title}".`,
      actionText: 'Ver tarefa',
      actionUrl: `/teacher/assignments/${assignmentId}`,
      relatedEntityType: ASSET_ENTITY_TYPE,
      relatedEntityId: assignmentId,
    });

    await this.activities.record({
      userId: studentUserId,
      userType: 'student',
      action: SchoolActivityAction.ASSIGNMENT_COMPLETED,
      entityType: 'assignment',
      entityId: assignmentId,
      entityName: assignment.title,
      title: 'Concluiu uma tarefa',
      metadata: { actualTime: dto.actualTime ?? null },
    });

    return this.toView(updated);
  }

  // -------------------------------------------------------------------
  // Projeção
  // -------------------------------------------------------------------

  /**
   * `OVERDUE` é estado derivado, não guardado.
   *
   * O status persistido continua sendo o que o aluno e o professor mexem; o
   * atraso é uma comparação com o relógio, e calculá-lo na leitura evita
   * depender de um job que passe reescrevendo registro por registro.
   */
  private toView(assignment: AssignmentRow) {
    const now = Date.now();
    const isOverdue = Boolean(
      assignment.dueDate &&
        assignment.dueDate.getTime() < now &&
        !assignment.isCompleted,
    );

    const daysUntilDue = assignment.dueDate
      ? Math.ceil((assignment.dueDate.getTime() - now) / (1000 * 60 * 60 * 24))
      : null;

    const { submissions, ...rest } = assignment;

    return {
      ...rest,
      submissions: readSubmissions(submissions),
      isOverdue,
      daysUntilDue,
      effectiveStatus: isOverdue ? 'OVERDUE' : assignment.status,
    };
  }

  private describeChanges(
    before: AssignmentRow,
    dto: UpdateAssignmentDto,
  ): string[] {
    const changed: string[] = [];

    if (dto.title !== undefined && dto.title !== before.title) {
      changed.push('título');
    }

    if (
      dto.description !== undefined &&
      dto.description !== before.description
    ) {
      changed.push('descrição');
    }

    if (dto.dueDate !== undefined) {
      const next =
        dto.dueDate === null ? null : new Date(dto.dueDate).getTime();
      const current = before.dueDate ? before.dueDate.getTime() : null;

      if (next !== current) {
        changed.push('prazo');
      }
    }

    if (
      dto.worksIds !== undefined &&
      !this.sameIds(dto.worksIds, before.worksIds)
    ) {
      changed.push('obras');
    }

    if (
      dto.workScoreIds !== undefined &&
      !this.sameIds(dto.workScoreIds, before.workScoreIds)
    ) {
      changed.push('partituras');
    }

    return changed;
  }

  private sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
  }

  private teacherName(assignment: AssignmentRow): string {
    const user = assignment.lesson.teacher.user;
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  private studentName(assignment: AssignmentRow): string {
    const user = assignment.student.user;
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }

  // -------------------------------------------------------------------
  // Filtros e estatísticas
  // -------------------------------------------------------------------

  private buildBaseWhere(
    scope: { role: ParticipantRole; where: Prisma.AssignmentWhereInput },
    query: ListAssignmentsQueryDto,
  ): Prisma.AssignmentWhereInput {
    return {
      ...scope.where,
      ...(query.type ? { type: query.type } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.lessonId ? { lessonId: query.lessonId } : {}),
      // Filtrar por aluno só faz sentido para o professor. Se viesse do aluno,
      // sobrescreveria o recorte dele e abriria a tarefa de outra pessoa.
      ...(query.studentId && scope.role === 'teacher'
        ? { studentId: query.studentId }
        : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueDate: {
              ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
              ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
            },
          }
        : {}),
    };
  }

  /** `isCompleted` é a fonte de verdade da conclusão; `status` acompanha. */
  private statusCondition(
    status: ListAssignmentsQueryDto['status'],
  ): Prisma.AssignmentWhereInput {
    switch (status) {
      case 'COMPLETED':
        return { isCompleted: true };
      case 'OVERDUE':
        // `not: null` é necessário: no MongoDB o Prisma compara com `$lt`
        // em expressão, e `null` ordena antes de qualquer data — sem ele,
        // tarefa sem prazo aparecia como atrasada.
        return { isCompleted: false, dueDate: { lt: new Date(), not: null } };
      case 'PENDING':
        return { isCompleted: false, status: AssignmentStatus.PENDING };
      case 'IN_PROGRESS':
        return { isCompleted: false, status: AssignmentStatus.IN_PROGRESS };
      default:
        return {};
    }
  }

  private async computeStats(baseWhere: Prisma.AssignmentWhereInput) {
    const now = new Date();

    const [total, pending, inProgress, completed, overdue] = await Promise.all([
      this.prisma.assignment.count({ where: baseWhere }),
      this.prisma.assignment.count({
        where: {
          ...baseWhere,
          isCompleted: false,
          status: AssignmentStatus.PENDING,
        },
      }),
      this.prisma.assignment.count({
        where: {
          ...baseWhere,
          isCompleted: false,
          status: AssignmentStatus.IN_PROGRESS,
        },
      }),
      this.prisma.assignment.count({
        where: { ...baseWhere, isCompleted: true },
      }),
      this.prisma.assignment.count({
        // Sem prazo não é atrasada (ver `statusCondition`).
        where: {
          ...baseWhere,
          isCompleted: false,
          dueDate: { lt: now, not: null },
        },
      }),
    ]);

    return { total, pending, inProgress, completed, overdue };
  }

  // -------------------------------------------------------------------
  // Arquivos
  // -------------------------------------------------------------------

  /**
   * Vincula à tarefa um arquivo já enviado, e devolve a URL.
   *
   * Confirma a posse: `confirmUpload` responde 404 para arquivo de outra
   * pessoa. Sem isso bastaria descobrir o id de um envio alheio para anexá-lo
   * à própria tarefa.
   */
  private async attachAsset(
    assetId: string,
    ownerUserId: string,
    assignmentId: string,
  ): Promise<string | null> {
    const asset = await this.storage.confirmUpload(assetId, ownerUserId);

    await this.prisma.storedAsset.update({
      where: { id: asset.id },
      data: { entityType: ASSET_ENTITY_TYPE, entityId: assignmentId },
    });

    return asset.secureUrl;
  }

  /** Remove todos os arquivos da tarefa, sem deixar a limpeza travar a exclusão. */
  private async discardAssets(assignmentId: string): Promise<void> {
    try {
      await this.storage.deleteByEntity(ASSET_ENTITY_TYPE, assignmentId);
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao remover arquivos da tarefa ${assignmentId}: ${errorMessage(error)}`,
      );
    }
  }

  private async safeDeleteAsset(assetId: string): Promise<void> {
    try {
      const asset = await this.prisma.storedAsset.findUnique({
        where: { id: assetId },
        select: { status: true },
      });

      if (!asset || asset.status === StorageAssetStatus.DELETED) {
        return;
      }

      await this.storage.deleteAsset(assetId);
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao remover arquivo ${assetId}: ${errorMessage(error)}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------

  /**
   * Carrega a tarefa conferindo o papel de quem chamou.
   *
   * **Cada papel tem seu próprio filtro.** O legado usava um `OR` só, com
   * `lesson: { teacherId: userTeacherProfile?.id }` e
   * `studentId: userStudentProfile?.id`. Quem chama tem apenas um dos dois
   * perfis, então o outro id era `undefined` — e o Prisma descarta campo
   * `undefined`, transformando aquele ramo do `OR` em condição vazia, que
   * casa com tudo. Na prática qualquer professor ou aluno autenticado lia e
   * escrevia **qualquer tarefa da base**. É por isso que aqui não existe
   * `?.id` dentro de `where`: o perfil é exigido antes, e o filtro é montado
   * a partir de um id que já se sabe existir.
   */
  private async requireParticipant(
    userId: string,
    assignmentId: string,
  ): Promise<{ assignment: AssignmentRow; role: ParticipantRole }> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: ASSIGNMENT_FULL_SELECT,
    });

    if (!assignment) {
      throw new NotFoundException('Tarefa não encontrada');
    }

    if (assignment.lesson.teacher.userId === userId) {
      return { assignment, role: 'teacher' };
    }

    if (assignment.student.userId === userId) {
      return { assignment, role: 'student' };
    }

    // 404 e não 403: dizer "existe, mas não é sua" confirmaria o id.
    throw new NotFoundException('Tarefa não encontrada');
  }

  private async requireTeacherOfAssignment(
    userId: string,
    assignmentId: string,
  ): Promise<{ assignment: AssignmentRow }> {
    const { assignment, role } = await this.requireParticipant(
      userId,
      assignmentId,
    );

    if (role !== 'teacher') {
      throw new NotFoundException('Tarefa não encontrada');
    }

    return { assignment };
  }

  private async requireStudentOfAssignment(
    userId: string,
    assignmentId: string,
  ): Promise<{
    assignment: AssignmentRow;
    student: { id: string; userId: string };
  }> {
    const { assignment, role } = await this.requireParticipant(
      userId,
      assignmentId,
    );

    if (role !== 'student') {
      throw new ForbiddenException('Só o aluno da tarefa pode fazer isso');
    }

    return {
      assignment,
      student: { id: assignment.student.id, userId: assignment.student.userId },
    };
  }

  private async requireTeacher(userId: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId },
      select: { id: true, userId: true },
    });

    if (!teacher) {
      throw new ForbiddenException(
        'Você precisa de um perfil de professor para esta ação',
      );
    }

    return teacher;
  }

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
      select: { id: true },
    });

    if (!relationship) {
      throw new ForbiddenException(
        'Este aluno não está vinculado a você, ou o convite ainda não foi aceito',
      );
    }

    return relationship;
  }

  private async resolveScope(
    userId: string,
    as?: ParticipantRole,
  ): Promise<{ role: ParticipantRole; where: Prisma.AssignmentWhereInput }> {
    if (as !== 'student') {
      const teacher = await this.prisma.teacher.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (teacher) {
        return {
          role: 'teacher',
          where: { lesson: { is: { teacherId: teacher.id } } },
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

    return { role: 'student', where: { studentId: student.id } };
  }
}
