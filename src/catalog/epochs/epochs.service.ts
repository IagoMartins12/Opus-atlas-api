import { escapeRegex } from '../../common/utils/regex.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { EpochItemDto } from './dto/epoch-item.dto';
import { EpochComposersGroupDto } from './dto/epoch-composers-group.dto';
import { TimelineComposerItemDto } from './dto/timeline-composer-item.dto';

const EPOCHS_CACHE_KEY = `${CacheNamespace.EPOCHS}:list`;
const EPOCHS_TTL_MS = 6 * 60 * 60 * 1000;
const MUSIC_HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

/** Ordem cronológica canônica das épocas (nomes em português, como estão no
 * banco) — usada tanto para ordenar a resposta de "por época" quanto para
 * a timeline. Espelha `EPOCH_CHRONOLOGICAL_ORDER_PT` do front. */
const EPOCH_CHRONOLOGICAL_ORDER_PT = [
  'Medieval',
  'Renascentista',
  'Barroco',
  'Clássico',
  'Romântico',
  'Modernismo',
];

/** Curadoria de compositores "principais" por época — o mesmo compositor
 * pode ter dezenas de obras no catálogo, mas só os nomes abaixo entram nas
 * seções de "música por época" (Music History). Espelha `composersByEpoch`
 * do front. O texto histórico descritivo de cada época (período, formas
 * musicais, instrumentos etc.) permanece como conteúdo estático do frontend —
 * não depende do banco e já existe traduzido em PT/EN lá; portar apenas os
 * dados reais (quais compositores existem, com que datas) evita duplicar uma
 * grande base de conteúdo/copy dentro da API. */
const COMPOSERS_BY_EPOCH: Record<string, string[]> = {
  Medieval: [
    'Guillaume de Machaut',
    'Hildegard von Bingen',
    'Léonin',
    'Pérotin',
    'Adam de la Halle',
    'Adam of Saint Victor',
    'Philippe de Vitry',
    'Walter von der Vogelweide',
    'Guido of Arezzo',
    'Conrad Paumann',
    'Notker',
    'Ciconia',
  ],
  Renascentista: [
    'Josquin des Prez',
    'Giovanni Pierluigi da Palestrina',
    'Orlando de Lassus',
    'Claudio Monteverdi',
    'Thomas Tallis',
    'Giovanni Gabrieli',
    'William Byrd',
    'Pierre de La Rue',
    'John Dunstable',
    'Johannes Ockeghem',
    'Cipriano de Rore',
  ],
  Barroco: [
    'Johann Sebastian Bach',
    'George Frideric Handel',
    'Antonio Vivaldi',
    'Claudio Monteverdi',
    'Domenico Scarlatti',
    'Jean-Baptiste Lully',
    'Johann Pachelbel',
    'Georg Philipp Telemann',
    'Arcangelo Corelli',
  ],
  Clássico: [
    'Wolfgang Amadeus Mozart',
    'Joseph Haydn',
    'Ludwig van Beethoven',
    'Franz Schubert',
    'Antonio Salieri',
    'Luigi Boccherini',
    'Muzio Clementi',
    'Michael Haydn',
  ],
  Romântico: [
    'Frédéric Chopin',
    'Robert Schumann',
    'Hector Berlioz',
    'Felix Mendelssohn',
    'Franz Liszt',
    'Johannes Brahms',
    'Pyotr Ilyich Tchaikovsky',
    'Richard Wagner',
    'Franz Schubert',
    'Sergei Rachmaninoff',
    'Giuseppe Verdi',
    'Gustav Mahler',
  ],
  Modernismo: [
    'Igor Stravinsky',
    'Arnold Schoenberg',
    'Dmitri Shostakovich',
    'Béla Bartók',
    'Aaron Copland',
    'John Adams',
    'Thomas Adès',
    'Max Richter',
    'Kaija Saariaho',
    'Olivier Messiaen',
    'Philip Glass',
    'Steve Reich',
  ],
};

const EPOCH_COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  birthDate: true,
  deathDate: true,
  bio: true,
  epoch: { select: { id: true, name: true } },
} as const;

