import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CollectionKind, Prisma } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { NOT_HIDDEN } from '../../common/database/optional-fields';
import { ComposersService } from '../../catalog/composers/composers.service';
import { WorksService } from '../../catalog/works/works.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CandidatesQueryDto,
  CreateCollectionDto,
  ListCollectionsQueryDto,
  UpdateCollectionDto,
} from './dto/collection-input.dto';

/** Collections one person can keep; past this, delete one first. */
const MAX_PER_OWNER = 50;
const FACES = 4;
const CANDIDATES = 8;
const SCORES_OF_WORK = 60;

const OWNER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
} as const;

type Owner = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};
type Row = Prisma.CollectionGetPayload<{
  include: { owner: { select: typeof OWNER_SELECT } };
}>;

export type Entry = {
  refId: string;
  note: string | null;
  title: string;
  opOrCatalog: string | null;
  composerName: string | null;
  portraitUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  nationality: string | null;
  instrumentName: string | null;
  workId: string | null;
  workTitle: string | null;
  pageCount: string | null;
};

const ownerName = (o: Owner) =>
  [o.firstName, o.lastName].filter(Boolean).join(' ') ||
  o.username ||
  'Pessoa da comunidade';

const blank = (refId: string, title: string): Entry => ({
  refId,
  note: null,
  title,
  opOrCatalog: null,
  composerName: null,
  portraitUrl: null,
  birthYear: null,
  deathYear: null,
  nationality: null,
  instrumentName: null,
  workId: null,
  workTitle: null,
  pageCount: null,
});

