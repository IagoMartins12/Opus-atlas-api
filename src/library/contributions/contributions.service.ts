import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContributionKind,
  CuriositySource,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CATALOG_NAMESPACES } from '../../common/cache/cache-keys';
import {
  NOT_HIDDEN,
  NOT_REVERTED,
} from '../../common/database/optional-fields';
import { composerDateParts } from '../../common/dates/loose-date';
import { ActivityTracker } from '../../common/events/activity-tracker.service';
import { NotificationsService } from '../../portal/notifications/notifications.service';
import { ComposerBioService } from '../../catalog/composers/composer-bio.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ContributableEntity,
  DAILY_XP_CONTRIBUTIONS,
  fieldRule,
  XP_BY_KIND,
  XP_WAIT_DAYS,
} from './contribution-rules';
import {
  CreateContributionDto,
  CreateCuriosityDto,
} from './dto/create-contribution.dto';

const AUTHOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
} as const;

type Author = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

const authorName = (user: Author) =>
  [user.firstName, user.lastName].filter(Boolean).join(' ') ||
  user.username ||
  'Pessoa da comunidade';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Contributions paid per sweep; the rest wait for the next day. */
const GRANT_BATCH = 500;

/** XP still waiting: neither paid nor taken back. */
const NOT_GRANTED = {
  OR: [{ xpGrantedAt: { isSet: false } }, { xpGrantedAt: null }],
};

/**
 * Contributions: what people add to composers and works they did not
 * create. They go live at once and are moderated by report, so each one
 * keeps what was there before. The XP waits seven days and is paid only if
 * no report against it was upheld or is still open. Undoing one restores
 * the old value only while the record still shows the contribution; a
 * later edit is not silently thrown away.
 */
