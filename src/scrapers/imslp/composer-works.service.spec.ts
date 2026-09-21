import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ComposerWorksService } from './composer-works.service';
import { ImslpApiClient } from './imslp-api.client';

describe('ComposerWorksService', () => {
  let service: ComposerWorksService;
  let prisma: {
    composer: { findUnique: jest.Mock };
    work: { findMany: jest.Mock };
  };
  let api: { listCategoryMembers: jest.Mock };

  beforeEach(async () => {
    prisma = {
      composer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comp-1',
          name: 'Bach',
          fullName: 'Johann Sebastian Bach',
          imslpId: 'Category:Bach, Johann Sebastian',
        }),
      },
      work: { findMany: jest.fn().mockResolvedValue([]) },
    };

    api = {
      listCategoryMembers: jest.fn().mockResolvedValue({
        members: [
          { pageid: 111, title: 'Sonata (Bach, Johann Sebastian)' },
          { pageid: 222, title: 'Fuga (Bach, Johann Sebastian)' },
        ],
        truncated: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComposerWorksService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImslpApiClient, useValue: api },
      ],
    }).compile();

    service = module.get(ComposerWorksService);
  });

  it('consulta a categoria guardada no `imslpId` do compositor', async () => {
    await service.discover('comp-1');

    expect(api.listCategoryMembers).toHaveBeenCalledWith(
      'Category:Bach, Johann Sebastian',
    );
  });

  it('lista as obras encontradas', async () => {
    const result = await service.discover('comp-1');

    expect(result.found).toBe(2);
    expect(result.works.map((work) => work.title)).toEqual(['Sonata', 'Fuga']);
  });

  // Medido contra o IMSLP real: a categoria do Beethoven anuncia 361 obras,
  // das quais 357 já estavam no catálogo — e a descoberta relatava 0, porque
  // comparava nome de página com id numérico.
  it('marca o que já está no catálogo, casando pelo id numérico', async () => {
    prisma.work.findMany.mockResolvedValue([{ imslpId: '111' }]);

    const result = await service.discover('comp-1');

    expect(prisma.work.findMany.mock.calls[0][0].where.imslpId.in).toEqual([
      '111',
      '222',
    ]);
    expect(result.existing).toBe(1);
    expect(result.works[0].alreadyImported).toBe(true);
    expect(result.works[1].alreadyImported).toBe(false);
  });

  // Saber o que já existe obra a obra seria uma consulta por obra, e a
  // categoria de um compositor grande anuncia mais de mil.
  it('confere o catálogo numa consulta só', async () => {
    await service.discover('comp-1');

    expect(prisma.work.findMany).toHaveBeenCalledTimes(1);
  });

  // Quem lê decide importar pela lista; "isto é tudo" e "isto é o que coube"
  // não podem chegar iguais.
  it('repassa o truncamento vindo da paginação', async () => {
    api.listCategoryMembers.mockResolvedValue({
      members: [{ pageid: 1, title: 'X (Bach, Johann Sebastian)' }],
      truncated: true,
    });

    expect((await service.discover('comp-1')).truncated).toBe(true);
  });

  it('trunca quando a categoria passa do teto de obras', async () => {
    api.listCategoryMembers.mockResolvedValue({
      members: Array.from({ length: 2_001 }, (_, index) => ({
        pageid: index + 1,
        title: `Obra ${index} (Bach, Johann Sebastian)`,
      })),
      truncated: false,
    });

    const result = await service.discover('comp-1');

    expect(result.found).toBe(2_000);
    expect(result.truncated).toBe(true);
  });

  // Nada é gravado: descobrir responde "o que existe lá", importar é decisão
  // separada.
  it('não grava nada', async () => {
    const result = await service.discover('comp-1');

    expect(result.works.length).toBeGreaterThan(0);
    expect(Object.keys(prisma)).toEqual(['composer', 'work']);
  });

  it('recusa compositor inexistente', async () => {
    prisma.composer.findUnique.mockResolvedValue(null);

    await expect(service.discover('sumiu')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(api.listCategoryMembers).not.toHaveBeenCalled();
  });

  it('recusa compositor sem página do IMSLP registrada', async () => {
    prisma.composer.findUnique.mockResolvedValue({
      id: 'comp-2',
      name: 'Anônimo',
      fullName: null,
      imslpId: null,
    });

    await expect(service.discover('comp-2')).rejects.toThrow(/imslpId/);
  });
});
