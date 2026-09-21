import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TextIndexService } from '../../common/search/text-index.service';
import { JobStatusService } from '../../common/queue/job-status.service';
import { SystemHealthService } from './system-health.service';

describe('SystemHealthService', () => {
  let service: SystemHealthService;
  let prisma: { $runCommandRaw: jest.Mock } & Record<string, unknown>;
  let textIndex: { hasTextIndex: jest.Mock };

  beforeEach(async () => {
    const counter = () => ({ count: jest.fn().mockResolvedValue(0) });

    prisma = {
      $runCommandRaw: jest.fn().mockResolvedValue({
        collections: 70,
        objects: 320_102,
        dataSize: 664_101_132,
        storageSize: 159_776_768,
        indexes: 407,
        indexSize: 115_191_808,
        fsUsedSize: 118_314_012_672,
        fsTotalSize: 1_005_867_986_944,
      }),
      user: counter(),
      composer: counter(),
      work: counter(),
      workScore: counter(),
      blogArticle: counter(),
      storedAsset: counter(),
      adminAuditLog: counter(),
      userToken: counter(),
      notification: counter(),
    };

    textIndex = { hasTextIndex: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemHealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TextIndexService, useValue: textIndex },
        { provide: JobStatusService, useValue: { health: async () => [] } },
      ],
    }).compile();

    service = module.get(SystemHealthService);
  });

  // O legado devolvia `collections: 15` fixo e `indexHealth: 95` simulado.
  it('devolve os números medidos do banco', async () => {
    const snapshot = await service.snapshot();

    expect(snapshot.database.collections).toBe(70);
    expect(snapshot.database.documents).toBe(320_102);
    expect(snapshot.database.indexes).toBe(407);
  });

  // O legado dizia "100GB simulado" sobre um disco que nem era o certo.
  it('rotula o disco como sendo o do servidor de banco', async () => {
    const snapshot = await service.snapshot();

    expect(snapshot.databaseHostDisk?.totalBytes).toBe(1_005_867_986_944);
    expect(snapshot.databaseHostDisk?.usedPercent).toBeCloseTo(11.8, 1);
  });

  it('acusa quando alguma coleção está sem índice de texto', async () => {
    textIndex.hasTextIndex.mockImplementation(
      (collection: string) => collection !== 'Work',
    );

    const snapshot = await service.snapshot();

    expect(snapshot.search.allIndexed).toBe(false);
    expect(
      snapshot.search.collections.find((entry) => entry.collection === 'Work')
        ?.textIndex,
    ).toBe(false);
  });

  // Um painel de saúde que devolve 500 é um painel que some quando algo está
  // errado — que é exatamente quando ele importa.
  it('sobrevive à falha do comando de estatística', async () => {
    prisma.$runCommandRaw.mockRejectedValue(new Error('sem permissão'));

    const snapshot = await service.snapshot();

    expect(snapshot.database.collections).toBeNull();
    expect(snapshot.databaseHostDisk).toBeNull();
    expect(snapshot.records).toBeDefined();
  });
});
