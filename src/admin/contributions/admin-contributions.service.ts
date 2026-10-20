import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import { AppCacheService } from '../../common/cache/cache.service';
import { NOT_REVERTED } from '../../common/database/optional-fields';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import { escapeRegex } from '../../common/utils/regex.util';
import { ContributionsService } from '../../library/contributions/contributions.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListAdminContributionsQueryDto,
  RejectContributionDto,
} from './dto/admin-contributions.dto';

const REVERTED: Prisma.ContributionWhereInput = {
  revertedAt: { not: null },
};

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
} as const;

/**
 * Moderação das contribuições do acervo.
 *
 * Elas nascem aprovadas (valem na hora), e a equipe pode **reprovar** depois:
 * o valor antigo volta (se nada o substituiu desde então), o XP deixa de ser
 * devido ou é devolvido se já tinha sido pago, e o autor recebe o motivo.
 */
@Injectable()
export class AdminContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contributions: ContributionsService,
    private readonly cache: AppCacheService,
  ) {}

  async list(query: ListAdminContributionsQueryDto) {
    const status = query.status ?? 'live';
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const authors = search
      ? await this.prisma.user.findMany({
          where: {
            OR: ['firstName', 'lastName', 'username'].map((field) => ({
              [field]: { contains: escapeRegex(search), mode: 'insensitive' },
            })),
          },
          select: { id: true },
          take: 200,
        })
      : null;

    const base: Prisma.ContributionWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(authors ? { userId: { in: authors.map((a) => a.id) } } : {}),
    };
    const paging = pageArgs({ cursor: query.cursor, page: 1, limit });

    const [rows, live, reverted] = await Promise.all([
      this.prisma.contribution.findMany({
        where: { AND: [base, status === 'live' ? NOT_REVERTED : REVERTED] },
        include: { user: { select: USER_SELECT } },
        // O id desempata, ou o cursor pula e repete.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: paging.take,
        skip: paging.skip,
        cursor: paging.cursor,
      }),
      this.prisma.contribution.count({ where: { AND: [base, NOT_REVERTED] } }),
      this.prisma.contribution.count({ where: { AND: [base, REVERTED] } }),
    ]);

    const names = await this.entityNames(rows);
    const curiosities = await this.curiosityTexts(rows);

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        field: row.field,
        entityType: row.entityType,
        entityId: row.entityId,
        entityName: names.get(`${row.entityType}:${row.entityId}`) ?? null,
        before: row.before,
        after: row.after,
        curiosity: row.curiosityId
          ? (curiosities.get(row.curiosityId) ?? null)
          : null,
        source: row.source,
        xp: row.xp,
        xpGrantedAt: row.xpGrantedAt,
        revertedAt: row.revertedAt,
        createdAt: row.createdAt,
        author: {
          id: row.user.id,
          name:
            [row.user.firstName, row.user.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() || row.user.username,
          username: row.user.username,
          email: row.user.email,
        },
      })),
      counts: { live, reverted },
      nextCursor: nextCursorOf(rows, limit),
    };
  }

  /**
   * Reprova: desfaz o efeito, cancela ou devolve o XP e avisa o autor.
   * `xpReturned` diz o que voltou, para a tela mostrar ("12 XP devolvidos").
   */
  async reject(id: string, dto: RejectContributionDto) {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        kind: true,
        curiosityId: true,
        xp: true,
        xpGrantedAt: true,
        revertedAt: true,
        entityType: true,
        entityId: true,
      },
    });
    if (!contribution) {
      throw new NotFoundException('Contribuição não encontrada');
    }
    if (contribution.revertedAt) {
      throw new BadRequestException('Esta contribuição já foi reprovada.');
    }

    const xpReturned = contribution.xpGrantedAt ? contribution.xp : 0;

    if (contribution.curiosityId) {
      await this.contributions.deleteCuriosity(contribution.curiosityId);
    } else {
      await this.contributions.revert(id, true);
    }
    await this.cache.invalidateMany(CATALOG_NAMESPACES);

    await this.contributions.notifyRejected(
      contribution.userId,
      id,
      dto.reason,
      xpReturned,
    );

    return { id, xpReturned };
  }

  private async entityNames(
    rows: { entityType: string; entityId: string }[],
  ): Promise<Map<string, string>> {
    const ids = (type: string) => [
      ...new Set(
        rows.filter((r) => r.entityType === type).map((r) => r.entityId),
      ),
    ];
    const [composers, works] = await Promise.all([
      this.prisma.composer.findMany({
        where: { id: { in: ids('composer') } },
        select: { id: true, name: true },
      }),
      this.prisma.work.findMany({
        where: { id: { in: ids('work') } },
        select: { id: true, title: true },
      }),
    ]);
    return new Map<string, string>([
      ...composers.map((c) => [`composer:${c.id}`, c.name] as const),
      ...works.map((w) => [`work:${w.id}`, w.title] as const),
    ]);
  }

  private async curiosityTexts(
    rows: { curiosityId: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = rows.flatMap((r) => (r.curiosityId ? [r.curiosityId] : []));
    if (!ids.length) return new Map();
    const found = await this.prisma.composerCuriosity.findMany({
      where: { id: { in: ids } },
      select: { id: true, text: true },
    });
    return new Map(found.map((c) => [c.id, c.text]));
  }
}
