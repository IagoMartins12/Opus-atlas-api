import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

const COLLECTION = 'newsletter_subscribers';

/** Campos opcionais com `@unique` no schema: a unicidade só vale para quem tem o campo preenchido. */
export const PARTIAL_UNIQUE_INDEXES = [
  {
    name: 'newsletter_subscribers_userId_key',
    field: 'userId',
    type: 'objectId',
  },
  {
    name: 'newsletter_subscribers_confirmationToken_key',
    field: 'confirmationToken',
    type: 'string',
  },
  {
    name: 'newsletter_subscribers_unsubscribeToken_key',
    field: 'unsubscribeToken',
    type: 'string',
  },
] as const;

@Injectable()
export class NewsletterIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NewsletterIndexesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    // O mesmo interruptor dos índices de texto: testes e2e sobem sem mexer em índice.
    if (process.env.SKIP_TEXT_INDEX_BOOTSTRAP === 'true') {
      return;
    }

    await this.ensurePartialIndexes();
  }

  async ensurePartialIndexes(): Promise<void> {
    for (const spec of PARTIAL_UNIQUE_INDEXES) {
      await this.ensureOne(spec);
    }
  }

  /**
   * Garante um índice sem precisar ler os índices existentes.
   *
   * **Por que não olhar antes.** A checagem anterior chamava `listIndexes` e
   * caía num erro do próprio Prisma — `Unknown tagged value` —, porque a
   * resposta traz `partialFilterExpression: { campo: { $type: ... } }` e
   * `$type` é a marcação que o protocolo JSON do Prisma usa para tipar valor.
   * O erro era engolido como "coleção ainda não existe", e o serviço **não
   * fazia nada em toda subida** depois da primeira. Funcionava por acidente:
   * os índices já estavam certos.
   *
   * Aqui a pergunta é feita ao banco na forma de uma tentativa: `createIndexes`
   * com especificação idêntica é no-op; com o nome ocupado por especificação
   * diferente, o Mongo responde 85/86, e aí — e só aí — o índice antigo sai.
   * Em regime normal não há nem leitura nem churn.
   */
  private async ensureOne(
    spec: (typeof PARTIAL_UNIQUE_INDEXES)[number],
  ): Promise<void> {
    try {
      await this.createPartial(spec);
      return;
    } catch (error: unknown) {
      if (!isSpecConflict(error)) {
        // Só falha de verdade se houver valor preenchido repetido; aí a
        // duplicata precisa ser resolvida à mão antes da próxima subida.
        this.logger.warn(
          `Não foi possível criar o índice único parcial ${spec.name}: ${errorMessage(error)}`,
        );
        return;
      }
    }

    // O nome está ocupado pelo índice único comum que o `prisma db push` cria.
    try {
      await this.prisma.$runCommandRaw({
        dropIndexes: COLLECTION,
        index: spec.name,
      });
      await this.createPartial(spec);

      this.logger.log(
        `Índice único comum trocado pelo parcial: ${COLLECTION}.${spec.name}`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Não foi possível trocar o índice ${spec.name} pelo parcial: ${errorMessage(error)}`,
      );
    }
  }

  private async createPartial(
    spec: (typeof PARTIAL_UNIQUE_INDEXES)[number],
  ): Promise<void> {
    await this.prisma.$runCommandRaw({
      createIndexes: COLLECTION,
      indexes: [
        {
          key: { [spec.field]: 1 },
          name: spec.name,
          unique: true,
          partialFilterExpression: { [spec.field]: { $type: spec.type } },
        },
      ],
    });
  }
}

/**
 * "Já existe um índice com este nome e outra especificação" — `IndexOptionsConflict`
 * (85) ou `IndexKeySpecsConflict` (86). É o único caso em que vale derrubar o
 * índice existente; qualquer outro erro é problema de dado e não se resolve
 * apagando índice.
 */
function isSpecConflict(error: unknown): boolean {
  const mensagem = errorMessage(error);

  return (
    mensagem.includes('IndexOptionsConflict') ||
    mensagem.includes('IndexKeySpecsConflict') ||
    mensagem.includes('code 85') ||
    mensagem.includes('code 86')
  );
}
