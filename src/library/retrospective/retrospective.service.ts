import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AiTextService } from '../../ai/ai-text.service';
import { hasFeature } from '../../billing/constants/plan-features.constants';
import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { RecommendationsService } from '../../catalog/recommendations/recommendations.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCards,
  eligible,
  Lang,
  RetroCard,
  RetroStats,
  RETRO_MIN_TOTAL,
  topPercent,
} from './retrospective-cards';

export type RetroPeriod = 'year' | 'all';

const TZ = 'America/Sao_Paulo';
const GENERIC_GENRES = new Set(['não definido', 'pieces', 'peças', 'obras']);
const RARITY = ['LEGENDARY', 'EPIC', 'RARE', 'COMMON'];

const yearNow = () =>
  Number(new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 4));
const periodKey = (p: RetroPeriod) =>
  p === 'year' ? `year:${yearNow()}` : 'all';

/**
 * A retrospectiva de estudo (Plus): conta os números no banco, monta os
 * cartões (`retrospective-cards.ts`), deixa a IA dar graça aos títulos (sem
 * mudar fato nenhum) e guarda. A pessoa compartilha pelo `shareId`.
 */
@Injectable()
export class RetrospectiveService {
  private readonly logger = new Logger(RetrospectiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly recommendations: RecommendationsService,
    private readonly ai: AiTextService,
  ) {}

  private range(period: RetroPeriod) {
    if (period === 'all') return undefined;
    const y = yearNow();
    return {
      gte: new Date(`${y}-01-01T03:00:00Z`),
      lt: new Date(`${y + 1}-01-01T03:00:00Z`),
    };
  }

  private async counts(userId: string, period: RetroPeriod) {
    const r = this.range(period);
    const [want, learned] = await Promise.all([
      this.prisma.wantToLearn.count({
        where: { userId, ...(r ? { addedAt: r } : {}) },
      }),
      this.prisma.learned.count({
        where: { userId, ...(r ? { learnedAt: r } : {}) },
      }),
    ]);
    return { want, learned };
  }

  /** O que a tela precisa para o botão: plano, se já dá, e o que já foi gerado. */
  async status(userId: string, language: Lang) {
    const { plan } = await this.subscriptions.effectivePlan(userId);
    const unlocked = hasFeature(plan, 'visualProgressHistory');
    const [year, all, saved] = await Promise.all([
      this.counts(userId, 'year'),
      this.counts(userId, 'all'),
      this.prisma.retrospective.findMany({
        where: { userId, language, period: { in: [periodKey('year'), 'all'] } },
        select: {
          period: true,
          shareId: true,
          itemCount: true,
          updatedAt: true,
        },
      }),
    ]);
    const view = (p: RetroPeriod, c: { want: number; learned: number }) => {
      const s = saved.find((x) => x.period === periodKey(p));
      return {
        eligible: eligible(c.want, c.learned),
        missing: Math.max(0, RETRO_MIN_TOTAL - (c.want + c.learned)),
        saved: s
          ? {
              shareId: s.shareId,
              generatedAt: s.updatedAt,
              stale: s.itemCount !== c.want + c.learned,
            }
          : null,
      };
    };
    return {
      unlocked,
      year: yearNow(),
      periods: { year: view('year', year), all: view('all', all) },
    };
  }

