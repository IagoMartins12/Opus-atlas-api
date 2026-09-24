import { PrismaService } from '../../prisma/prisma.service';
import {
  PartialUniqueIndexesService,
  PARTIAL_UNIQUE_INDEXES,
} from './partial-unique-indexes.service';

/** O erro que o Mongo devolve quando o nome já existe com outra especificação. */
const CONFLITO = new Error(
  'Command failed: Error code 86 (IndexKeySpecsConflict): An existing index ' +
    'has the same name as the requested index.',
);

function setup(responder: (command: Record<string, unknown>) => unknown) {
  const runCommandRaw = jest.fn((command: Record<string, unknown>) => {
    const resposta = responder(command);

    return resposta instanceof Error
      ? Promise.reject(resposta)
      : Promise.resolve(resposta ?? {});
  });
  const prisma = { $runCommandRaw: runCommandRaw } as unknown as PrismaService;

  return { service: new PartialUniqueIndexesService(prisma), runCommandRaw };
}

describe('PartialUniqueIndexesService', () => {
  /**
   * O índice de `payments.mpPaymentId` é nulo em todo pagamento por Stripe.
   * Como único comum, o primeiro pagamento ocupava o índice e **o segundo
   * pagamento da plataforma inteira falhava** — renovação ou novo checkout,
   * de qualquer pessoa. Achado em homologação, com um pagamento no banco.
   */
  it('cobre os campos opcionais únicos de pagamento e de usuário', async () => {
    const porColecao = PARTIAL_UNIQUE_INDEXES.reduce<Record<string, string[]>>(
      (acc, spec) => {
        acc[spec.collection] = [...(acc[spec.collection] ?? []), spec.field];
        return acc;
      },
      {},
    );

    expect(porColecao.payments).toContain('mpPaymentId');
    expect(porColecao.User).toEqual(
      expect.arrayContaining(['username', 'email']),
    );
  });

  it('cria cada índice na sua própria coleção', async () => {
    const { service, runCommandRaw } = setup(() => ({}));

    await service.ensurePartialIndexes();

    // Todo `createIndexes` tem de citar a coleção da própria especificação:
    // um nome de coleção fixo criaria o índice de `payments` na newsletter.
    for (const spec of PARTIAL_UNIQUE_INDEXES) {
      expect(runCommandRaw).toHaveBeenCalledWith(
        expect.objectContaining({
          createIndexes: spec.collection,
          indexes: [expect.objectContaining({ name: spec.name })],
        }),
      );
    }
  });

  it('derruba o índice antigo na coleção certa quando há conflito', async () => {
    const { service, runCommandRaw } = setup((command) =>
      command.createIndexes === 'payments' &&
      !runCommandRaw.mock.calls.some(
        ([c]) => (c as Record<string, unknown>).dropIndexes === 'payments',
      )
        ? CONFLITO
        : {},
    );

    await service.ensurePartialIndexes();

    expect(runCommandRaw).toHaveBeenCalledWith({
      dropIndexes: 'payments',
      index: 'payments_mpPaymentId_key',
    });
  });

  it('cria o índice parcial sem ler os índices existentes', async () => {
    const { service, runCommandRaw } = setup(() => ({}));

    await service.ensurePartialIndexes();

    // Nada de `listIndexes`: a resposta dele traz `$type`, que o protocolo do
    // Prisma não consegue desserializar.
    expect(runCommandRaw).not.toHaveBeenCalledWith(
      expect.objectContaining({ listIndexes: expect.anything() }),
    );
    expect(runCommandRaw).toHaveBeenCalledWith({
      createIndexes: 'newsletter_subscribers',
      indexes: [
        {
          key: { userId: 1 },
          name: 'newsletter_subscribers_userId_key',
          unique: true,
          partialFilterExpression: { userId: { $type: 'objectId' } },
        },
      ],
    });
    expect(runCommandRaw).toHaveBeenCalledTimes(PARTIAL_UNIQUE_INDEXES.length);
  });

  it('troca o índice único comum pelo parcial quando o nome está ocupado', async () => {
    let primeiraTentativa = true;
    const { service, runCommandRaw } = setup((command) => {
      if ('createIndexes' in command && primeiraTentativa) {
        primeiraTentativa = false;
        return CONFLITO;
      }
      return {};
    });

    await service.ensurePartialIndexes();

    expect(runCommandRaw).toHaveBeenCalledWith({
      dropIndexes: 'newsletter_subscribers',
      index: 'newsletter_subscribers_userId_key',
    });
    // A primeira falha vira drop + create; os outros dois passam de primeira.
    expect(runCommandRaw).toHaveBeenCalledTimes(
      PARTIAL_UNIQUE_INDEXES.length + 2,
    );
  });

  it('não derruba índice por erro que não é de conflito de especificação', async () => {
    const { service, runCommandRaw } = setup((command) =>
      'createIndexes' in command ? new Error('E11000 duplicate key error') : {},
    );

    await service.ensurePartialIndexes();

    // Duplicata é problema de dado: apagar o índice esconderia o problema.
    expect(runCommandRaw).not.toHaveBeenCalledWith(
      expect.objectContaining({ dropIndexes: 'newsletter_subscribers' }),
    );
  });

  it('segue sem erro quando o banco recusa tudo', async () => {
    const { service } = setup(() => new Error('NamespaceNotFound'));

    await expect(service.ensurePartialIndexes()).resolves.toBeUndefined();
  });
});
