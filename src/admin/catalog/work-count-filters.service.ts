import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { topPorContagem } from '../metrics/raw-aggregate';
import { ListWorksQueryDto } from './dto/admin-catalog.dto';

/**
 * Teto de candidatos por filtro de contagem.
 *
 * Existe porque o resultado vira um `IN` na consulta seguinte, e um `IN` com
 * dezenas de milhares de ids é patológico no Mongo. Quando o teto é atingido, a
 * resposta diz — a listagem passa a ser "as obras mais bem colocadas neste
 * critério", não "todas".
 */
const MAX_CANDIDATES = 1000;

/** A coleção de cada relação contada (nome no Mongo). */
const COLECAO = {
  favoriteWork: 'FavoriteWork',
  wantToLearn: 'WantToLearn',
  learned: 'Learned',
  workScore: 'work_scores',
} as const;

type CountedRelation = 'favoriteWork' | 'wantToLearn' | 'learned' | 'workScore';

export interface CountFilterResult {
  /** `null` quando nenhum filtro de mínimo foi pedido. */
  workIds: string[] | null;
  /**
   * Obras que passam de algum máximo pedido. Máximo vira exclusão: a obra
   * com zero favoritos nem aparece no agrupamento, então "até 3" é "todas,
   * menos as que têm mais de 3".
   */
  excludeIds: string[];
  /** Verdadeiro quando algum critério bateu no teto de candidatos. */
  capped: boolean;
}

/** Teto da lista de exclusão (um `NOT IN` maior que isso pesa no Mongo). */
const MAX_EXCLUDED = 20000;

@Injectable()
export class WorkCountFiltersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve os filtros "no mínimo N favoritos/aprendizados/partituras".
   *
   * **A contagem e o corte acontecem no banco.** O legado fazia `groupBy` sem
   * `where` sobre a coleção inteira — para partituras, um agrupamento de 92 mil
   * registros em até 207 mil grupos — trazia tudo para a memória do Node e
   * aplicava o `>= N` com `.filter()` em JavaScript. Depois disso, o array
   * inteiro de ids virava um `IN` na consulta de obras.
   *
   * Aqui cada critério usa `having` com `orderBy` e `take`, então o banco
   * devolve no máximo mil ids já filtrados e ordenados por contagem.
   */
  async resolve(query: ListWorksQueryDto): Promise<CountFilterResult> {
    const criteria: Array<Promise<string[]>> = [];

    if (query.minFavorites !== undefined) {
      criteria.push(this.topWorkIds('favoriteWork', query.minFavorites));
    }

    if (query.minWantToLearn !== undefined) {
      criteria.push(this.topWorkIds('wantToLearn', query.minWantToLearn));
    }

    if (query.minLearned !== undefined) {
      criteria.push(this.topWorkIds('learned', query.minLearned));
    }

    if (query.minScores !== undefined) {
      criteria.push(this.topWorkIds('workScore', query.minScores));
    }

    const maximos: Array<Promise<string[]>> = [];
    if (query.maxFavorites !== undefined) {
      maximos.push(this.aboveMax('favoriteWork', query.maxFavorites));
    }
    if (query.maxWantToLearn !== undefined) {
      maximos.push(this.aboveMax('wantToLearn', query.maxWantToLearn));
    }
    if (query.maxLearned !== undefined) {
      maximos.push(this.aboveMax('learned', query.maxLearned));
    }
    const excluidos = (await Promise.all(maximos)).flat();
    const excludeIds = [...new Set(excluidos)];
    const cappedMax = excluidos.length >= MAX_EXCLUDED;

    if (criteria.length === 0) {
      return { workIds: null, excludeIds, capped: cappedMax };
    }

    const sets = await Promise.all(criteria);
    const capped =
      cappedMax || sets.some((set) => set.length >= MAX_CANDIDATES);

    // Interseção: a obra precisa satisfazer todos os critérios pedidos.
    const intersection = sets.reduce((acc, set) => {
      const current = new Set(set);
      return acc.filter((id) => current.has(id));
    });

    const fora = new Set(excludeIds);
    return {
      workIds: intersection.filter((id) => !fora.has(id)),
      excludeIds: [],
      capped,
    };
  }

  /** Obras com mais de `max` registros na relação. */
  private async aboveMax(
    model: Exclude<CountedRelation, 'workScore'>,
    max: number,
  ): Promise<string[]> {
    const having = { workId: { _count: { gt: max } } };
    const args = {
      by: ['workId'] as ['workId'],
      _count: { _all: true as const },
      having,
      orderBy: { workId: 'asc' as const },
      take: MAX_EXCLUDED,
    };
    const rows =
      model === 'favoriteWork'
        ? await this.prisma.favoriteWork.groupBy(args)
        : model === 'wantToLearn'
          ? await this.prisma.wantToLearn.groupBy(args)
          : await this.prisma.learned.groupBy(args);
    return rows.map((row) => row.workId);
  }

  /**
   * As obras com pelo menos `minimum` registros na relação, as mais bem
   * colocadas primeiro, até o teto. Contado e cortado no banco
   * (`topPorContagem`): o `groupBy` do Prisma com `orderBy` por contagem e
   * `take` devolve grupos quaisquer no MongoDB.
   */
  private async topWorkIds(
    model: CountedRelation,
    minimum: number,
  ): Promise<string[]> {
    const colecao = COLECAO[model];
    const linhas = await topPorContagem(this.prisma, colecao, 'workId', {
      limite: MAX_CANDIDATES,
      minimo: minimum,
    });
    return linhas.map((l) => l.id);
  }
}