@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
    private readonly activity: ActivityTracker,
    private readonly notifications: NotificationsService,
    private readonly bios: ComposerBioService,
  ) {}

  async contribute(userId: string, dto: CreateContributionDto) {
    await this.assertVerified(userId);

    const rule = fieldRule(dto.entityType, dto.field);
    if (!rule) {
      throw new BadRequestException('Este campo não aceita contribuições.');
    }
    const value = rule.normalize(dto.value);
    if (value === null) {
      throw new BadRequestException(rule.hint);
    }

    const before = await this.readField(
      dto.entityType,
      dto.entityId,
      dto.field,
    );
    if (before === value) {
      throw new BadRequestException('O valor enviado é igual ao atual.');
    }

    const translation =
      dto.entityType === 'composer' && rule.kind === ContributionKind.BIO
        ? await this.planTranslation(dto.entityId, dto.field)
        : null;
    await this.writeField(dto.entityType, dto.entityId, dto.field, value);
    if (translation) void this.translateBio(dto.entityId, value, translation);
    const xp = await this.xpFor(userId, rule.kind);
    const contribution = await this.prisma.contribution.create({
      data: {
        userId,
        kind: rule.kind,
        entityType: dto.entityType,
        entityId: dto.entityId,
        field: dto.field,
        // An empty field stays absent: undoing writes null back.
        ...(before !== null && { before }),
        after: value,
        source: dto.source?.trim() || undefined,
        xp,
      },
      include: { user: { select: AUTHOR_SELECT } },
    });

    await this.cache.invalidateMany(CATALOG_NAMESPACES);
    return this.toResponse(contribution);
  }

  async addCuriosity(
    userId: string,
    composerId: string,
    dto: CreateCuriosityDto,
  ) {
    await this.assertVerified(userId);

    const text = dto.text.trim().replace(/\s+/g, ' ');
    if (text.length < 20) {
      throw new BadRequestException(
        'Conte a curiosidade numa frase completa (pelo menos 20 caracteres).',
      );
    }

    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { id: true },
    });
    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    const repeated = await this.prisma.composerCuriosity.findFirst({
      where: { composerId, language: dto.language, text },
      select: { id: true },
    });
    if (repeated) {
      throw new BadRequestException('Esta curiosidade já está na página.');
    }

    const curiosity = await this.prisma.composerCuriosity.create({
      data: {
        composerId,
        text,
        language: dto.language,
        source: CuriositySource.USER,
        userId,
        showAuthor: dto.showAuthor === true,
      },
      include: { user: { select: AUTHOR_SELECT } },
    });

    const xp = await this.xpFor(userId, ContributionKind.CURIOSITY);
    await this.prisma.contribution.create({
      data: {
        userId,
        kind: ContributionKind.CURIOSITY,
        entityType: 'composer',
        entityId: composerId,
        curiosityId: curiosity.id,
        after: text,
        source: dto.source?.trim() || undefined,
        xp,
      },
    });

    await this.cache.invalidateMany(CATALOG_NAMESPACES);
    return this.toCuriosity(curiosity, userId);
  }

  /** The composer's curiosities in one language: editorial first, then people's, in the order told. */
  async listCuriosities(
    composerId: string,
    language: 'pt' | 'en',
    currentUserId?: string,
  ) {
    const curiosities = await this.prisma.composerCuriosity.findMany({
      where: {
        composerId,
        language,
        OR: [NOT_HIDDEN, ...(currentUserId ? [{ userId: currentUserId }] : [])],
      },
      orderBy: [{ source: 'asc' }, { createdAt: 'asc' }],
      take: 40,
      include: { user: { select: AUTHOR_SELECT } },
    });
    return curiosities.map((c) => this.toCuriosity(c, currentUserId));
  }

  /** Its author or the team can take a curiosity down; the XP goes with it. */
  async removeCuriosity(userId: string, isAdmin: boolean, curiosityId: string) {
    const curiosity = await this.prisma.composerCuriosity.findUnique({
      where: { id: curiosityId },
      select: { userId: true },
    });
    if (!curiosity || (!isAdmin && curiosity.userId !== userId)) {
      throw new NotFoundException('Curiosidade não encontrada');
    }
    await this.deleteCuriosity(curiosityId);
  }

  /** Deletes a curiosity; its XP is no longer due, or goes back if paid. */
  async deleteCuriosity(curiosityId: string): Promise<void> {
    const contribution = await this.prisma.contribution.findFirst({
      where: { curiosityId, ...NOT_REVERTED },
      select: { id: true, userId: true, xp: true, xpGrantedAt: true },
    });
    await this.prisma.composerCuriosity.delete({ where: { id: curiosityId } });
    if (contribution) {
      await this.prisma.contribution.update({
        where: { id: contribution.id },
        data: { revertedAt: new Date(), xp: 0 },
      });
      if (contribution.xpGrantedAt) {
        await this.takeXp(contribution.userId, contribution.xp);
      }
    }
  }

  /**
   * Pays the XP of contributions that went seven days without an upheld
   * report. One with a report still open waits for the decision; one that
   * was removed was already reverted and is not due. Run daily.
   */
  async grantDueXp(
    now = new Date(),
  ): Promise<{ due: number; granted: number }> {
    const due = await this.prisma.contribution.findMany({
      where: {
        AND: [NOT_REVERTED, NOT_GRANTED],
        xp: { gt: 0 },
        createdAt: { lte: new Date(now.getTime() - XP_WAIT_DAYS * DAY_MS) },
      },
      select: {
        id: true,
        userId: true,
        kind: true,
        xp: true,
        curiosityId: true,
      },
      orderBy: { createdAt: 'asc' },
      take: GRANT_BATCH,
    });
    if (!due.length) return { due: 0, granted: 0 };

    const open = await this.prisma.uploadModeration.findMany({
      where: {
        status: 'pending',
        entityType: { in: ['contribution', 'curiosity'] },
        entityId: {
          in: due.flatMap((c) =>
            c.curiosityId ? [c.id, c.curiosityId] : [c.id],
          ),
        },
      },
      select: { entityId: true },
    });
    const waiting = new Set(open.map((r) => r.entityId));

    let granted = 0;
    for (const c of due) {
      if (waiting.has(c.id) || (c.curiosityId && waiting.has(c.curiosityId))) {
        continue;
      }
      await this.prisma.contribution.update({
        where: { id: c.id },
        data: { xpGrantedAt: now },
      });
      await this.prisma.user.update({
        where: { id: c.userId },
        data: { totalXP: { increment: c.xp } },
      });
      await this.notifications.notify({
        userId: c.userId,
        type: NotificationType.GENERAL_ANNOUNCEMENT,
        priority: NotificationPriority.LOW,
        title: `Sua contribuição rendeu ${c.xp} XP`,
        message:
          'Passaram sete dias sem denúncia, e o XP entrou na sua conta. Obrigado por completar o acervo.',
        relatedEntityType: 'contribution',
        relatedEntityId: c.id,
        uniqueHash: `contribution-xp:${c.id}`,
      });
      this.activity.track(
        c.userId,
        'contributions',
        `contribution.${c.kind.toLowerCase()}.granted`,
      );
      granted++;
    }
    return { due: due.length, granted };
  }

  /** Recent live contributions to a record, newest first: credit lines and the moderation view. */
  async listForEntity(entityType: ContributableEntity, entityId: string) {
    const rows = await this.prisma.contribution.findMany({
      where: { entityType, entityId, ...NOT_REVERTED },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: AUTHOR_SELECT } },
    });
    return rows.map((row) => this.toResponse(row));
  }

  /**
   * Takes a contribution back. The old value returns only if the record
   * still shows this contribution. `refund` also cancels the XP (taking it
   * back if it was already paid): a hold waiting for a decision keeps it, a
   * removal does not.
   */
  async revert(contributionId: string, refund: boolean): Promise<void> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
    });
    if (!contribution) {
      throw new NotFoundException('Contribuição não encontrada');
    }
    if (contribution.curiosityId) {
      throw new BadRequestException(
        'Curiosidades são moderadas pela própria curiosidade.',
      );
    }

    if (!contribution.revertedAt) {
      await this.swapIfCurrent(
        contribution,
        contribution.after,
        contribution.before,
      );
      await this.prisma.contribution.update({
        where: { id: contributionId },
        data: { revertedAt: new Date() },
      });
    }
    if (refund && contribution.xp > 0) {
      await this.prisma.contribution.update({
        where: { id: contributionId },
        data: { xp: 0 },
      });
      if (contribution.xpGrantedAt) {
        await this.takeXp(contribution.userId, contribution.xp);
      }
    }
  }

  /** Tells the author the team rejected a contribution, and why. */
  async notifyRejected(
    userId: string,
    contributionId: string,
    reason: string,
    xpReturned: number,
  ): Promise<void> {
    await this.notifications.notify({
      userId,
      type: NotificationType.GENERAL_ANNOUNCEMENT,
      priority: NotificationPriority.MEDIUM,
      title: 'Uma contribuição sua foi reprovada',
      message:
        `${reason}` +
        (xpReturned > 0
          ? ` O XP dela (${xpReturned}) foi devolvido.`
          : ' Ela não rendeu XP.'),
      relatedEntityType: 'contribution',
      relatedEntityId: contributionId,
      uniqueHash: `contribution-rejected:${contributionId}`,
    });
  }

  /** Undoes a hold: the contribution returns if nothing replaced the old value meanwhile. */
  async reapply(contributionId: string): Promise<void> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
    });
    if (!contribution?.revertedAt || contribution.curiosityId) return;
    const restored = await this.swapIfCurrent(
      contribution,
      contribution.before,
      contribution.after,
    );
    if (restored) {
      await this.prisma.contribution.update({
        where: { id: contributionId },
        data: { revertedAt: null },
      });
    }
  }

  // -------------------------------------------------------------------

  /**
   * After a person writes the biography in one language: whether to fill the
   * other one by machine translation. Yes when it is empty or itself a
   * machine translation; no when a person wrote it. Writing the language
   * that was translated counts as reviewing it, and clears the mark.
   */
  private async planTranslation(
    composerId: string,
    field: string,
  ): Promise<{ from: 'pt' | 'en'; to: 'pt' | 'en'; other: string } | null> {
    const from = field === 'bio' ? 'pt' : 'en';
    const to = from === 'pt' ? 'en' : 'pt';
    const other = from === 'pt' ? 'bioEn' : 'bio';
    const row = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { bio: true, bioEn: true, bioTranslatedFrom: true },
    });
    if (!row) return null;
    if (row.bioTranslatedFrom === to) {
      await this.prisma.composer.update({
        where: { id: composerId },
        data: { bioTranslatedFrom: null },
      });
      return null;
    }
    const otherText = from === 'pt' ? row.bioEn : row.bio;
    return !otherText || row.bioTranslatedFrom === from
      ? { from, to, other }
      : null;
  }

  /**
   * Fills the other language in the background; a failure leaves it as it
   * was (the contribution itself already stands).
   */
  private async translateBio(
    composerId: string,
    text: string,
    plan: { from: 'pt' | 'en'; to: 'pt' | 'en'; other: string },
  ): Promise<void> {
    try {
      const translated = await this.bios.translateText(text, plan.to);
      if (!translated) return;
      await this.prisma.composer.update({
        where: { id: composerId },
        data: { [plan.other]: translated, bioTranslatedFrom: plan.from },
      });
      await this.cache.invalidateMany(CATALOG_NAMESPACES);
    } catch {
      // No provider configured or the call failed: nothing to undo.
    }
  }

  private async assertVerified(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });
    if (!user?.emailVerified) {
      throw new ForbiddenException(
        'Confirme seu e-mail para contribuir com o acervo.',
      );
    }
  }

  /** Full XP for the day's first contributions, none after. */
  private async xpFor(userId: string, kind: ContributionKind): Promise<number> {
    const today = await this.prisma.contribution.count({
      where: {
        userId,
        xp: { gt: 0 },
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
      },
    });
    return today < DAILY_XP_CONTRIBUTIONS ? XP_BY_KIND[kind] : 0;
  }

  private async takeXp(userId: string, xp: number): Promise<void> {
    if (xp <= 0) return;
    await this.prisma.user.updateMany({
      where: { id: userId, totalXP: { gte: xp } },
      data: { totalXP: { decrement: xp } },
    });
    await this.prisma.user.updateMany({
      where: { id: userId, totalXP: { lt: xp } },
      data: { totalXP: 0 },
    });
  }

  private async readField(
    entityType: ContributableEntity,
    entityId: string,
    field: string,
  ): Promise<string | null> {
    const select = { [field]: true };
    const row = (
      entityType === 'composer'
        ? await this.prisma.composer.findUnique({
            where: { id: entityId },
            select,
          })
        : await this.prisma.work.findUnique({ where: { id: entityId }, select })
    ) as Record<string, unknown> | null;
    if (!row) {
      throw new NotFoundException(
        entityType === 'composer'
          ? 'Compositor não encontrado'
          : 'Obra não encontrada',
      );
    }
    const value = row[field];
    return typeof value === 'string' && value.length ? value : null;
  }

  private async writeField(
    entityType: ContributableEntity,
    entityId: string,
    field: string,
    value: string | null,
  ): Promise<void> {
    if (entityType === 'work') {
      const data: Prisma.WorkUpdateInput = { [field]: value };
      // The player reads the id; the link and title follow it.
      if (field === 'youtubeVideoId') {
        data.youtubeVideoUrl = value
          ? `https://www.youtube.com/watch?v=${value}`
          : null;
        data.youtubeTitle = null;
      }
      await this.prisma.work.update({ where: { id: entityId }, data });
      return;
    }
    const data: Prisma.ComposerUpdateInput = { [field]: value };
    // Dates keep their numeric columns in step; a biography written by a
    // person is no longer the AI's.
    if (field === 'birthDate' || field === 'deathDate') {
      Object.assign(data, composerDateParts({ [field]: value }));
    }
    if (field === 'bio') {
      data.bioGeneratedBy = null;
      data.bioGeneratedAt = null;
    }
    await this.prisma.composer.update({ where: { id: entityId }, data });
  }

  /** Writes `to` only while the field still holds `from`. */
  private async swapIfCurrent(
    contribution: {
      entityType: string;
      entityId: string;
      field: string | null;
    },
    from: Prisma.JsonValue,
    to: Prisma.JsonValue,
  ): Promise<boolean> {
    const { field } = contribution;
    const entityType = contribution.entityType as ContributableEntity;
    if (!field) return false;
    const current = await this.readField(
      entityType,
      contribution.entityId,
      field,
    ).catch(() => undefined);
    if (
      current === undefined ||
      current !== (typeof from === 'string' ? from : null)
    ) {
      return false;
    }
    await this.writeField(
      entityType,
      contribution.entityId,
      field,
      typeof to === 'string' ? to : null,
    );
    await this.cache.invalidateMany(CATALOG_NAMESPACES);
    return true;
  }

  private toResponse(row: {
    id: string;
    kind: ContributionKind;
    entityType: string;
    entityId: string;
    field: string | null;
    xp: number;
    xpGrantedAt: Date | null;
    createdAt: Date;
    user: Author;
  }) {
    return {
      id: row.id,
      kind: row.kind,
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field,
      xp: row.xp,
      xpGranted: !!row.xpGrantedAt,
      createdAt: row.createdAt,
      author: { id: row.user.id, name: authorName(row.user) },
    };
  }

  private toCuriosity(
    row: {
      id: string;
      text: string;
      source: CuriositySource;
      userId: string | null;
      isHidden: boolean | null;
      showAuthor: boolean | null;
      user: Author | null;
    },
    currentUserId?: string,
  ) {
    return {
      id: row.id,
      text: row.text,
      source: row.source,
      // Signed only when the author asked for it.
      author:
        row.user && row.showAuthor
          ? { id: row.user.id, name: authorName(row.user) }
          : null,
      mine: !!currentUserId && row.userId === currentUserId,
      held: !!row.isHidden,
    };
  }
}
