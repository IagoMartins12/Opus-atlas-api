import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { errorMessage } from '../utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Campos **opcionais** com `@unique` no schema — e a armadilha que isso é no
 * MongoDB.
 *
 * Um índice único comum trata campo ausente como um valor: **só um documento
 * pode ficar sem ele**. O segundo recebe `E11000 duplicate key` num campo que
 * ninguém preencheu. O Prisma gera exatamente esse índice a cada `db push`, e
 * o estrago é proporcional ao quanto o campo é usado:
 *
 * - `payments.mpPaymentId` (id do Mercado Pago) é nulo em **todo** pagamento
 *   feito por Stripe. Achado em homologação: o primeiro pagamento ocupou o
 *   índice e **o segundo pagamento da plataforma inteira falhava** — tanto a
 *   renovação quanto um novo checkout, de qualquer pessoa;
 * - `User.username` e `User.email` hoje estão preenchidos em todas as contas,
 *   mas basta uma sem para o cadastro seguinte quebrar;
 * - os três de `newsletter_subscribers` já tinham sido corrigidos assim
 *   quando toda inscrição depois da primeira falhava.
 *
 * O parcial (`partialFilterExpression`) faz a unicidade valer só para quem
 * tem o campo preenchido — que é o que `@unique` num campo opcional quer
 * dizer.
 */
export const PARTIAL_UNIQUE_INDEXES = [
  {
    collection: 'newsletter_subscribers',
    name: 'newsletter_subscribers_userId_key',
    field: 'userId',
    type: 'objectId',
  },
  {
    collection: 'newsletter_subscribers',
    name: 'newsletter_subscribers_confirmationToken_key',
    field: 'confirmationToken',
    type: 'string',
  },
  {
    collection: 'newsletter_subscribers',
    name: 'newsletter_subscribers_unsubscribeToken_key',
    field: 'unsubscribeToken',
    type: 'string',
  },
  {
    collection: 'payments',
    name: 'payments_mpPaymentId_key',
    field: 'mpPaymentId',
    type: 'string',
  },
  {
    collection: 'User',
    name: 'User_username_key',
    field: 'username',
    type: 'string',
  },
  {
    collection: 'User',
    name: 'User_email_key',
    field: 'email',
    type: 'string',
  },
] as const;

@Injectable()
export class PartialUniqueIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PartialUniqueIndexesService.name);

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
        dropIndexes: spec.collection,
        index: spec.name,
      });
      await this.createPartial(spec);

      this.logger.log(
        `Índice único comum trocado pelo parcial: ${spec.collection}.${spec.name}`,
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
      createIndexes: spec.collection,
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
