import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

type CountedRelation = 'favoriteWork' | 'wantToLearn' | 'learned' | 'workScore';

export interface CountFilterResult {
  /** `null` quando nenhum filtro de contagem foi pedido. */
  workIds: string[] | null;
  /** Verdadeiro quando algum critério bateu no teto de candidatos. */
  capped: boolean;
}

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

    if (criteria.length === 0) {
      return { workIds: null, capped: false };
    }

    const sets = await Promise.all(criteria);
    const capped = sets.some((set) => set.length >= MAX_CANDIDATES);

    // Interseção: a obra precisa satisfazer todos os critérios pedidos.
    const intersection = sets.reduce((acc, set) => {
      const current = new Set(set);
      return acc.filter((id) => current.has(id));
    });

    return { workIds: intersection, capped };
  }

  /**
   * Um `switch` em vez de indexar `this.prisma[model]`: o acesso dinâmico
   * colapsa as assinaturas geradas pelo Prisma numa união não chamável, e
   * recuperar a tipagem exigiria um `as any` justamente na consulta que
   * precisa estar certa.
   */
  private async topWorkIds(
    model: CountedRelation,
    minimum: number,
  ): Promise<string[]> {
    // `having`, `orderBy` e `take` são resolvidos pelo Mongo; nada é filtrado
    // em memória.
    const having = { workId: { _count: { gte: minimum } } };
    const orderBy = { _count: { workId: 'desc' as const } };

    const rows =
      model === 'favoriteWork'
        ? await this.prisma.favoriteWork.groupBy({
            by: ['workId'],
            _count: { _all: true },
            having,
            orderBy,
            take: MAX_CANDIDATES,
          })
        : model === 'wantToLearn'
          ? await this.prisma.wantToLearn.groupBy({
              by: ['workId'],
              _count: { _all: true },
              having,
              orderBy,
              take: MAX_CANDIDATES,
            })
          : model === 'learned'
            ? await this.prisma.learned.groupBy({
                by: ['workId'],
                _count: { _all: true },
                having,
                orderBy,
                take: MAX_CANDIDATES,
              })
            : await this.prisma.workScore.groupBy({
                by: ['workId'],
                _count: { _all: true },
                having,
                orderBy,
                take: MAX_CANDIDATES,
              });

    return rows.map((row) => row.workId);
  }
}
