import { Injectable, NotFoundException } from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { hasFeature } from '../../billing/constants/plan-features.constants';
import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Candidate,
  rank,
  Ranked,
  Reason,
  Seed,
  WorkFeatures,
} from './recommendation-engine';

const FEATURES = {
  id: true,
  composerId: true,
  instrumentId: true,
  epochId: true,
  instrumentation: true,
  workGenresArr: true,
  difficultyLevel: true,
  parentWorkId: true,
} as const;

type RawWork = {
  id: string;
  composerId: string;
  instrumentId: string;
  epochId: string;
  instrumentation: string | null;
  workGenresArr: string[];
  difficultyLevel: string | null;
  parentWorkId: string | null;
};

const toFeatures = (w: RawWork): WorkFeatures => ({
  id: w.id,
  composerId: w.composerId,
  instrumentId: w.instrumentId,
  epochId: w.epochId,
  instrumentation: w.instrumentation,
  genres: w.workGenresArr ?? [],
  difficultyLevel: w.difficultyLevel,
});

export interface RecommendedWork {
  id: string;
  title: string;
  opOrCatalog: string | null;
  composer: { id: string; name: string; portraitUrl: string | null };
  epochName: string | null;
  instrumentName: string | null;
  difficultyLevel: string | null;
  reasons: Reason[];
}

export interface RecommendationsResponse {
  /** Sem o Plus: só a prévia (títulos), para a tela mostrar o que vem. */
  locked: boolean;
  items: RecommendedWork[];
}

/** "Compositores" que não são uma pessoa: não se recomenda obra deles. */
const NOT_A_PERSON =
  /^(anonym|anônimo|anonimo|traditional|tradicional|various|vários|unknown|desconhecido)/i;

const POPULAR_KEY = 'recommendations:popular';
const POPULAR_TTL = 60 * 60 * 1000;
const WORK_TTL = 6 * 60 * 60 * 1000;
const USER_TTL = 30 * 60 * 1000;