  async generate(userId: string, period: RetroPeriod, language: Lang) {
    const { plan } = await this.subscriptions.effectivePlan(userId);
    if (!hasFeature(plan, 'visualProgressHistory'))
      throw new ForbiddenException('O histórico visual é do Plus em diante.');
    const c = await this.counts(userId, period);
    if (!eligible(c.want, c.learned))
      throw new BadRequestException(
        `Ainda faltam obras para o histórico: são precisas ${RETRO_MIN_TOTAL} entre "quero estudar" e "já aprendi" (ou 3 aprendidas).`,
      );

    const stats = await this.stats(userId, period);
    let cards = buildCards(stats, language);
    let generatedBy: string | null = null;
    try {
      const polished = await this.polish(cards, language);
      if (polished) {
        cards = polished.cards;
        generatedBy = polished.generatedBy;
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Títulos da retrospectiva sem IA: ${errorMessage(error)}`,
      );
    }

    const key = periodKey(period);
    const saved = await this.prisma.retrospective.upsert({
      where: { userId_period_language: { userId, period: key, language } },
      update: {
        cards: cards as unknown as Prisma.InputJsonValue,
        itemCount: c.want + c.learned,
        firstName: stats.firstName,
        generatedBy,
      },
      create: {
        userId,
        period: key,
        language,
        shareId: randomUUID(),
        firstName: stats.firstName,
        cards: cards as unknown as Prisma.InputJsonValue,
        itemCount: c.want + c.learned,
        generatedBy,
      },
    });
    return this.toView(saved);
  }

  async mine(userId: string, period: RetroPeriod, language: Lang) {
    const saved = await this.prisma.retrospective.findUnique({
      where: {
        userId_period_language: { userId, period: periodKey(period), language },
      },
    });
    if (!saved) throw new NotFoundException('Retrospectiva ainda não gerada');
    return this.toView(saved);
  }

  /** A versão pública, para compartilhar: cartões e primeiro nome. */
  async shared(shareId: string) {
    const saved = await this.prisma.retrospective.findUnique({
      where: { shareId },
    });
    if (!saved) throw new NotFoundException('Retrospectiva não encontrada');
    return this.toView(saved);
  }

  private toView(r: {
    shareId: string;
    period: string;
    language: string;
    firstName: string;
    cards: Prisma.JsonValue;
    updatedAt: Date;
  }) {
    return {
      shareId: r.shareId,
      period: r.period.startsWith('year') ? 'year' : 'all',
      year: r.period.startsWith('year:') ? Number(r.period.slice(5)) : null,
      language: r.language,
      firstName: r.firstName,
      cards: r.cards as unknown as RetroCard[],
      generatedAt: r.updatedAt,
    };
  }

  // ------------------------------------------------------------------
  async stats(userId: string, period: RetroPeriod): Promise<RetroStats> {
    const r = this.range(period);
    const workSelect = {
      title: true,
      opOrCatalog: true,
      composerId: true,
      workGenresArr: true,
      composer: { select: { name: true } },
      epoch: { select: { name: true } },
      instrument: { select: { name: true } },
    } as const;
    const [
      user,
      want,
      learned,
      favWorks,
      favComposers,
      student,
      achievements,
      annotations,
      contributions,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, username: true },
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId, ...(r ? { addedAt: r } : {}) },
        select: { addedAt: true, work: { select: workSelect } },
      }),
      this.prisma.learned.findMany({
        where: { userId, ...(r ? { learnedAt: r } : {}) },
        select: {
          learnedAt: true,
          mastery: true,
          work: { select: workSelect },
        },
      }),
      this.prisma.favoriteWork.count({ where: { userId } }),
      this.prisma.favoriteComposer.count({ where: { userId } }),
      this.prisma.student.findUnique({
        where: { userId },
        select: { id: true },
      }),
      this.prisma.userAchievement.findMany({
        where: { userId, ...(r ? { unlockedAt: r } : {}) },
        select: { name: true, rarity: true },
      }),
      this.prisma.workAnnotation.count({
        where: { userId, ...(r ? { createdAt: r } : {}) },
      }),
      this.prisma.contribution.count({
        where: { userId, revertedAt: null, ...(r ? { createdAt: r } : {}) },
      }),
    ]);

    type Item = {
      date: Date;
      work: NonNullable<(typeof want)[number]['work']>;
    };
    const items: Item[] = [
      ...want
        .filter((w) => w.work)
        .map((w) => ({ date: w.addedAt, work: w.work! })),
      ...learned
        .filter((l) => l.work)
        .map((l) => ({ date: l.learnedAt, work: l.work! })),
    ];
    const total = items.length || 1;

    const tallyTop = (key: (i: Item) => string | null | undefined) => {
      const m = new Map<string, number>();
      for (const i of items) {
        const k = key(i);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      return top
        ? { name: top[0], count: top[1], share: top[1] / total }
        : null;
    };

    const composer = tallyTop((i) => i.work.composerId);
    const composerName = composer
      ? (items.find((i) => i.work.composerId === composer.name)?.work.composer
          .name ?? '')
      : '';
    const genreMap = new Map<string, number>();
    for (const i of items)
      for (const g of i.work.workGenresArr ?? [])
        if (!GENERIC_GENRES.has(g.toLowerCase()))
          genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
    const genreTop = [...genreMap.entries()].sort((a, b) => b[1] - a[1])[0];

    const months = new Map<number, number>();
    for (const i of items) {
      const m =
        Number(
          i.date.toLocaleDateString('en-CA', { timeZone: TZ }).slice(5, 7),
        ) - 1;
      months.set(m, (months.get(m) ?? 0) + 1);
    }
    const busiest = [...months.entries()].sort((a, b) => b[1] - a[1])[0];

    const best = [...learned]
      .filter((l) => l.work)
      .sort((a, b) => b.mastery - a.mastery)[0];
    const practice = student
      ? await this.prisma.practiceLog.findMany({
          where: { studentId: student.id, ...(r ? { practicedAt: r } : {}) },
          select: { minutes: true, practicedAt: true },
        })
      : [];

    const rarest = [...achievements].sort(
      (a, b) => RARITY.indexOf(a.rarity) - RARITY.indexOf(b.rarity),
    )[0];

    let next: string[] = [];
    try {
      next = (await this.recommendations.forUser(userId, 3)).items.map(
        (w) => `${w.title} — ${w.composer.name}`,
      );
    } catch {
      next = [];
    }

    return {
      firstName: user?.firstName || user?.username || '',
      period,
      year: yearNow(),
      learned: learned.length,
      want: want.length,
      favoriteWorks: favWorks,
      favoriteComposers: favComposers,
      composers: new Set(items.map((i) => i.work.composerId)).size,
      topComposer: composer
        ? {
            name: composerName,
            count: composer.count,
            topPercent: await this.rankAmongFans(
              { work: { composerId: composer.name } },
              userId,
            ),
          }
        : null,
      topGenre: genreTop
        ? {
            name: genreTop[0],
            count: genreTop[1],
            topPercent: await this.rankAmongFans(
              { work: { workGenresArr: { has: genreTop[0] } } },
              userId,
            ),
          }
        : null,
      topEpoch: tallyTop((i) => i.work.epoch?.name),
      topInstrument: tallyTop((i) => i.work.instrument?.name),
      masteryAvg: learned.length
        ? learned.reduce((n, l) => n + l.mastery, 0) / learned.length
        : null,
      bestWork:
        best && best.mastery > 0
          ? {
              title: best.work!.title,
              composer: best.work!.composer.name,
              mastery: best.mastery,
            }
          : null,
      busiestMonth:
        period === 'year' && busiest
          ? { month: busiest[0], count: busiest[1] }
          : null,
      practice: practice.length
        ? {
            minutes: practice.reduce((n, p) => n + p.minutes, 0),
            days: new Set(
              practice.map((p) => p.practicedAt.toISOString().slice(0, 10)),
            ).size,
          }
        : null,
      achievements: {
        count: achievements.length,
        rarest: rarest?.name ?? null,
      },
      community: { annotations, contributions },
      next,
    };
  }

  /**
   * Em que lugar a pessoa está entre quem tem obras desse compositor (ou gênero)
   * nas listas: top X%. Conta "quero estudar" e "já aprendi" de todo mundo.
   */
  private async rankAmongFans(
    workFilter: Prisma.WantToLearnWhereInput & Prisma.LearnedWhereInput,
    userId: string,
  ): Promise<number | null> {
    const [w, l] = await Promise.all([
      this.prisma.wantToLearn.findMany({
        where: workFilter,
        select: { userId: true },
      }),
      this.prisma.learned.findMany({
        where: workFilter,
        select: { userId: true },
      }),
    ]);
    const counts = new Map<string, number>();
    for (const x of [...w, ...l])
      counts.set(x.userId, (counts.get(x.userId) ?? 0) + 1);
    return topPercent(counts.get(userId) ?? 0, [...counts.values()]);
  }

  /**
   * A IA reescreve só os títulos, com graça, no mesmo idioma — sem mudar
   * número, nome ou fato. Qualquer resposta fora do formato é descartada.
   */
  private async polish(cards: RetroCard[], language: Lang) {
    const facts = cards.map((c, i) => ({
      i,
      kind: c.kind,
      title: c.title,
      value: c.value,
      detail: c.detail,
    }));
    const result = await this.ai.complete({
      system:
        language === 'pt'
          ? 'Você escreve títulos curtos e calorosos para a retrospectiva musical de uma pessoa, no estilo da retrospectiva do Spotify, em português do Brasil. Nunca invente números, nomes, obras ou fatos; não use emoji; até 70 caracteres cada. Responda só com um array JSON de strings, na mesma ordem e quantidade.'
          : 'You write short, warm titles for a person’s music year in review, Spotify Wrapped style, in English. Never invent numbers, names, works or facts; no emoji; up to 70 characters each. Answer only with a JSON array of strings, same order and count.',
      prompt: JSON.stringify(facts),
      maxTokens: 1500,
    });
    const match = /\[[\s\S]*\]/.exec(result.text);
    if (!match) return null;
    const titles = JSON.parse(match[0]) as unknown;
    if (
      !Array.isArray(titles) ||
      titles.length !== cards.length ||
      !titles.every((t) => typeof t === 'string' && t.trim() && t.length <= 90)
    )
      return null;
    // Um título que perdeu o número ou o nome que o original trazia volta ao original.
    const keep = (orig: string, next: string) => {
      const tokens = orig.match(/\d+%?|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.'-]+/g) ?? [];
      return tokens.every((t) => next.includes(t)) ? next : orig;
    };
    return {
      cards: cards.map((c, i) => ({
        ...c,
        title: keep(c.title, (titles[i] as string).trim()),
      })),
      generatedBy: result.generatedBy,
    };
  }
}
