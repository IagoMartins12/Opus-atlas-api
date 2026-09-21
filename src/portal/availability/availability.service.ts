import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LessonStatus, StudentInviteStatus } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { isValidTimeZone } from '../../common/utils/time-zone';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAvailabilityBlockDto,
  FreeSlotsQueryDto,
  ReplaceAvailabilityDto,
} from './dto/availability.dto';
import { freeTime, Interval, weeklyProblems } from './free-slots';

/** Janela máxima de horas livres calculada de uma vez. */
const MAX_WINDOW_DAYS = 92;

/** Bloqueio mais longo aceito — um ano sabático, não uma ausência eterna. */
const MAX_BLOCK_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_MIN_MINUTES = 30;

/**
 * Disponibilidade do professor e horas livres.
 *
 * **O legado inventava a disponibilidade** — cinco dias por semana, oito horas
 * por dia — e mostrava as "horas livres" que saíam dessa conta como se fossem
 * dado. Aqui o professor declara a agenda semanal e os períodos em que não
 * atende, e as horas livres são essa agenda menos os bloqueios menos as aulas
 * marcadas. Sem agenda declarada, a resposta é `null`, não um número.
 *
 * A disponibilidade **informa, não impede**: o professor continua podendo
 * marcar aula fora dela (uma reposição num sábado não precisa virar agenda).
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(userId: string) {
    const teacher = await this.requireTeacher(userId);
    return this.describe(teacher.id, teacher.timezone);
  }

  /**
   * Substitui a agenda semanal inteira.
   *
   * Uma escrita só, em vez de criar e apagar janela por janela: a tela de
   * agenda edita a semana toda, e o que importa validar — sobreposição — é uma
   * propriedade do conjunto, não de uma janela.
   */
  async replaceWeekly(userId: string, dto: ReplaceAvailabilityDto) {
    const teacher = await this.requireTeacher(userId);
    const problems = weeklyProblems(dto.slots);

    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }

    if (dto.timezone !== undefined && !isValidTimeZone(dto.timezone)) {
      throw new BadRequestException(
        `Fuso desconhecido: "${dto.timezone}". Use um fuso IANA, como America/Sao_Paulo.`,
      );
    }

    const timezone = dto.timezone ?? teacher.timezone;

    await this.prisma.$transaction([
      this.prisma.teacherAvailability.deleteMany({
        where: { teacherId: teacher.id },
      }),
      // `createMany` com lista vazia falha no MongoDB — e lista vazia é o jeito
      // de apagar a agenda.
      ...(dto.slots.length > 0
        ? [
            this.prisma.teacherAvailability.createMany({
              data: dto.slots.map((slot) => ({
                teacherId: teacher.id,
                weekday: slot.weekday,
                startTime: slot.startTime,
                endTime: slot.endTime,
              })),
            }),
          ]
        : []),
      ...(timezone !== teacher.timezone
        ? [
            this.prisma.teacher.update({
              where: { id: teacher.id },
              data: { timezone },
            }),
          ]
        : []),
    ]);

    return this.describe(teacher.id, timezone);
  }

  async addBlock(userId: string, dto: CreateAvailabilityBlockDto) {
    const teacher = await this.requireTeacher(userId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException('O bloqueio termina antes de começar');
    }

    if (endsAt.getTime() - startsAt.getTime() > MAX_BLOCK_DAYS * DAY_MS) {
      throw new BadRequestException(
        `Um bloqueio vai até ${MAX_BLOCK_DAYS} dias`,
      );
    }

    return this.prisma.teacherAvailabilityBlock.create({
      data: {
        teacherId: teacher.id,
        startsAt,
        endsAt,
        reason: dto.reason?.trim() || null,
      },
      select: { id: true, startsAt: true, endsAt: true, reason: true },
    });
  }

  async removeBlock(userId: string, blockId: string) {
    const teacher = await this.requireTeacher(userId);

    // Bloqueio de outro professor responde como inexistente: não confirma que
    // o id existe.
    const { count } = isMongoId(blockId)
      ? await this.prisma.teacherAvailabilityBlock.deleteMany({
          where: { id: blockId, teacherId: teacher.id },
        })
      : { count: 0 };

    if (count === 0) {
      throw new NotFoundException('Bloqueio não encontrado');
    }
  }

  /**
   * Horas livres de um professor, para ele mesmo ou para um aluno dele.
   *
   * O aluno com vínculo aceito e ativo vê os horários livres do professor —
   * é o que permite pedir aula num horário que existe. Quem não é aluno dele
   * não vê a agenda de ninguém.
   */
  async freeSlotsOf(
    viewerUserId: string,
    teacherUserId: string,
    query: FreeSlotsQueryDto,
  ) {
    const teacher = isMongoId(teacherUserId)
      ? await this.prisma.teacher.findUnique({
          where: { userId: teacherUserId },
          select: { id: true, userId: true, timezone: true },
        })
      : null;

    if (!teacher) {
      throw new NotFoundException('Professor não encontrado');
    }

    if (viewerUserId !== teacher.userId) {
      const link = await this.prisma.teacherStudent.findFirst({
        where: {
          teacherId: teacher.id,
          isActive: true,
          inviteStatus: StudentInviteStatus.ACCEPTED,
          student: { is: { userId: viewerUserId } },
        },
        select: { id: true },
      });

      if (!link) {
        throw new ForbiddenException(
          'Só o professor e os alunos dele veem os horários livres',
        );
      }
    }

    const from = new Date(query.from);
    const to = new Date(query.to);

    if (to <= from) {
      throw new BadRequestException('`to` precisa ser posterior a `from`');
    }

    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw new BadRequestException(
        `A janela de horas livres é de no máximo ${MAX_WINDOW_DAYS} dias`,
      );
    }

    const result = await this.computeFreeTime(
      teacher.id,
      teacher.timezone,
      from,
      to,
      query.minMinutes ?? DEFAULT_MIN_MINUTES,
    );

    return {
      timezone: teacher.timezone,
      period: { from, to },
      freeHours: result.hours,
      slots: result.slots,
    };
  }

  /**
   * As horas livres num período — usado também pelo calendário.
   *
   * Carrega todas as aulas não canceladas do professor no período, sem o
   * filtro de aluno que o calendário possa ter: horário ocupado por um aluno
   * não está livre para outro.
   */
  async computeFreeTime(
    teacherId: string,
    timeZone: string,
    from: Date,
    to: Date,
    minMinutes = DEFAULT_MIN_MINUTES,
  ): Promise<{ slots: Interval[]; hours: number | null }> {
    const [slots, blocks, lessons] = await Promise.all([
      this.prisma.teacherAvailability.findMany({
        where: { teacherId },
        select: { weekday: true, startTime: true, endTime: true },
      }),
      this.prisma.teacherAvailabilityBlock.findMany({
        where: { teacherId, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.lesson.findMany({
        where: {
          teacherId,
          status: { not: LessonStatus.CANCELLED },
          // Uma aula começada antes do período ainda pode ocupar o início dele.
          scheduledAt: { gte: new Date(from.getTime() - DAY_MS), lt: to },
        },
        select: { scheduledAt: true, duration: true },
      }),
    ]);

    return freeTime({
      slots,
      blocks: blocks.map((block) => ({
        start: block.startsAt,
        end: block.endsAt,
      })),
      lessons,
      from,
      to,
      timeZone,
      now: new Date(),
      minMinutes,
    });
  }

  // -------------------------------------------------------------------

  private async requireTeacher(userId: string) {
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId },
      select: { id: true, timezone: true },
    });

    if (!teacher) {
      throw new ForbiddenException('Você não tem perfil de professor');
    }

    return teacher;
  }

  private async describe(teacherId: string, timezone: string) {
    const [slots, blocks] = await Promise.all([
      this.prisma.teacherAvailability.findMany({
        where: { teacherId },
        select: { weekday: true, startTime: true, endTime: true },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      }),
      // Só os que ainda importam; bloqueio passado é história.
      this.prisma.teacherAvailabilityBlock.findMany({
        where: { teacherId, endsAt: { gt: new Date() } },
        select: { id: true, startsAt: true, endsAt: true, reason: true },
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    return { timezone, slots, blocks };
  }
}
