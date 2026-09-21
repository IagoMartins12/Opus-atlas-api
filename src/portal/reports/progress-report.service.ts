import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StudentInviteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressReportQueryDto, ReportSection } from './dto/report-query.dto';
import { PeerComparisonService } from './peer-comparison.service';
import { resolvePeriod, ResolvedPeriod } from './report-period';
import {
  LearnedFact,
  ReportInput,
  ReportSectionsService,
  WantToLearnFact,
} from './report-sections.service';

/** Campos que as seções consomem — declarados uma vez, usados nas duas cargas. */
const LESSON_FACT_SELECT = {
  id: true,
  status: true,
  scheduledAt: true,
  duration: true,
  engagement: true,
  preparation: true,
  punctuality: true,
  topics: true,
  techniques: true,
  challenges: true,
  improvements: true,
  skillsWorked: true,
  studentPresent: true,
} as const;

const ASSIGNMENT_FACT_SELECT = {
  id: true,
  type: true,
  status: true,
  isCompleted: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  estimatedTime: true,
  actualTime: true,
  teacherRating: true,
  studentRating: true,
} as const;

/**
 * Tetos de carga.
 *
 * O legado tinha os mesmos números, mas **truncava em silêncio**: pegava as 500
 * aulas mais recentes e apresentava as estatísticas como se cobrissem o período
 * inteiro. Aqui o corte é informado na resposta (`truncated`), para o relatório
 * não afirmar mais do que mediu.
 */
const MAX_LESSONS = 500;
const MAX_ASSIGNMENTS = 300;
const MAX_WORKS = 200;

const ALL_SECTIONS: ReportSection[] = [
  'overview',
  'attendance',
  'evolution',
  'assignments',
  'repertoire',
  'engagement',
  'insights',
  'comparison',
  'recommendations',
];

