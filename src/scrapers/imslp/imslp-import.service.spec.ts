import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { composerMismatch, ImslpImportService } from './imslp-import.service';
import { ImslpWorkScraper } from './imslp-work.scraper';

const scrapedWork = (overrides: Record<string, unknown> = {}) => ({
  title: 'Prelude and Fugue in C major',
  subtitle: null,
  imslpPermlink: 'https://imslp.org/wiki/X',
  imslpId: 'X',
  composerName: 'Bach',
  composerPermLink: 'Category:Bach,_Johann_Sebastian',
  composerId: 'comp-1',
  composerCandidates: [],
  opOrCatalog: 'BWV 846',
  compositionYear: '1722',
  firstPublishDate: null,
  tone: 'C major',
  tempoMarking: null,
  mediaDuration: null,
  workStyle: null,
  moviment: null,
  instrumentation: 'piano',
  dedicateTo: null,
  categoryNames: [],
  workGenresArr: ['Prelúdios'],
  workType: 'INDIVIDUAL' as const,
  primaryInstrument: 'piano',
  dataCompleteness: 60,
  ...overrides,
});

describe('ImslpImportService', () => {
  let service: ImslpImportService;
  let prisma: {
    composer: { findUnique: jest.Mock };
    instrument: { findFirst: jest.Mock };
    work: { findFirst: jest.Mock; create: jest.Mock };
  };
  let scraper: { scrape: jest.Mock };
  let cache: { invalidateMany: jest.Mock };

  beforeEach(async () => {
    prisma = {
      composer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comp-1',
          name: 'Bach',
          fullName: 'Johann Sebastian Bach',
          epochId: 'epoca-1',
          imslpId: 'Category:Bach, Johann Sebastian',
          dataSource: 'imslp',
        }),
      },
      instrument: { findFirst: jest.fn().mockResolvedValue({ id: 'inst-1' }) },
      work: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'obra-nova' }),
      },
    };

    scraper = { scrape: jest.fn().mockResolvedValue(scrapedWork()) };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImslpImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImslpWorkScraper, useValue: scraper },
        { provide: AppCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(ImslpImportService);
  });

  const importar = (urls: string[]) =>
    service.importWorks({ composerId: 'comp-1', urls, userId: 'user-1' });

  // O legado fazia o servidor chamar a própria API por HTTP, sem cookie, e a
  // rota chamada exigia sessão: toda obra voltava 401.
  it('chama o scraper como serviço, no mesmo processo', async () => {
    await importar(['https://imslp.org/wiki/X']);

    expect(scraper.scrape).toHaveBeenCalledWith('https://imslp.org/wiki/X');
  });

  it('grava a obra com os dados lidos', async () => {
    await importar(['https://imslp.org/wiki/X']);

    expect(prisma.work.create.mock.calls[0][0].data).toMatchObject({
      title: 'Prelude and Fugue in C major',
      composerId: 'comp-1',
      epochId: 'epoca-1',
      opOrCatalog: 'BWV 846',
      createdBy: 'user-1',
    });
  });

  // Ela veio de raspagem de página, não de curadoria.
  it('obra importada nasce não verificada', async () => {
    await importar(['https://imslp.org/wiki/X']);

    expect(prisma.work.create.mock.calls[0][0].data.isVerified).toBe(false);
  });

  it('não grava campo que o model não tem', async () => {
    await importar(['https://imslp.org/wiki/X']);

    expect(prisma.work.create.mock.calls[0][0].data).not.toHaveProperty(
      'tempoMarking',
    );
  });

  describe('duplicatas', () => {
    // O legado comparava os 20 primeiros caracteres do título: "Prelude and
    // Fugue in C major" e "...in C minor" têm os mesmos 20, e a segunda era
    // descartada em silêncio.
    it('compara por `imslpId` ou título exato, não por prefixo', async () => {
      await importar(['https://imslp.org/wiki/X']);

      expect(prisma.work.findFirst.mock.calls[0][0].where.OR).toEqual([
        { imslpId: 'X' },
        { composerId: 'comp-1', title: 'Prelude and Fugue in C major' },
      ]);
    });

    it('obra já existente não é gravada de novo', async () => {
      prisma.work.findFirst.mockResolvedValue({ id: 'obra-antiga' });

      const summary = await importar(['https://imslp.org/wiki/X']);

      expect(prisma.work.create).not.toHaveBeenCalled();
      expect(summary.duplicates).toBe(1);
      expect(summary.outcomes[0]).toMatchObject({
        status: 'duplicate',
        workId: 'obra-antiga',
      });
    });
  });

  describe('instrumento', () => {
    it('procura o instrumento lido da página', async () => {
      await importar(['https://imslp.org/wiki/X']);

      expect(prisma.instrument.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'piano', mode: 'insensitive' } },
          select: { id: true },
        }),
      );
    });

    it('cai para o de reserva quando a página não diz qual é', async () => {
      scraper.scrape.mockResolvedValue(
        scrapedWork({ primaryInstrument: null }),
      );

      await importar(['https://imslp.org/wiki/X']);

      expect(prisma.work.create.mock.calls[0][0].data.instrumentId).toBe(
        'inst-1',
      );
    });

    // O legado devolvia 500 — erro de servidor para um catálogo mal semeado.
    it('sem o instrumento de reserva, explica o que fazer', async () => {
      prisma.instrument.findFirst.mockResolvedValue(null);

      await expect(importar(['https://imslp.org/wiki/X'])).rejects.toThrow(
        /Cadastre-o antes de importar/,
      );
    });
  });

  describe('falhas', () => {
    it('uma obra que falha não derruba as outras', async () => {
      scraper.scrape
        .mockResolvedValueOnce(scrapedWork())
        .mockRejectedValueOnce(new Error('IMSLP fora do ar'))
        .mockResolvedValueOnce(scrapedWork({ imslpId: 'Z', title: 'Outra' }));

      const summary = await importar([
        'https://imslp.org/wiki/X',
        'https://imslp.org/wiki/Y',
        'https://imslp.org/wiki/Z',
      ]);

      expect(summary.imported).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.outcomes[1]).toMatchObject({
        status: 'failed',
        reason: 'IMSLP fora do ar',
      });
    });
  });

  describe('validações', () => {
    it('recusa lote vazio', async () => {
      await expect(importar([])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('recusa lote acima do teto', async () => {
      await expect(
        importar(Array.from({ length: 101 }, () => 'https://imslp.org/wiki/X')),
      ).rejects.toThrow(/1 a 100/);
    });

    it('recusa compositor inexistente', async () => {
      prisma.composer.findUnique.mockResolvedValue(null);

      await expect(
        importar(['https://imslp.org/wiki/X']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Toda obra precisa de época, e ela vem do compositor.
    it('recusa compositor sem época', async () => {
      prisma.composer.findUnique.mockResolvedValue({
        id: 'comp-2',
        name: 'X',
        fullName: null,
        epochId: null,
        imslpId: 'Category:X',
        dataSource: 'imslp',
      });

      await expect(importar(['https://imslp.org/wiki/X'])).rejects.toThrow(
        /época/,
      );
    });
  });

  // A categoria de um compositor no IMSLP lista redirecionamentos, e um deles
  // pode levar à obra de outra pessoa. Medido contra o IMSLP real:
  // "Trauermarsch, Anh.13 (Beethoven, Ludwig van)" leva a
  // "Funeral March No.1 (Walch, Johann Heinrich)".
  describe('compositor da página', () => {
    it('recusa obra cuja página é de outro compositor', async () => {
      scraper.scrape.mockResolvedValue(
        scrapedWork({
          composerPermLink: 'Category:Walch,_Johann_Heinrich',
          composerName: 'Walch, Johann Heinrich',
        }),
      );

      const summary = await importar(['https://imslp.org/wiki/X']);

      expect(prisma.work.create).not.toHaveBeenCalled();
      expect(summary.failed).toBe(1);
      expect(summary.outcomes[0].reason).toMatch(/Walch, Johann Heinrich/);
    });

    it('aceita quando a página confirma o compositor pedido', async () => {
      const summary = await importar(['https://imslp.org/wiki/X']);

      expect(summary.imported).toBe(1);
    });
  });

  describe('cache', () => {
    it('derruba o cache do catálogo quando algo entrou', async () => {
      await importar(['https://imslp.org/wiki/X']);

      expect(cache.invalidateMany).toHaveBeenCalledWith([
        'works',
        'composers',
        'discovery',
        'epochs',
      ]);
    });

    it('não derruba quando nada entrou', async () => {
      prisma.work.findFirst.mockResolvedValue({ id: 'obra-antiga' });

      await importar(['https://imslp.org/wiki/X']);

      expect(cache.invalidateMany).not.toHaveBeenCalled();
    });
  });
});

describe('composerMismatch', () => {
  const bach = {
    imslpId: 'Category:Bach, Johann Sebastian',
    name: 'Bach',
    fullName: 'Johann Sebastian Bach',
  };

  // A página escreve com sublinhado, o catálogo guarda com espaço.
  it('sublinhado e espaço são a mesma coisa', () => {
    expect(
      composerMismatch(
        {
          composerPermLink: 'Category:Bach,_Johann_Sebastian',
          composerName: 'Bach, Johann Sebastian',
        },
        bach,
      ),
    ).toBeNull();
  });

  it('acento e caixa não contam', () => {
    expect(
      composerMismatch(
        { composerPermLink: 'Category:Fauré,_Gabriel', composerName: 'Fauré' },
        { imslpId: 'Category:Faure, Gabriel', name: 'Faure', fullName: null },
      ),
    ).toBeNull();
  });

  it('aponta o compositor de verdade quando são diferentes', () => {
    expect(
      composerMismatch(
        {
          composerPermLink: 'Category:Walch,_Johann_Heinrich',
          composerName: 'Walch, Johann Heinrich',
        },
        bach,
      ),
    ).toMatch(/Walch, Johann Heinrich.*Johann Sebastian Bach/s);
  });

  // A recusa não pode se basear no compositor que o scraper casou no
  // catálogo: aquela busca é `contains` por sobrenome, e "Walch" casa com
  // "Walcha".
  it('compara o permalink da página, não o casamento no catálogo', () => {
    expect(
      composerMismatch(
        {
          composerPermLink: 'Category:Walch,_Johann_Heinrich',
          composerName: 'Walch',
        },
        {
          imslpId: 'Category:Walcha, Helmut',
          name: 'Walcha',
          fullName: 'Helmut Walcha',
        },
      ),
    ).not.toBeNull();
  });

  // Sem os dois lados não há contradição a apontar.
  it('não recusa quando a página não diz de quem é', () => {
    expect(
      composerMismatch({ composerPermLink: null, composerName: null }, bach),
    ).toBeNull();
  });

  it('não recusa quando o compositor do catálogo não tem página do IMSLP', () => {
    expect(
      composerMismatch(
        {
          composerPermLink: 'Category:Bach,_Johann_Sebastian',
          composerName: 'Bach',
        },
        { imslpId: null, name: 'Bach', fullName: null },
      ),
    ).toBeNull();
  });
});
