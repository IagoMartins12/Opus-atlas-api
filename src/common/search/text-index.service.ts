import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../utils/error.util';

/** Resultado da criação de um índice, por coleção. */
export interface TextIndexReport {
  collection: string;
  name: string;
  ready: boolean;
  /** Motivo, quando não ficou pronto. */
  error?: string;
}

interface TextIndexSpec {
  collection: string;
  name: string;
  /** Campo → peso na pontuação de relevância. */
  fields: Record<string, number>;
}

/**
 * Índices de texto criados na subida da aplicação, de forma idempotente.
 */
const TEXT_INDEXES: TextIndexSpec[] = [
  {
    collection: 'Work',
    name: 'work_text_search',
    // Título pesa mais que número de catálogo: quem busca "Sonata" quer a obra,
    // não uma correspondência acidental em "Op. 27".
    fields: { title: 10, opOrCatalog: 4, subtitle: 2 },
  },
  {
    collection: 'Composer',
    name: 'composer_text_search',
    fields: { name: 10, fullName: 8, alternativeNames: 3 },
  },
  {
    collection: 'blog_articles',
    name: 'article_text_search',
    fields: { title: 10, excerpt: 4, content: 1 },
  },
];

/**
 * Cria e mantém os índices de texto do MongoDB (SPEC §10.3).
 *
 * O problema que isto resolve: a busca do catálogo usa `contains` com
 * `mode: 'insensitive'`, que o Prisma traduz para `$regex` case-insensitive.
 * Regex insensível a maiúsculas **não usa índice B-tree** no MongoDB — é
 * varredura da coleção inteira. Com 207 mil obras e 19 mil compositores, cada
 * busca lê tudo.
 *
 * Um índice de texto (`$text`) muda a ordem de grandeza e ainda traz relevância
 * (`textScore`), que o regex não tem. Nada de estrutura de dados muda: o índice
 * é aditivo e reversível.
 *
 * A criação roda no boot e é idempotente — `createIndexes` ignora um índice já
 * existente com a mesma especificação. Falha aqui nunca impede a aplicação de
 * subir: sem o índice a busca volta ao caminho antigo, mais lenta, e o log
 * registra o motivo.
 */
@Injectable()
export class TextIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TextIndexService.name);
  private readonly available = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SKIP_TEXT_INDEX_BOOTSTRAP === 'true') {
      this.logger.log('Criação de índices de texto desativada por env');
      return;
    }

    await this.ensureAll();
  }

  /** Diz se a coleção tem índice de texto utilizável nesta instância. */
  hasTextIndex(collection: string): boolean {
    return this.available.has(collection);
  }

  /**
   * Cria (ou reaproveita) todos os índices e relata o resultado por coleção.
   *
   * Público porque a criação no boot deixou de ser a única forma de chegar
   * aqui: `prisma db push` derruba os índices `$text` — o schema do Prisma não
   * tem como declará-los, então ele os trata como órfãos — e até a subida
   * seguinte a busca varre as coleções inteiras. A tarefa de manutenção
   * `search.reindex` repara sem reiniciar a aplicação.
   */
  async ensureAll(): Promise<TextIndexReport[]> {
    return Promise.all(TEXT_INDEXES.map((spec) => this.ensureIndex(spec)));
  }

  private async ensureIndex(spec: TextIndexSpec): Promise<TextIndexReport> {
    const key: Record<string, string> = {};
    const weights: Record<string, number> = {};

    for (const [field, weight] of Object.entries(spec.fields)) {
      key[field] = 'text';
      weights[field] = weight;
    }

    try {
      await this.prisma.$runCommandRaw({
        createIndexes: spec.collection,
        indexes: [
          {
            key,
            name: spec.name,
            weights,
            // Em background para não travar a coleção durante a criação.
            background: true,
            default_language: 'portuguese',
          },
        ],
      });

      this.available.add(spec.collection);
      this.logger.log(
        `Índice de texto pronto: ${spec.collection}.${spec.name}`,
      );

      return { collection: spec.collection, name: spec.name, ready: true };
    } catch (error: unknown) {
      const message = errorMessage(error);

      // Uma coleção só aceita um índice de texto. Se já existir outro com nome
      // diferente, a busca por `$text` continua funcionando — só não com os
      // pesos definidos aqui.
      if (
        message.includes('already exists') ||
        message.includes('IndexOptionsConflict')
      ) {
        this.available.add(spec.collection);
        this.logger.log(
          `Coleção ${spec.collection} já possui índice de texto — reaproveitado`,
        );

        return { collection: spec.collection, name: spec.name, ready: true };
      }

      this.logger.warn(
        `Não foi possível criar o índice de texto de ${spec.collection}: ${message}. ` +
          'A busca continuará usando regex (mais lenta).',
      );

      return {
        collection: spec.collection,
        name: spec.name,
        ready: false,
        error: message,
      };
    }
  }
}
