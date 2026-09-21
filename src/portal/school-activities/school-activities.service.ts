import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SchoolActivityAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../../common/utils/error.util';
import { toJsonInput } from '../../common/utils/json.util';
import {
  ExportActivitiesQueryDto,
  ListActivitiesQueryDto,
} from './dto/list-activities-query.dto';
import { toCsv } from '../../common/utils/csv.util';

/** Teto da exportação, para não montar um arquivo sem fim em memória. */
const MAX_EXPORT_ROWS = 5000;

/** Quantas entidades relacionadas resolver por página. */
const ENRICH_BATCH = 100;

export interface RecordActivityInput {
  userId: string;
  userType: 'teacher' | 'student';
  action: SchoolActivityAction;
  entityType: string;
  entityId?: string;
  entityName?: string;
  title: string;
  description?: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const ACTIVITY_SELECT = {
  id: true,
  userId: true,
  userType: true,
  action: true,
  entityType: true,
  entityId: true,
  entityName: true,
  title: true,
  description: true,
  changes: true,
  metadata: true,
  createdAt: true,
} as const;

type ActivityRow = Prisma.SchoolActivityGetPayload<{
  select: typeof ACTIVITY_SELECT;
}>;

@Injectable()
export class SchoolActivitiesService {
  private readonly logger = new Logger(SchoolActivitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Registro
  // -------------------------------------------------------------------

  /**
   * Registra uma ação na trilha escolar.
   *
   * **Nunca lança**, pelo mesmo motivo de `NotificationsService.notify`: a
   * trilha é efeito colateral de uma ação de negócio que já aconteceu, e falhar
   * aqui não pode desfazer o agendamento de uma aula nem devolver erro a quem a
   * agendou.
   *
   * No legado cada rota instanciava um `TeacherActivityLogger` ou
   * `StudentActivityLogger` e montava o texto da atividade à mão, o que
   * espalhou o formato por dezenas de arquivos. Aqui há um ponto só, chamado
   * pelos serviços de domínio.
   */
  async record(input: RecordActivityInput): Promise<void> {
    try {
      await this.prisma.schoolActivity.create({
        data: {
          userId: input.userId,
          userType: input.userType,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          entityName: input.entityName,
          title: input.title,
          description: input.description,
          changes: toJsonInput(input.changes),
          metadata: toJsonInput(input.metadata),
        },
      });
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao registrar atividade ${input.action} de ${input.userId}: ${errorMessage(error)}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------

  /**
   * Trilha de quem chamou.
   *
   * **Sem filtro de papel por padrão.** O legado derivava `userType` do papel
   * da sessão e filtrava por ele, então quem é aluno e professor ao mesmo tempo
   * via só metade da própria trilha — o mesmo problema das duas caixas de
   * entrada que as notificações tinham.
   */
  async list(userId: string, query: ListActivitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = this.buildWhere(userId, query);

    const [activities, total] = await Promise.all([
      this.prisma.schoolActivity.findMany({
        where,
        select: ACTIVITY_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.schoolActivity.count({ where }),
    ]);

    return {
      activities: await this.enrich(activities),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      ...(query.stats ? { stats: await this.stats(userId, query) } : {}),
    };
  }

  /**
   * Resumo por ação e por entidade.
   *
   * Fica atrás de `stats=true`: são quatro agregações, e o legado as executava
   * em toda listagem, inclusive nas que só queriam as cinco atividades
   * recentes de um painel.
   */
  async stats(userId: string, query: ListActivitiesQueryDto) {
    const where = this.buildWhere(userId, query);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, last24h, byAction, byEntity] = await Promise.all([
      this.prisma.schoolActivity.count({ where }),
      this.prisma.schoolActivity.count({
        where: { ...where, createdAt: { gte: since } },
      }),
      this.prisma.schoolActivity.groupBy({
        by: ['action'],
        where,
        _count: { _all: true },
      }),
      this.prisma.schoolActivity.groupBy({
        by: ['entityType'],
        where,
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      last24h,
      byAction: Object.fromEntries(
        byAction.map((row) => [row.action, row._count._all]),
      ),
      byEntityType: Object.fromEntries(
        byEntity.map((row) => [row.entityType, row._count._all]),
      ),
    };
  }

  /**
   * Exporta a trilha.
   *
   * O CSV passa por escape de verdade: o legado envolvia cada campo em aspas
   * sem duplicar as internas e sem neutralizar prefixo de fórmula, então um
   * título de aula podia quebrar o arquivo ou virar fórmula executável na
   * planilha de quem o abrisse.
   */
  async export(userId: string, query: ExportActivitiesQueryDto) {
    const where = this.buildWhere(userId, query);

    const activities = await this.prisma.schoolActivity.findMany({
      where,
      select: ACTIVITY_SELECT,
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT_ROWS,
    });

    if (query.format !== 'csv') {
      return {
        activities,
        count: activities.length,
        truncated: activities.length >= MAX_EXPORT_ROWS,
        exportedAt: new Date(),
      };
    }

    const csv = toCsv(
      ['Data', 'Papel', 'Ação', 'Entidade', 'Nome', 'Título', 'Descrição'],
      activities.map((activity) => [
        activity.createdAt,
        activity.userType,
        activity.action,
        activity.entityType,
        activity.entityName,
        activity.title,
        activity.description,
      ]),
    );

    return { csv, count: activities.length };
  }

  // -------------------------------------------------------------------
  // Enriquecimento
  // -------------------------------------------------------------------

  /**
   * Anexa o nome atual de cada entidade citada.
   *
   * **Uma consulta por tipo, não uma por atividade.** O legado resolvia dentro
   * de um `map`: uma página de 20 atividades disparava até 20 consultas
   * adicionais. Aqui os ids são agrupados por tipo e resolvidos em lote.
   *
   * Aluno é resolvido pelo perfil, e a projeção traz só nome e imagem — o
   * legado buscava o `User` e caía para o **e-mail** como texto de exibição
   * quando o nome estava vazio, publicando o endereço na trilha.
   */
  private async enrich(activities: ActivityRow[]) {
    const idsByType = new Map<string, Set<string>>();

    for (const activity of activities.slice(0, ENRICH_BATCH)) {
      if (!activity.entityId) {
        continue;
      }

      const bucket = idsByType.get(activity.entityType) ?? new Set<string>();
      bucket.add(activity.entityId);
      idsByType.set(activity.entityType, bucket);
    }

    const [lessons, assignments, students] = await Promise.all([
      this.namesFor(idsByType.get('lesson'), (ids) =>
        this.prisma.lesson.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, scheduledAt: true, status: true },
        }),
      ),
      this.namesFor(idsByType.get('assignment'), (ids) =>
        this.prisma.assignment.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, dueDate: true, status: true },
        }),
      ),
      this.namesFor(idsByType.get('student'), (ids) =>
        this.prisma.student.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            user: { select: { firstName: true, lastName: true, image: true } },
          },
        }),
      ),
    ]);