/**
 * Recomendações de peças (Plus). Busca candidatas por vizinhança — mesmo
 * compositor e instrumento, mesmo gênero e instrumento, as obras mais estudadas
 * e favoritadas, e o que estudou quem estuda a mesma obra — e deixa o motor
 * (`recommendation-engine.ts`) pontuar e explicar.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly cache: AppCacheService,
  ) {}

  /** Quem pode ver: o plano efetivo tem `smartRecommendations` (do Plus em diante). */
  private async unlocked(userId: string | undefined) {
    if (!userId) return false;
    const { plan } = await this.subscriptions.effectivePlan(userId);
    return hasFeature(plan, 'smartRecommendations');
  }

  async forWork(
    workId: string,
    userId: string | undefined,
    limit = 8,
  ): Promise<RecommendationsResponse> {
    if (!isMongoId(workId)) throw new NotFoundException('Obra não encontrada');
    const open = await this.unlocked(userId);

    const ranked = await this.cache.remember(
      `recommendations:work:${workId}`,
      { ttlMs: WORK_TTL },
      async () => {
        const work = await this.prisma.work.findUnique({
          where: { id: workId },
          select: FEATURES,
        });
        if (!work) return [];
        return this.rankFor(
          [{ ...toFeatures(work), weight: 1 }],
          40,
          new Set(),
        );
      },
    );

    const exclude = userId ? await this.listedBy(userId) : new Set<string>();
    const chosen = ranked
      .filter((r) => !exclude.has(r.id))
      .slice(0, open ? limit : 3);
    return { locked: !open, items: await this.hydrate(chosen, !open) };
  }

  async forUser(userId: string, limit = 12): Promise<RecommendationsResponse> {
    const open = await this.unlocked(userId);
    const ranked = await this.rankedForUser(userId);
    const chosen = ranked.slice(0, open ? limit : 3);
    return { locked: !open, items: await this.hydrate(chosen, !open) };
  }

  /**
   * As sugestões para o aluno, pedidas pelo professor do Maestro (relatório
   * pedagógico). Sem trava: quem libera é o plano do professor, conferido por
   * quem chama. O professor escolhe; o aluno só vê o que ele aprovar.
   */
  async forStudent(userId: string, limit = 12): Promise<RecommendedWork[]> {
    const ranked = await this.rankedForUser(userId);
    return this.hydrate(ranked.slice(0, limit), false);
  }

  private rankedForUser(userId: string) {
    return this.cache.remember(
      `recommendations:user:${userId}`,
      { ttlMs: USER_TTL },
      async () => {
        const seeds = await this.seedsOf(userId);
        if (!seeds.length) return [];
        return this.rankFor(seeds, 40, await this.listedBy(userId));
      },
    );
  }

  /**
   * O gosto da pessoa: o que já aprendeu (pesa mais quanto maior a maestria),
   * o que quer aprender e os favoritos — os mais recentes primeiro.
   */
  async seedsOf(userId: string): Promise<Seed[]> {
    const [learned, want, favorites] = await Promise.all([
      this.prisma.learned.findMany({
        where: { userId },
        orderBy: { learnedAt: 'desc' },
        take: 8,
        select: { workId: true, mastery: true },
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId },
        orderBy: { addedAt: 'desc' },
        take: 6,
        select: { workId: true },
      }),
      this.prisma.favoriteWork.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: { workId: true },
      }),
    ]);
    const weight = new Map<string, number>();
    for (const l of learned)
      weight.set(
        l.workId,
        Math.max(weight.get(l.workId) ?? 0, 1 + l.mastery / 100),
      );
    for (const w of want)
      weight.set(w.workId, Math.max(weight.get(w.workId) ?? 0, 0.8));
    for (const f of favorites)
      weight.set(f.workId, Math.max(weight.get(f.workId) ?? 0, 0.5));
    if (!weight.size) return [];
    const works = await this.prisma.work.findMany({
      where: { id: { in: [...weight.keys()] } },
      select: FEATURES,
    });
    return works.map((w) => ({
      ...toFeatures(w),
      weight: weight.get(w.id) ?? 0.5,
    }));
  }

  /** O que a pessoa já tem nas listas: não se recomenda de novo. */
  async listedBy(userId: string): Promise<Set<string>> {
    const [learned, want] = await Promise.all([
      this.prisma.learned.findMany({
        where: { userId },
        select: { workId: true },
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId },
        select: { workId: true },
      }),
    ]);
    return new Set([...learned, ...want].map((x) => x.workId));
  }

  /** Busca as candidatas das obras de partida e devolve a lista pontuada. */
  async rankFor(
    seeds: Seed[],
    limit: number,
    exclude: Set<string>,
  ): Promise<Ranked[]> {
    const pool = new Map<string, RawWork>();
    const add = (ws: RawWork[]) => {
      for (const w of ws) if (!w.parentWorkId) pool.set(w.id, w);
    };

    const popular = await this.popular();
    for (const seed of seeds.slice(0, 8)) {
      const [sameComposer, sameGenre] = await Promise.all([
        this.prisma.work.findMany({
          where: {
            composerId: seed.composerId,
            instrumentId: seed.instrumentId,
          },
          select: FEATURES,
          take: 60,
        }),
        seed.genres.length
          ? this.prisma.work.findMany({
              where: {
                instrumentId: seed.instrumentId,
                workGenresArr: { hasSome: seed.genres.slice(0, 3) },
              },
              select: FEATURES,
              take: 40,
            })
          : Promise.resolve([] as RawWork[]),
      ]);
      add(sameComposer);
      add(sameGenre);
    }
    // As mais estudadas do mesmo instrumento ou compositor.
    const seedInstruments = new Set(seeds.map((s) => s.instrumentId));
    const seedComposers = new Set(seeds.map((s) => s.composerId));
    add(
      popular.works.filter(
        (w) =>
          seedInstruments.has(w.instrumentId) ||
          seedComposers.has(w.composerId),
      ),
    );

    // Quem estudou isto também estudou.
    const coStudy = await this.coStudy(seeds.map((s) => s.id));
    const missing = [...coStudy.keys()].filter((id) => !pool.has(id));
    if (missing.length)
      add(
        await this.prisma.work.findMany({
          where: { id: { in: missing.slice(0, 200) } },
          select: FEATURES,
        }),
      );

    const ids = [...pool.keys()];
    const withScore = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const g = await this.prisma.workScore.groupBy({
        by: ['workId'],
        where: { workId: { in: part }, isActive: true },
        _count: { _all: true },
      });
      g.forEach((x) => withScore.add(x.workId));
    }

    // O compositor: anônimo e tradicional saem; o conhecido pesa mais.
    const composerIds = [
      ...new Set([...pool.values()].map((w) => w.composerId)),
    ];
    const [composers, favorites] = await Promise.all([
      this.prisma.composer.findMany({
        where: { id: { in: composerIds } },
        select: { id: true, name: true, bio: true, portraitUrl: true },
      }),
      this.prisma.favoriteComposer.groupBy({
        by: ['composerId'],
        where: { composerId: { in: composerIds } },
        _count: { _all: true },
      }),
    ]);
    const favOf = new Map(favorites.map((f) => [f.composerId, f._count._all]));
    const prominence = new Map<string, number>();
    const unknown = new Set<string>();
    for (const c of composers) {
      if (NOT_A_PERSON.test(c.name)) unknown.add(c.id);
      prominence.set(
        c.id,
        Math.min(
          1,
          Math.log10(1 + (favOf.get(c.id) ?? 0)) / 2 +
            (c.bio ? 0.35 : 0) +
            (c.portraitUrl ? 0.25 : 0),
        ),
      );
    }

    const candidates: Candidate[] = [...pool.values()]
      .filter((w) => !unknown.has(w.composerId))
      .map((w) => ({
        ...toFeatures(w),
        coStudy: coStudy.get(w.id) ?? 0,
        popularity: popular.count.get(w.id) ?? 0,
        hasScore: withScore.has(w.id),
        prominence: prominence.get(w.composerId) ?? 0,
      }));
    return rank(seeds, candidates, { limit, exclude });
  }

  /** Obras que aparecem nas listas e favoritos de quem tem as de partida. */
  private async coStudy(workIds: string[]): Promise<Map<string, number>> {
    const [l, w, f] = await Promise.all([
      this.prisma.learned.findMany({
        where: { workId: { in: workIds } },
        select: { userId: true },
        take: 500,
      }),
      this.prisma.wantToLearn.findMany({
        where: { workId: { in: workIds } },
        select: { userId: true },
        take: 500,
      }),
      this.prisma.favoriteWork.findMany({
        where: { workId: { in: workIds } },
        select: { userId: true },
        take: 500,
      }),
    ]);
    const users = [...new Set([...l, ...w, ...f].map((x) => x.userId))].slice(
      0,
      300,
    );
    const counts = new Map<string, number>();
    if (!users.length) return counts;
    const [l2, w2, f2] = await Promise.all([
      this.prisma.learned.findMany({
        where: { userId: { in: users } },
        select: { userId: true, workId: true },
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId: { in: users } },
        select: { userId: true, workId: true },
      }),
      this.prisma.favoriteWork.findMany({
        where: { userId: { in: users } },
        select: { userId: true, workId: true },
      }),
    ]);
    // Uma pessoa conta uma vez por obra, mesmo com a obra em duas listas.
    const seen = new Set<string>();
    for (const x of [...l2, ...w2, ...f2]) {
      const k = `${x.userId}:${x.workId}`;
      if (seen.has(k) || workIds.includes(x.workId)) continue;
      seen.add(k);
      counts.set(x.workId, (counts.get(x.workId) ?? 0) + 1);
    }
    return counts;
  }

  /** As obras mais estudadas e favoritadas, guardadas por uma hora. */
  private async popular(): Promise<{
    works: RawWork[];
    count: Map<string, number>;
  }> {
    const top = await this.cache.remember(
      POPULAR_KEY,
      { ttlMs: POPULAR_TTL },
      async () => {
        const [f, w, l] = await Promise.all([
          this.prisma.favoriteWork.groupBy({
            by: ['workId'],
            _count: { _all: true },
            orderBy: { _count: { workId: 'desc' } },
            take: 1500,
          }),
          this.prisma.wantToLearn.groupBy({
            by: ['workId'],
            _count: { _all: true },
            orderBy: { _count: { workId: 'desc' } },
            take: 1500,
          }),
          this.prisma.learned.groupBy({
            by: ['workId'],
            _count: { _all: true },
            orderBy: { _count: { workId: 'desc' } },
            take: 1500,
          }),
        ]);
        const count: Record<string, number> = {};
        for (const x of [...f, ...w, ...l])
          count[x.workId] = (count[x.workId] ?? 0) + x._count._all;
        const ids = Object.entries(count)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 1500)
          .map(([id]) => id);
        const works = await this.prisma.work.findMany({
          where: { id: { in: ids } },
          select: FEATURES,
        });
        return { works, count };
      },
    );
    return { works: top.works, count: new Map(Object.entries(top.count)) };
  }

  private async hydrate(
    ranked: Ranked[],
    preview: boolean,
  ): Promise<RecommendedWork[]> {
    if (!ranked.length) return [];
    const works = await this.prisma.work.findMany({
      where: { id: { in: ranked.map((r) => r.id) } },
      select: {
        id: true,
        title: true,
        opOrCatalog: true,
        difficultyLevel: true,
        composer: { select: { id: true, name: true, portraitUrl: true } },
        epoch: { select: { name: true } },
        instrument: { select: { name: true } },
      },
    });
    const byId = new Map(works.map((w) => [w.id, w]));
    return ranked
      .map((r): RecommendedWork | null => {
        const w = byId.get(r.id);
        if (!w) return null;
        return {
          id: w.id,
          title: w.title,
          opOrCatalog: w.opOrCatalog ?? null,
          composer: {
            id: w.composer.id,
            name: w.composer.name,
            portraitUrl: preview ? null : (w.composer.portraitUrl ?? null),
          },
          epochName: w.epoch?.name ?? null,
          instrumentName: w.instrument?.name ?? null,
          difficultyLevel: w.difficultyLevel ?? null,
          reasons: preview ? [] : r.reasons,
        };
      })
      .filter((x): x is RecommendedWork => x !== null);
  }
}
