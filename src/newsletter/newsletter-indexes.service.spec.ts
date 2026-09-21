import { PrismaService } from '../prisma/prisma.service';
import {
  NewsletterIndexesService,
  PARTIAL_UNIQUE_INDEXES,
} from './newsletter-indexes.service';

function setup(existing: object[]) {
  const runCommandRaw = jest.fn((command: Record<string, unknown>) =>
    Promise.resolve(
      'listIndexes' in command ? { cursor: { firstBatch: existing } } : {},
    ),
  );
  const prisma = { $runCommandRaw: runCommandRaw } as unknown as PrismaService;

  return { service: new NewsletterIndexesService(prisma), runCommandRaw };
}

describe('NewsletterIndexesService', () => {
  it('troca o índice único comum pelo parcial', async () => {
    const { service, runCommandRaw } = setup([
      { name: '_id_' },
      { name: 'newsletter_subscribers_userId_key', unique: true },
      { name: 'newsletter_subscribers_confirmationToken_key', unique: true },
      { name: 'newsletter_subscribers_unsubscribeToken_key', unique: true },
    ]);

    await service.ensurePartialIndexes();

    expect(runCommandRaw).toHaveBeenCalledWith({
      dropIndexes: 'newsletter_subscribers',
      index: 'newsletter_subscribers_userId_key',
    });
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
    // listIndexes + (drop + create) para cada um dos três.
    expect(runCommandRaw).toHaveBeenCalledTimes(
      1 + 2 * PARTIAL_UNIQUE_INDEXES.length,
    );
  });

  it('não mexe no índice que já é parcial', async () => {
    const { service, runCommandRaw } = setup(
      PARTIAL_UNIQUE_INDEXES.map((spec) => ({
        name: spec.name,
        unique: true,
        partialFilterExpression: { [spec.field]: { $type: spec.type } },
      })),
    );

    await service.ensurePartialIndexes();

    expect(runCommandRaw).toHaveBeenCalledTimes(1);
  });

  it('cria o índice que falta sem tentar apagar', async () => {
    const { service, runCommandRaw } = setup([{ name: '_id_' }]);

    await service.ensurePartialIndexes();

    expect(runCommandRaw).not.toHaveBeenCalledWith(
      expect.objectContaining({ dropIndexes: 'newsletter_subscribers' }),
    );
    expect(runCommandRaw).toHaveBeenCalledTimes(
      1 + PARTIAL_UNIQUE_INDEXES.length,
    );
  });

  it('segue sem erro quando a coleção ainda não existe', async () => {
    const runCommandRaw = jest
      .fn()
      .mockRejectedValue(new Error('NamespaceNotFound'));
    const service = new NewsletterIndexesService({
      $runCommandRaw: runCommandRaw,
    } as unknown as PrismaService);

    await expect(service.ensurePartialIndexes()).resolves.toBeUndefined();
    expect(runCommandRaw).toHaveBeenCalledTimes(1);
  });
});