@Injectable()
export class ProgressReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sections: ReportSectionsService,
    private readonly peers: PeerComparisonService,
  ) {}

  /**
   * Gera o relatório de progresso de um aluno.
   *
   * Os dados são carregados **uma vez** e cada seção trabalha sobre eles em
   * memória. O legado repetia as mesmas consultas dentro de cada gerador — as
   * aulas do período eram lidas pelo menos quatro vezes por relatório.
   */
  async generate(
    teacherUserId: string,
    studentId: string,
    query: ProgressReportQueryDto,
  ) {
    const { teacher, student, relationship } = await this.requireAccess(
      teacherUserId,
      studentId,
    );

    const period = resolvePeriod({
      period: query.period,
      from: query.from,
      to: query.to,
      relationshipStart: relationship.startDate,
    });

    const wanted = new Set<ReportSection>(query.sections ?? ALL_SECTIONS);

    const input = await this.load(teacher.id, student.id, period);

    const overview = this.sections.overview(input);

    const report: Record<string, unknown> = { overview };

    if (wanted.has('attendance')) {
      report.attendance = this.sections.attendance(input);
    }

    if (wanted.has('evolution')) {
      report.evolution = this.sections.evolution(input);
    }

    if (wanted.has('assignments')) {
      report.assignments = this.sections.assignments(input);
    }

    if (wanted.has('repertoire')) {
      report.repertoire = this.sections.repertoire(input);
    }

    if (wanted.has('engagement')) {
      report.engagement = this.sections.engagement(input);
    }

    if (wanted.has('insights')) {
      report.insights = this.sections.insights(input);
    }

    if (wanted.has('comparison')) {
      const previousInput = await this.load(teacher.id, student.id, {
        ...period,
        start: period.previous.start,
        end: period.previous.end,
      });

      report.comparison = {
        ...this.sections.comparison(
          overview,
          this.sections.overview(previousInput),
        ),
        peers: await this.peers.compare({
          teacherId: teacher.id,
          studentId: student.id,
          level: student.level,
          start: period.start,
          end: period.end,
        }),
      };
    }

    if (wanted.has('recommendations')) {
      report.recommendations = await this.recommendations(student.id, input);
    }

    return {
      student: {
        id: student.id,
        userId: student.userId,
        name: this.fullName(student.user),
        image: student.user.image,
        level: student.level,
      },
      teacher: {
        id: teacher.id,
        userId: teacher.userId,
        name: this.fullName(teacher.user),
      },
      period: {
        start: period.start,
        end: period.end,
        label: period.label,
      },
      relationship: {
        startDate: relationship.startDate,
        isActive: relationship.isActive,
      },
      coverage: {
        lessons: input.lessons.length,
        assignments: input.assignments.length,
        truncated: {
          lessons: input.lessons.length >= MAX_LESSONS,
          assignments: input.assignments.length >= MAX_ASSIGNMENTS,
        },
      },
      sections: [...wanted],
      report,
      generatedAt: new Date(),
    };
  }

  /**
   * Sugestões de repertório.
   *
   * `studentAppeal` é quantos alunos da plataforma marcaram a obra como
   * "quero aprender". No legado era `Math.round(Math.random() * 30 + 70)`.
   */
  private async recommendations(studentId: string, input: ReportInput) {
    const learnedIds = new Set(input.learned.map((work) => work.workId));
    const wantedIds = input.wantToLearn.map((work) => work.workId);

    const candidates = await this.prisma.wantToLearn.groupBy({
      by: ['workId'],
      where: { workId: { notIn: [...learnedIds, ...wantedIds] } },
      _count: { _all: true },
      orderBy: { _count: { workId: 'desc' } },
      take: 10,
    });

    if (candidates.length === 0) {
      return { pieces: [], inProgress: input.wantToLearn.length };
    }

    const works = await this.prisma.work.findMany({
      where: { id: { in: candidates.map((row) => row.workId) } },
      select: {
        id: true,
        title: true,
        composer: { select: { id: true, name: true } },
      },
    });

    const appealByWork = new Map(
      candidates.map((row) => [row.workId, row._count._all]),
    );

    return {
      inProgress: input.wantToLearn.length,
      pieces: works.map((work) => ({
        workId: work.id,
        title: work.title,
        composer: work.composer.name,
        /** Quantos alunos da plataforma querem aprender esta obra. */
        studentAppeal: appealByWork.get(work.id) ?? 0,
      })),
    };
  }

  // -------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------

  private async load(
    teacherId: string,
    studentId: string,
    period: ResolvedPeriod,
  ): Promise<ReportInput> {
    // `Learned` e `WantToLearn` são do usuário, não do vínculo, então o
    // `userId` precisa ser resolvido antes das consultas de repertório.
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { userId: true },
    });

    const userId = student?.userId;

    const [lessons, assignments, learnedRows, wantToLearnRows] =
      await Promise.all([
        this.prisma.lesson.findMany({
          where: {
            teacherId,
            studentId,
            scheduledAt: { gte: period.start, lte: period.end },
          },
          select: LESSON_FACT_SELECT,
          orderBy: { scheduledAt: 'asc' },
          take: MAX_LESSONS,
        }),
        this.prisma.assignment.findMany({
          where: {
            studentId,
            lesson: { is: { teacherId } },
            createdAt: { gte: period.start, lte: period.end },
          },
          select: ASSIGNMENT_FACT_SELECT,
          orderBy: { createdAt: 'asc' },
          take: MAX_ASSIGNMENTS,
        }),
        userId
          ? this.prisma.learned.findMany({
              where: {
                userId,
                learnedAt: { gte: period.start, lte: period.end },
              },
              select: {
                learnedAt: true,
                mastery: true,
                wouldRecommend: true,
                work: {
                  select: {
                    id: true,
                    title: true,
                    difficultyLevel: true,
                    composer: { select: { name: true } },
                  },
                },
              },
              orderBy: { learnedAt: 'desc' },
              take: MAX_WORKS,
            })
          : [],
        userId
          ? this.prisma.wantToLearn.findMany({
              where: { userId },
              select: {
                addedAt: true,
                difficulty: true,
                work: {
                  select: {
                    id: true,
                    title: true,
                    composer: { select: { name: true } },
                  },
                },
              },
              orderBy: { addedAt: 'desc' },
              take: MAX_WORKS,
            })
          : [],
      ]);

    return {
      period,
      lessons,
      assignments,
      learned: learnedRows.map(
        (row): LearnedFact => ({
          learnedAt: row.learnedAt,
          mastery: row.mastery,
          wouldRecommend: row.wouldRecommend,
          workId: row.work.id,
          workTitle: row.work.title,
          composerName: row.work.composer.name,
          difficulty: row.work.difficultyLevel,
        }),
      ),
      wantToLearn: wantToLearnRows.map(
        (row): WantToLearnFact => ({
          addedAt: row.addedAt,
          workId: row.work.id,
          workTitle: row.work.title,
          composerName: row.work.composer.name,
          difficulty: row.difficulty,
        }),
      ),
    };
  }

  // -------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------

  /**
   * Só gera relatório quem é professor do aluno **agora**.
   *
   * O legado buscava o vínculo, trazia `isActive` no `select` e **nunca o
   * conferia** — bastava a linha existir. Um professor cujo convite tinha sido
   * recusado, ou cujo vínculo já havia sido encerrado, continuava puxando o
   * relatório completo do aluno: presença, engajamento, anotações e repertório.
   */
  private async requireAccess(teacherUserId: string, studentId: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId: teacherUserId },
      select: {
        id: true,
        userId: true,
        user: { select: { firstName: true, lastName: true } },
      },
    });

    if (!teacher) {
      throw new ForbiddenException(
        'Você precisa de um perfil de professor para esta ação',
      );
    }

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        userId: true,
        level: true,
        user: { select: { firstName: true, lastName: true, image: true } },
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno não encontrado');
    }

    const relationship = await this.prisma.teacherStudent.findFirst({
      where: {
        teacherId: teacher.id,
        studentId: student.id,
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      },
      select: { startDate: true, isActive: true },
    });

    if (!relationship) {
      throw new ForbiddenException(
        'Este aluno não está vinculado a você, ou o convite ainda não foi aceito',
      );
    }

    return { teacher, student, relationship };
  }

  private fullName(user: {
    firstName: string | null;
    lastName: string | null;
  }) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }
}