/**
 * Collections (sketch `colecoes-final.tsx`, 06/10). Reading follows one
 * rule: public and not held, or yours. Items of another kind, of records
 * that do not exist or repeated are refused on write; records deleted later
 * simply drop out on read.
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
    private readonly composers: ComposersService,
    private readonly works: WorksService,
  ) {}

  /** Public collections, the team's picks first, then the most favorited. */
  async list(query: ListCollectionsQueryDto, viewerId?: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;
    const where: Prisma.CollectionWhereInput = {
      isPublic: true,
      ...NOT_HIDDEN,
      ...(query.featured && { featuredOnHome: true }),
      ...(query.kind && { kind: query.kind }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.collection.findMany({
        where,
        orderBy: [
          { featuredOnHome: 'desc' },
          { favoritesCount: 'desc' },
          { updatedAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: { owner: { select: OWNER_SELECT } },
      }),
      this.prisma.collection.count({ where }),
    ]);
    return { collections: await this.summaries(rows, viewerId), total };
  }

  /** "Minhas" and "Favoritas", for the personal page. */
  async mine(userId: string) {
    const [own, favorites] = await Promise.all([
      this.prisma.collection.findMany({
        where: { ownerId: userId },
        orderBy: { updatedAt: 'desc' },
        include: { owner: { select: OWNER_SELECT } },
      }),
      this.prisma.collectionFavorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          collection: { include: { owner: { select: OWNER_SELECT } } },
        },
      }),
    ]);
    const visible = favorites
      .map((f) => f.collection)
      .filter((c) => c.isPublic && !c.isHidden);
    return {
      mine: await this.summaries(own, userId),
      favorites: await this.summaries(visible, userId),
    };
  }

  async get(id: string, viewerId?: string) {
    const row = await this.prisma.collection.findUnique({
      where: { id },
      include: { owner: { select: OWNER_SELECT } },
    });
    const visible =
      row && ((row.isPublic && !row.isHidden) || row.ownerId === viewerId);
    if (!row || !visible) {
      throw new NotFoundException('Coleção não encontrada');
    }
    const entries = await this.resolve(
      row.kind,
      row.items.map((i) => i.refId),
    );
    const items = row.items.flatMap((item) => {
      const entry = entries.get(item.refId);
      return entry ? [{ ...entry, note: item.note ?? null }] : [];
    });
    const [summary] = await this.summaries([row], viewerId, entries);
    return { ...summary, items };
  }

  async create(userId: string, dto: CreateCollectionDto) {
    await this.assertCanCreate(userId);
    const items = await this.validItems(dto.kind, dto.items);
    const row = await this.prisma.collection.create({
      data: {
        ownerId: userId,
        kind: dto.kind,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        isPublic: dto.isPublic,
        items,
      },
    });
    await this.invalidate();
    return this.get(row.id, userId);
  }

  async update(userId: string, id: string, dto: UpdateCollectionDto) {
    const row = await this.owned(userId, id);
    const items = await this.validItems(row.kind, dto.items);
    await this.prisma.collection.update({
      where: { id },
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        isPublic: dto.isPublic,
        // A private collection cannot stay on the home page.
        ...(!dto.isPublic && { featuredOnHome: false }),
        items,
      },
    });
    await this.invalidate();
    return this.get(id, userId);
  }

  async remove(userId: string, isAdmin: boolean, id: string): Promise<void> {
    if (!isAdmin) await this.owned(userId, id);
    await this.delete(id);
  }

  /** Deletes a collection and its favorites (also used by moderation). */
  async delete(id: string): Promise<void> {
    await this.prisma.collectionFavorite.deleteMany({
      where: { collectionId: id },
    });
    await this.prisma.collection.delete({ where: { id } });
    await this.invalidate();
  }

  async favorite(userId: string, id: string, on: boolean) {
    const row = await this.prisma.collection.findUnique({
      where: { id },
      select: { ownerId: true, isPublic: true, isHidden: true },
    });
    if (!row || !row.isPublic || row.isHidden) {
      throw new NotFoundException('Coleção não encontrada');
    }
    if (row.ownerId === userId) {
      throw new BadRequestException('A coleção já é sua.');
    }
    const existing = await this.prisma.collectionFavorite.findFirst({
      where: { userId, collectionId: id },
      select: { id: true },
    });
    if (on && !existing) {
      await this.prisma.collectionFavorite.create({
        data: { userId, collectionId: id },
      });
      await this.prisma.collection.update({
        where: { id },
        data: { favoritesCount: { increment: 1 } },
      });
    } else if (!on && existing) {
      await this.prisma.collectionFavorite.delete({
        where: { id: existing.id },
      });
      await this.prisma.collection.updateMany({
        where: { id, favoritesCount: { gt: 0 } },
        data: { favoritesCount: { decrement: 1 } },
      });
    }
    await this.invalidate();
    const { favoritesCount } = await this.prisma.collection.findUniqueOrThrow({
      where: { id },
      select: { favoritesCount: true },
    });
    return { favorited: on, favoritesCount };
  }

  /** The team's call: only a public collection that is not held. */
  async setFeatured(id: string, featuredOnHome: boolean) {
    const row = await this.prisma.collection.findUnique({
      where: { id },
      select: { isPublic: true, isHidden: true },
    });
    if (!row) throw new NotFoundException('Coleção não encontrada');
    if (featuredOnHome && (!row.isPublic || row.isHidden)) {
      throw new BadRequestException('Só coleção pública vai para a home.');
    }
    await this.prisma.collection.update({
      where: { id },
      data: { featuredOnHome },
    });
    await this.invalidate();
    return { featuredOnHome };
  }

  /**
   * What the editor offers: up to eight of the kind for what you typed or,
   * for scores, every score of the work you picked first.
   */
  async candidates(query: CandidatesQueryDto) {
    if (query.kind === CollectionKind.SCORE && query.workId) {
      const ids = (
        await this.prisma.workScore.findMany({
          where: { workId: query.workId, isActive: true },
          orderBy: [{ groupIndex: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
          take: SCORES_OF_WORK,
        })
      ).map((s) => s.id);
      const entries = await this.resolve(CollectionKind.SCORE, ids);
      return ids.flatMap((id) => entries.get(id) ?? []);
    }
    const q = query.q?.trim() ?? '';
    if (q.length < 2) return [];
    let ids: string[];
    if (query.kind === CollectionKind.COMPOSER) {
      ids = (
        await this.composers.findAll({ search: q, page: 1, limit: CANDIDATES })
      ).map((c) => c.id);
    } else {
      const works = await this.works.search({ q, limit: CANDIDATES });
      ids = works.map((w) => w.id);
      if (query.kind === CollectionKind.SCORE) {
        ids = (
          await this.prisma.workScore.findMany({
            where: { workId: { in: ids }, isActive: true },
            select: { id: true },
            take: CANDIDATES,
          })
        ).map((s) => s.id);
      }
    }
    const entries = await this.resolve(query.kind, ids);
    return ids.flatMap((id) => entries.get(id) ?? []);
  }

  // -------------------------------------------------------------------

  private async assertCanCreate(userId: string): Promise<void> {
    const [user, count] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerified: true },
      }),
      this.prisma.collection.count({ where: { ownerId: userId } }),
    ]);
    if (!user?.emailVerified) {
      throw new ForbiddenException('Confirme seu e-mail para criar coleções.');
    }
    if (count >= MAX_PER_OWNER) {
      throw new BadRequestException(
        `Você já tem ${MAX_PER_OWNER} coleções. Apague uma para criar outra.`,
      );
    }
  }

  private async owned(userId: string, id: string) {
    const row = await this.prisma.collection.findUnique({
      where: { id },
      select: { ownerId: true, kind: true },
    });
    if (!row || row.ownerId !== userId) {
      throw new NotFoundException('Coleção não encontrada');
    }
    return row;
  }

  /** Same kind, existing, no repeats; notes trimmed, empty ones dropped. */
  private async validItems(
    kind: CollectionKind,
    items: { refId: string; note?: string }[],
  ) {
    const ids = items.map((i) => i.refId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Um item aparece duas vezes na coleção.');
    }
    const where = { id: { in: ids } };
    const found =
      kind === CollectionKind.COMPOSER
        ? await this.prisma.composer.count({ where })
        : kind === CollectionKind.WORK
          ? await this.prisma.work.count({ where })
          : await this.prisma.workScore.count({ where });
    if (found !== ids.length) {
      throw new BadRequestException(
        'Algum item não existe no acervo ou é de outro tipo.',
      );
    }
    return items.map((i) => ({ refId: i.refId, note: i.note?.trim() || null }));
  }

  /** The display data of each id, keyed by id. */
  private async resolve(kind: CollectionKind, ids: string[]) {
    const map = new Map<string, Entry>();
    if (!ids.length) return map;
    if (kind === CollectionKind.COMPOSER) {
      const rows = await this.prisma.composer.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          fullName: true,
          portraitUrl: true,
          birthYear: true,
          deathYear: true,
          nationality: true,
        },
      });
      for (const c of rows) {
        map.set(c.id, {
          ...blank(c.id, c.fullName || c.name),
          composerName: c.name,
          portraitUrl: c.portraitUrl,
          birthYear: c.birthYear,
          deathYear: c.deathYear,
          nationality: c.nationality,
        });
      }
    } else if (kind === CollectionKind.WORK) {
      const rows = await this.prisma.work.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          title: true,
          opOrCatalog: true,
          composer: { select: { name: true, portraitUrl: true } },
          instrument: { select: { name: true } },
        },
      });
      for (const w of rows) {
        map.set(w.id, {
          ...blank(w.id, w.title),
          opOrCatalog: w.opOrCatalog,
          composerName: w.composer?.name ?? null,
          portraitUrl: w.composer?.portraitUrl ?? null,
          instrumentName: w.instrument?.name ?? null,
        });
      }
    } else {
      const rows = await this.prisma.workScore.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          title: true,
          pageCount: true,
          work: {
            select: {
              id: true,
              title: true,
              opOrCatalog: true,
              composer: { select: { name: true, portraitUrl: true } },
            },
          },
        },
      });
      for (const s of rows) {
        map.set(s.id, {
          ...blank(s.id, s.title),
          pageCount: s.pageCount,
          workId: s.work?.id ?? null,
          workTitle: s.work?.title ?? null,
          opOrCatalog: s.work?.opOrCatalog ?? null,
          composerName: s.work?.composer?.name ?? null,
          portraitUrl: s.work?.composer?.portraitUrl ?? null,
        });
      }
    }
    return map;
  }

  /**
   * Cards: owner, counts and up to four faces (the composers in it, or the
   * composers of its works). One query per kind for the whole page.
   */
  private async summaries(
    rows: Row[],
    viewerId?: string,
    known?: Map<string, Entry>,
  ) {
    if (!rows.length) return [];
    const firstIds = (r: Row) =>
      r.items.slice(0, FACES * 2).map((i) => i.refId);
    const byKind = new Map<CollectionKind, Map<string, Entry>>();
    for (const kind of Object.values(CollectionKind)) {
      const ids = rows.filter((r) => r.kind === kind).flatMap(firstIds);
      byKind.set(
        kind,
        known && rows.every((r) => r.kind === kind)
          ? known
          : await this.resolve(kind, ids),
      );
    }
    const favorited = viewerId
      ? new Set(
          (
            await this.prisma.collectionFavorite.findMany({
              where: {
                userId: viewerId,
                collectionId: { in: rows.map((r) => r.id) },
              },
              select: { collectionId: true },
            })
          ).map((f) => f.collectionId),
        )
      : new Set<string>();

    return rows.map((r) => {
      const entries = byKind.get(r.kind)!;
      const faces: { name: string; portraitUrl: string | null }[] = [];
      for (const id of firstIds(r)) {
        const e = entries.get(id);
        const name = e?.composerName ?? e?.title;
        if (!e?.portraitUrl || !name || faces.some((f) => f.name === name))
          continue;
        faces.push({ name, portraitUrl: e.portraitUrl });
        if (faces.length === FACES) break;
      }
      return {
        id: r.id,
        kind: r.kind,
        title: r.title,
        description: r.description,
        isPublic: r.isPublic,
        featuredOnHome: r.featuredOnHome,
        held: !!r.isHidden,
        favoritesCount: r.favoritesCount,
        itemCount: r.items.length,
        updatedAt: r.updatedAt,
        owner: { id: r.owner.id, name: ownerName(r.owner) },
        faces,
        mine: r.ownerId === viewerId,
        favorited: favorited.has(r.id),
      };
    });
  }

  private invalidate(): Promise<void> {
    return this.cache.invalidateMany([CacheNamespace.COLLECTIONS]);
  }
}
