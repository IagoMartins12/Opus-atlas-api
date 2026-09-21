import { Injectable } from '@nestjs/common';
import {
  LessonStatus,
  Prisma,
  SchoolActivityAction,
  TeacherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toJsonInput } from '../../common/utils/json.util';
import { SchoolActivitiesService } from '../school-activities/school-activities.service';
import {
  UpdateStudentProfileDto,
  UpdateTeacherProfileDto,
} from './dto/role-profile.dto';

const STUDENT_SELECT = {
  id: true,
  userId: true,
  level: true,
  mainInstrument: true,
  musicalGoals: true,
  preferredGenres: true,
  musicalBackground: true,
  allowPublicProgress: true,
  allowProgressShare: true,
  allowWhatsappMensage: true,
  profileVisibility: true,
  practiceTime: true,
  practiceSchedule: true,
  learningPace: true,
  specialNeeds: true,
  status: true,
  enrollmentDate: true,
  lastLessonAt: true,
  lastActiveAt: true,
  preferredContact: true,
  reminderPreferences: true,
  totalLessonsAttended: true,
  totalAssignments: true,
  completedAssignments: true,
  currentStreak: true,
  longestStreak: true,
  progressScore: true,
  createdAt: true,
  updatedAt: true,
} as const;

const TEACHER_SELECT = {
  id: true,
  userId: true,
  bio: true,
  publicBio: true,
  specialties: true,
  instruments: true,
  ageGroups: true,
  skillLevels: true,
  highlightedWorks: true,
  experience: true,
  education: true,
  achievements: true,
  teachingMethod: true,
  isPublicProfile: true,
  profileImage: true,
  website: true,
  socialMedia: true,
  allowProgressReports: true,
  reportPreferences: true,
  defaultLessonDuration: true,
  maxStudentsPerWeek: true,
  timezone: true,
  status: true,
  isVerified: true,
  verifiedAt: true,
  totalStudents: true,
  totalLessons: true,
  averageRating: true,
  totalReviews: true,
  completionRate: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ProfileRoles {
  isTeacher: boolean;
  isStudent: boolean;
}

/**
 * Perfil de professor e de aluno — a parte do portal no perfil da conta.
 *
 * **Não tem rota própria.** Quem responde é `GET`/`PATCH /profile` e
 * `POST /profile/onboarding` (módulo de perfil), que montam a resposta com as
 * seções daqui. Antes eram dois `PATCH /profile` em dois controllers — e o
 * do portal nunca respondia, porque o módulo de perfil registrava primeiro.
 */
@Injectable()
export class PortalProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: SchoolActivitiesService,
  ) {}

  // -------------------------------------------------------------------
  // Seções
  // -------------------------------------------------------------------

  /**
   * Perfil de professor e seus alunos.
   *
   * **Cria o perfil se ele ainda não existir**, como no legado — é o que
   * permite a primeira visita ao portal funcionar sem etapa explícita de
   * provisionamento. Quem chama só pede a seção para conta de professor.
   */
  async teacherSection(userId: string) {
    const { profile, created } = await this.ensureTeacher(userId);

    return {
      profile,
      isNew: created,
      students: await this.teacherRelationships(profile.id),
    };
  }

  /** Perfil de aluno e seus professores — mesma regra de criação. */
  async studentSection(userId: string) {
    const { profile, created } = await this.ensureStudent(userId);

    return {
      profile,
      isNew: created,
      teachers: await this.studentRelationships(profile.id),
    };
  }

  /**
   * Registra na trilha escolar o que foi alterado, sem os valores.
   *
   * Só os nomes dos campos: a trilha é histórico de ação, não cópia do
   * conteúdo — guardar telefone e endereço antigos aqui seria duplicar dado
   * pessoal num segundo lugar. Conta sem papel no portal não tem trilha.
   */
  async recordProfileChange(
    userId: string,
    roles: ProfileRoles,
    changed: Record<string, string[]>,
  ): Promise<void> {
    if (!roles.isTeacher && !roles.isStudent) {
      return;
    }

    const userType = changed.professor
      ? 'teacher'
      : changed.aluno
        ? 'student'
        : roles.isTeacher
          ? 'teacher'
          : 'student';

    await this.activities.record({
      userId,
      userType,
      action: changed.professor
        ? SchoolActivityAction.TEACHER_PROFILE_UPDATED
        : changed.aluno
          ? SchoolActivityAction.STUDENT_PROFILE_UPDATED
          : SchoolActivityAction.USER_PROFILE_UPDATED,
      entityType: 'profile',
      title: 'Atualizou o perfil',
      changes: changed,
    });
  }

  // -------------------------------------------------------------------
  // Vínculos
  // -------------------------------------------------------------------

  /**
   * Professores do aluno.
   *
   * `totalLessons` vem do contador já mantido em `TeacherStudent`, e a próxima
   * aula sai de **uma** consulta para todos os vínculos. O legado disparava
   * duas consultas por professor dentro de um `map` — o mesmo padrão que
   * aparecia nos painéis.
   */
  private async studentRelationships(studentId: string) {
    const relationships = await this.prisma.teacherStudent.findMany({
      where: { studentId },
      select: {
        id: true,
        isActive: true,
        inviteStatus: true,
        startDate: true,
        endDate: true,
        maxLessonsPerWeek: true,
        lessonDuration: true,
        totalLessons: true,
        teacher: {
          select: {
            id: true,
            userId: true,
            specialties: true,
            instruments: true,
            isVerified: true,
            user: { select: { firstName: true, lastName: true, image: true } },
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    const nextByTeacher = await this.nextLessonBy(
      'teacherId',
      { studentId },
      relationships.map((rel) => rel.teacher.id),
    );

    return relationships.map((rel) => ({
      relationshipId: rel.id,
      teacherId: rel.teacher.id,
      userId: rel.teacher.userId,
      name: this.fullName(rel.teacher.user),
      image: rel.teacher.user.image,
      specialties: rel.teacher.specialties,
      instruments: rel.teacher.instruments,
      isVerified: rel.teacher.isVerified,
      isActive: rel.isActive,
      inviteStatus: rel.inviteStatus,
      startDate: rel.startDate,
      endDate: rel.endDate,
      maxLessonsPerWeek: rel.maxLessonsPerWeek,
      lessonDuration: rel.lessonDuration,
      totalLessons: rel.totalLessons,
      nextLessonAt: nextByTeacher.get(rel.teacher.id) ?? null,
    }));
  }

  private async teacherRelationships(teacherId: string) {
    const relationships = await this.prisma.teacherStudent.findMany({
      where: { teacherId },
      select: {
        id: true,
        isActive: true,
        inviteStatus: true,
        startDate: true,
        endDate: true,
        maxLessonsPerWeek: true,
        lessonDuration: true,
        totalLessons: true,
        student: {
          select: {
            id: true,
            userId: true,
            level: true,
            mainInstrument: true,
            user: { select: { firstName: true, lastName: true, image: true } },
          },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    const nextByStudent = await this.nextLessonBy(
      'studentId',
      { teacherId },
      relationships.map((rel) => rel.student.id),
    );

    return relationships.map((rel) => ({
      relationshipId: rel.id,
      studentId: rel.student.id,
      userId: rel.student.userId,
      name: this.fullName(rel.student.user),
      image: rel.student.user.image,
      level: rel.student.level,
      mainInstrument: rel.student.mainInstrument,
      isActive: rel.isActive,
      inviteStatus: rel.inviteStatus,
      startDate: rel.startDate,
      endDate: rel.endDate,
      maxLessonsPerWeek: rel.maxLessonsPerWeek,
      lessonDuration: rel.lessonDuration,
      totalLessons: rel.totalLessons,
      nextLessonAt: nextByStudent.get(rel.student.id) ?? null,
    }));
  }

  /** Próxima aula de cada contraparte, numa consulta só. */
  private async nextLessonBy(
    groupField: 'teacherId' | 'studentId',
    scope: Prisma.LessonWhereInput,
    ids: string[],
  ): Promise<Map<string, Date>> {
    if (ids.length === 0) {
      return new Map();
    }

    const lessons = await this.prisma.lesson.findMany({
      where: {
        ...scope,
        [groupField]: { in: ids },
        status: LessonStatus.SCHEDULED,
        scheduledAt: { gte: new Date() },
      },
      select: { teacherId: true, studentId: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' },
    });

    const next = new Map<string, Date>();

    // A lista vem ordenada, então a primeira ocorrência de cada id já é a
    // próxima aula dele.
    for (const lesson of lessons) {
      const key = lesson[groupField];

      if (!next.has(key)) {
        next.set(key, lesson.scheduledAt);
      }
    }

    return next;
  }

  // -------------------------------------------------------------------
  // Provisionamento
  // -------------------------------------------------------------------

  /**
   * A corrida é tratada: duas chamadas simultâneas — o que acontece sempre
   * que a tela dispara duas requisições ao montar — batiam no índice único de
   * `userId` e a segunda respondia 500. Aqui a violação é capturada e o perfil
   * recém-criado pelo outro pedido é relido.
   */
  async ensureStudent(userId: string) {
    const existing = await this.prisma.student.findUnique({
      where: { userId },
      select: STUDENT_SELECT,
    });

    if (existing) {
      return { profile: existing, created: false };
    }

    try {
      const profile = await this.prisma.student.create({
        data: { userId },
        select: STUDENT_SELECT,
      });

      return { profile, created: true };
    } catch (error: unknown) {
      return {
        profile: await this.rereadAfterRace(error, () =>
          this.prisma.student.findUnique({
            where: { userId },
            select: STUDENT_SELECT,
          }),
        ),
        created: false,
      };
    }
  }

  async ensureTeacher(userId: string) {
    const existing = await this.prisma.teacher.findUnique({
      where: { userId },
      select: TEACHER_SELECT,
    });

    if (existing) {
      return { profile: existing, created: false };
    }

    try {
      const profile = await this.prisma.teacher.create({
        // O professor nasce pendente e não verificado. Quem muda isso é o
        // admin, nunca o próprio professor.
        data: { userId, status: TeacherStatus.PENDING, isVerified: false },
        select: TEACHER_SELECT,
      });

      return { profile, created: true };
    } catch (error: unknown) {
      return {
        profile: await this.rereadAfterRace(error, () =>
          this.prisma.teacher.findUnique({
            where: { userId },
            select: TEACHER_SELECT,
          }),
        ),
        created: false,
      };
    }
  }

  /**
   * Relê o registro quando a criação perdeu a corrida.
   *
   * `P2002` aqui só pode ser o índice único de `userId`, ou seja: outra
   * requisição criou o perfil entre a leitura e a escrita. Qualquer outro erro
   * sobe.
   */
  private async rereadAfterRace<T>(
    error: unknown,
    reread: () => Promise<T | null>,
  ): Promise<T> {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      throw error;
    }

    const profile = await reread();

    if (!profile) {
      throw error;
    }

    return profile;
  }

  // -------------------------------------------------------------------
  // Conversão
  // -------------------------------------------------------------------

  /**
   * Campos do aluno a gravar.
   *
   * **Valor inválido já virou 400 no DTO**, não silêncio: no legado, um
   * `level` fora da lista simplesmente não entrava na escrita, e a resposta
   * vinha 200 com o valor antigo.
   */
  studentData(dto: UpdateStudentProfileDto): Prisma.StudentUpdateInput {
    return {
      level: dto.level,
      mainInstrument: this.nullIfBlank(dto.mainInstrument),
      musicalGoals: this.nullIfBlank(dto.musicalGoals),
      preferredGenres: dto.preferredGenres,
      musicalBackground: this.nullIfBlank(dto.musicalBackground),
      allowPublicProgress: dto.allowPublicProgress,
      allowProgressShare: dto.allowProgressShare,
      allowWhatsappMensage: dto.allowWhatsappMensage,
      profileVisibility: dto.profileVisibility,
      practiceTime: dto.practiceTime,
      practiceSchedule: toJsonInput(dto.practiceSchedule),
      learningPace: this.nullIfBlank(dto.learningPace),
      specialNeeds: this.nullIfBlank(dto.specialNeeds),
      preferredContact: dto.preferredContact,
      reminderPreferences: toJsonInput(dto.reminderPreferences),
    };
  }

  teacherData(dto: UpdateTeacherProfileDto): Prisma.TeacherUpdateInput {
    return {
      bio: this.nullIfBlank(dto.bio),
      publicBio: this.nullIfBlank(dto.publicBio),
      specialties: dto.specialties,
      instruments: dto.instruments,
      ageGroups: dto.ageGroups,
      skillLevels: dto.skillLevels,
      highlightedWorks: dto.highlightedWorks,
      experience: this.nullIfBlank(dto.experience),
      education: this.nullIfBlank(dto.education),
      achievements: this.nullIfBlank(dto.achievements),
      teachingMethod: this.nullIfBlank(dto.teachingMethod),
      isPublicProfile: dto.isPublicProfile,
      allowProgressReports: dto.allowProgressReports,
      website: this.nullIfBlank(dto.website),
      socialMedia: toJsonInput(dto.socialMedia),
      reportPreferences: toJsonInput(dto.reportPreferences),
      defaultLessonDuration: dto.defaultLessonDuration,
      maxStudentsPerWeek: dto.maxStudentsPerWeek,
      timezone: dto.timezone,
    };
  }

  /**
   * Campo de texto vazio vira `null`.
   *
   * Guardar `''` faz o campo parecer preenchido em toda checagem de presença,
   * e era o comportamento do legado apenas para quatro campos escolhidos a
   * dedo. Aqui vale para todos os opcionais de texto.
   */
  private nullIfBlank(value: string | undefined): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private fullName(user: {
    firstName: string | null;
    lastName: string | null;
  }) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }
}

export type TeacherSection = Awaited<
  ReturnType<PortalProfileService['teacherSection']>
>;
export type StudentSection = Awaited<
  ReturnType<PortalProfileService['studentSection']>
>;
