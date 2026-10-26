import { Injectable, Logger } from '@nestjs/common';
import { ArticleStatus } from '@prisma/client';
import { AppCacheService } from '../common/cache/cache.service';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/** One endpoint for all IndexNow engines (Bing, Yandex, Seznam, Naver…). */
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** The protocol's ceiling per request. */
const MAX_PER_REQUEST = 10_000;
/** Per run: a bulk catalog fix is sent over the next runs, not in one burst. */
const MAX_WORKS = 8_000;
const MAX_COMPOSERS = 1_000;
const MAX_ARTICLES = 500;
/** Where the last run stopped; kept a month (a run every 15 minutes renews it). */
const LAST_RUN_KEY = 'indexnow:last-run';
const LAST_RUN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface IndexNowRun {
  enabled: boolean;
  urls: number;
  /** A batch the engines refused, by HTTP status. */
  refused: number[];
}

type Changed = { id: string; updatedAt: Date };
type ChangedArticle = { slug: string; updatedAt: Date };

/**
 * IndexNow: tells Bing (which feeds ChatGPT search and Copilot), Yandex and
 * the others which pages changed, instead of waiting for their crawlers to
 * come back. Google does not take part; it reads the sitemap.
 *
 * **Every few minutes, from `updatedAt`.** Not on each write: works,
 * composers and articles are written from many places (uploads, the admin,
 * contributions, scripts), and there is no single hook that sees them all.
 * The run asks the database what changed since the last one, so every path
 * is covered. A bulk fix that touches thousands is sent in slices, oldest
 * first, over the next runs.
 *
 * Off unless `INDEXNOW_KEY` is set and the site is public (`https`, not
 * localhost): local and homologation never announce anything. The key is
 * served by the site at `/indexnow.txt` (`app/indexnow.txt/route.ts`).
 */
@Injectable()
export class IndexNowService {
  private readonly logger = new Logger(IndexNowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  private get key(): string | undefined {
    return process.env.INDEXNOW_KEY?.trim() || undefined;
  }

  private get site(): URL | null {
    try {
      const url = new URL(process.env.FRONTEND_BASE_URL ?? '');
      return url.protocol === 'https:' &&
        !/localhost|127\.0\.0\.1/.test(url.host)
        ? url
        : null;
    } catch {
      return null;
    }
  }

  get enabled(): boolean {
    return !!this.key && !!this.site;
  }

  async submitChanged(now = new Date()): Promise<IndexNowRun> {
    if (!this.enabled) return { enabled: false, urls: 0, refused: [] };

    const last = await this.cache.get<string>(LAST_RUN_KEY);
    // The first run only marks the start: announcing the whole catalog is the
    // sitemap's job.
    if (!last) {
      await this.cache.set(LAST_RUN_KEY, now.toISOString(), LAST_RUN_TTL_MS);
      return { enabled: true, urls: 0, refused: [] };
    }

    const since = new Date(last);
    const changed = { updatedAt: { gt: since, lte: now } };
    const order = { updatedAt: 'asc' as const };
    const [works, composers, articles] = await Promise.all([
      this.prisma.work.findMany({
        where: changed,
        select: { id: true, updatedAt: true },
        orderBy: order,
        take: MAX_WORKS,
      }),
      this.prisma.composer.findMany({
        where: changed,
        select: { id: true, updatedAt: true },
        orderBy: order,
        take: MAX_COMPOSERS,
      }),
      this.prisma.blogArticle.findMany({
        where: { ...changed, status: ArticleStatus.PUBLISHED },
        select: { slug: true, updatedAt: true },
        orderBy: order,
        take: MAX_ARTICLES,
      }),
    ]);

    const urls = this.urlsFor(works, composers, articles);
    const refused: number[] = [];
    for (let i = 0; i < urls.length; i += MAX_PER_REQUEST) {
      const status = await this.post(urls.slice(i, i + MAX_PER_REQUEST));
      if (status >= 400 || status === 0) refused.push(status);
    }

    // Refused: try the same window again next run. Sliced: go on from the
    // oldest change not yet sent.
    if (!refused.length) {
      await this.cache.set(
        LAST_RUN_KEY,
        nextStart(now, [
          [works, MAX_WORKS],
          [composers, MAX_COMPOSERS],
          [articles, MAX_ARTICLES],
        ]).toISOString(),
        LAST_RUN_TTL_MS,
      );
    }
    if (urls.length)
      this.logger.log(
        `IndexNow: ${urls.length} endereço(s) avisados${refused.length ? `; recusados: ${refused.join(', ')}` : ''}`,
      );
    return { enabled: true, urls: urls.length, refused };
  }

  /** Each page in Portuguese and English (`/en/...`); articles only as written. */
  urlsFor(
    works: Changed[],
    composers: Changed[],
    articles: ChangedArticle[],
  ): string[] {
    const site = this.site;
    if (!site) return [];
    const base = site.origin;
    const nosDois = (caminho: string) => [
      `${base}${caminho}`,
      `${base}/en${caminho}`,
    ];
    return [
      ...works.flatMap((w) => nosDois(`/works/${w.id}`)),
      ...composers.flatMap((c) => nosDois(`/composer/${c.id}`)),
      ...articles.map((a) => `${base}/blog/${encodeURIComponent(a.slug)}`),
    ];
  }

  private async post(urlList: string[]): Promise<number> {
    const site = this.site!;
    try {
      const response = await fetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          host: site.host,
          key: this.key,
          keyLocation: `${site.origin}/indexnow.txt`,
          urlList,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.status;
    } catch (error: unknown) {
      this.logger.warn(`IndexNow não respondeu: ${errorMessage(error)}`);
      return 0;
    }
  }
}

/**
 * Where the next run starts: now, unless a list hit its cap — then from the
 * last change sent of the most behind list. A bulk `updateMany` gives
 * thousands the same instant; past the cap those are left to the sitemap,
 * since starting again at that instant would resend the same slice forever.
 */
export function nextStart(
  now: Date,
  lists: Array<[Array<{ updatedAt: Date }>, number]>,
): Date {
  const cortadas = lists
    .filter(([items, cap]) => items.length >= cap)
    .map(([items]) => items[items.length - 1].updatedAt);
  if (!cortadas.length) return now;
  return new Date(Math.min(...cortadas.map((d) => d.getTime())));
}