    return activities.map((activity) => {
      const entity = activity.entityId
        ? (lessons.get(activity.entityId) ??
          assignments.get(activity.entityId) ??
          students.get(activity.entityId) ??
          null)
        : null;

      return {
        ...activity,
        // `entityName` guardado no registro é o nome de quando a ação
        // aconteceu; `entity` é o estado atual, e é `null` se foi removida.
        entity,
        entityExists: entity !== null || activity.entityId === null,
        changedFields: this.changedFields(activity.changes),
      };
    });
  }

  private async namesFor<T extends { id: string }>(
    ids: Set<string> | undefined,
    load: (ids: string[]) => Promise<T[]>,
  ): Promise<Map<string, T>> {
    if (!ids || ids.size === 0) {
      return new Map();
    }

    const rows = await load([...ids]);

    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Lista os campos alterados.
   *
   * O legado devolvia a frase pronta ("3 campos alterados"), que é decisão de
   * apresentação — e em português, fixo no servidor.
   */
  private changedFields(changes: Prisma.JsonValue | null): string[] {
    if (
      typeof changes !== 'object' ||
      changes === null ||
      Array.isArray(changes)
    ) {
      return [];
    }

    return Object.keys(changes);
  }

  // -------------------------------------------------------------------

  private buildWhere(
    userId: string,
    query: ListActivitiesQueryDto | ExportActivitiesQueryDto,
  ): Prisma.SchoolActivityWhereInput {
    const as = 'as' in query ? query.as : undefined;

    return {
      userId,
      ...(as ? { userType: as } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }
}