@Injectable()
export class EpochsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async findAll(): Promise<EpochItemDto[]> {
    const cached =
      await this.cacheManager.get<EpochItemDto[]>(EPOCHS_CACHE_KEY);

    if (cached) {
      return cached;
    }

    const epochs = await this.prisma.epoch.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    const response = epochs.filter((epoch) => epoch.name !== 'Desconhecido');

    await this.cacheManager.set(EPOCHS_CACHE_KEY, response, EPOCHS_TTL_MS);
    return response;
  }

  /** Compositores curados agrupados por época, na ordem cronológica —
   * seção "música por época" da página de Music History. */
  async getComposersByEpoch(): Promise<EpochComposersGroupDto[]> {
    const cacheKey = `${CacheNamespace.EPOCHS}:composers-by-epoch:v1`;
    const cached =
      await this.cacheManager.get<EpochComposersGroupDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const composers = await this.findCuratedComposers();

    const groups = new Map<string, EpochComposersGroupDto>();
    for (const epochName of EPOCH_CHRONOLOGICAL_ORDER_PT) {
      const firstOfEpoch = composers.find(
        (composer) => composer.epoch.name === epochName,
      );
      if (firstOfEpoch) {
        groups.set(epochName, {
          epochId: firstOfEpoch.epoch.id,
          epochName,
          composers: [],
        });
      }
    }

    for (const composer of composers) {
      const group = groups.get(composer.epoch.name);
      if (group && group.composers.length < 12) {
        group.composers.push({
          id: composer.id,
          name: composer.name,
          fullName: composer.fullName,
          portraitUrl: composer.portraitUrl,
          birthDate: composer.birthDate,
          deathDate: composer.deathDate,
          bio: composer.bio,
        });
      }
    }

    const response = Array.from(groups.values());
    await this.cacheManager.set(cacheKey, response, MUSIC_HISTORY_TTL_MS);
    return response;
  }

  /** Mesma curadoria de `getComposersByEpoch`, mas em lista plana com
   * ano de nascimento/morte calculado — usada pela timeline visual. */
  async getTimeline(): Promise<TimelineComposerItemDto[]> {
    const cacheKey = `${CacheNamespace.EPOCHS}:timeline:v1`;
    const cached =
      await this.cacheManager.get<TimelineComposerItemDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const composers = await this.findCuratedComposers();

    const response: TimelineComposerItemDto[] = composers.map((composer) => ({
      id: composer.id,
      name: composer.name,
      fullName: composer.fullName,
      portraitUrl: composer.portraitUrl,
      birthDate: composer.birthDate,
      deathDate: composer.deathDate,
      bio: composer.bio,
      epochName: composer.epoch.name,
      birthYear: this.extractYear(composer.birthDate),
      deathYear: this.extractYear(composer.deathDate),
    }));

    await this.cacheManager.set(cacheKey, response, MUSIC_HISTORY_TTL_MS);
    return response;
  }

  private async findCuratedComposers() {
    const allComposerNames = Object.values(COMPOSERS_BY_EPOCH).flat();

    return this.prisma.composer.findMany({
      where: {
        AND: [
          { epoch: { name: { in: EPOCH_CHRONOLOGICAL_ORDER_PT } } },
          {
            OR: allComposerNames.map((name) => ({
              OR: [
                {
                  fullName: { equals: escapeRegex(name), mode: 'insensitive' },
                },
                { name: { equals: escapeRegex(name), mode: 'insensitive' } },
                {
                  fullName: {
                    contains: escapeRegex(name),
                    mode: 'insensitive',
                  },
                },
                { name: { contains: escapeRegex(name), mode: 'insensitive' } },
              ],
            })),
          },
        ],
      },
      select: EPOCH_COMPOSER_SELECT,
      orderBy: [{ birthDate: 'asc' }, { name: 'asc' }],
    });
  }

  private extractYear(date: string | null): number | null {
    if (!date) {
      return null;
    }

    const year = parseInt(date.split('-')[0], 10);
    return Number.isNaN(year) ? null : year;
  }
}
