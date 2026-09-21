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

interface ExistingIndex {
  name: string;
  partialFilterExpression?: Record<string, unknown>;
}

/**
 * Troca por índices parciais os índices únicos que o Prisma cria para os
 * campos opcionais de `NewsletterSubscriber`.
 *
 * No MongoDB, um índice único comum trata campo ausente ou `null` como um
 * valor: só um documento pode ficar sem ele. É assim que o Prisma cria o
 * `@unique` de campo opcional, e o schema não tem como pedir índice parcial.
 * Em `newsletter_subscribers` isso travava a inscrição: a API não grava
 * `confirmationToken` nem `unsubscribeToken` no inscrito (os tokens vivem no
 * serviço de tokens), e o visitante sem conta fica sem `userId` — toda
 * inscrição depois da primeira batia no índice (P2002, respondido como 409).
 *
 * O índice parcial vale só para quem tem o campo preenchido, então a unicidade
 * continua onde importa. O `@unique` fica no schema porque a relação 1:1 com
 * `User` exige; como `prisma db push` recria os índices do schema, a troca roda
 * de novo em toda subida e é idempotente, como a dos índices de texto.
 */
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
    let existing: ExistingIndex[];

    try {
      existing = await this.listIndexes();
    } catch (error: unknown) {
      // Banco novo: a coleção só passa a existir no primeiro `db push`.
      this.logger.warn(
        `Não foi possível ler os índices de ${COLLECTION}: ${errorMessage(error)}`,
      );
      return;
    }

    for (const spec of PARTIAL_UNIQUE_INDEXES) {
      const current = existing.find((index) => index.name === spec.name);

      if (current?.partialFilterExpression) {
        continue;
      }

      try {
        if (current) {
          await this.prisma.$runCommandRaw({
            dropIndexes: COLLECTION,
            index: spec.name,
          });
        }

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

        this.logger.log(
          `Índice único parcial pronto: ${COLLECTION}.${spec.name}`,
        );
      } catch (error: unknown) {
        // Só falha se houver valor preenchido repetido; aí a duplicata precisa
        // ser resolvida à mão antes da próxima subida.
        this.logger.warn(
          `Não foi possível criar o índice único parcial ${spec.name}: ${errorMessage(error)}`,
        );
      }
    }
  }

  private async listIndexes(): Promise<ExistingIndex[]> {
    const result = (await this.prisma.$runCommandRaw({
      listIndexes: COLLECTION,
    })) as { cursor?: { firstBatch?: ExistingIndex[] } };

    return result.cursor?.firstBatch ?? [];
  }
}
