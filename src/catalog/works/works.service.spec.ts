import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { TextIndexService } from '../../common/search/text-index.service';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImslpScoresService } from './imslp-scores.service';
import { WorksService } from './works.service';

const WORK = '68600fb6df23f271f94bb803';

const summary = (id: string) => ({
  id,
  title: `Obra ${id}`,
  opOrCatalog: ' ',
  composer: { name: 'Chopin', fullName: 'Frédéric Chopin' },
  instrument: { name: 'Piano' },
  annotationsCount: 2,
});

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: WORK,
  title: 'Noturno',
  opOrCatalog: 'Op. 9',
  subtitle: null,
  compositionYear: null,
  firstPublishDate: null,
  tone: null,
  mediaDuration: null,
  imslpPermlink: null,
  imslpId: null,
  videoUrl: null,
  workStyle: null,
  moviment: null,
  dedicateTo: null,
  instrumentation: null,
  workType: 'SINGLE',
  movementNumber: null,
  createdAt: new Date('2026-01-01'),
  instrumentId: 'i1',
  epochId: 'e1',
  categoryNames: [],
  workGenresArr: [],
  isVerified: false,
  createdBy: null,
  parentWorkId: 'pai',
  spotifyTrackId: null,
  spotifyTrackUrl: null,
  spotifyDisplayTitle: null,
  spotifyDuration: null,
  spotifyArtists: null,
  spotifyThumbnail: null,
  youtubeVideoId: null,
  youtubeVideoUrl: null,
  youtubeTitle: null,
  videoAulaUrl: null,
  videoAulaFile: null,
  videoAulaMetadata: null,
  videoAulaSource: null,
  videoAulaTitle: null,
  videoAulaType: null,
  videoAulaAddedAt: null,
  videoAulaAddedBy: null,
  customAudioUrl: null,
  customAudioFile: null,
  customAudioMetadata: null,
  customAudioSource: null,
  mediaSource: null,
  lastMediaSearch: null,
  mediaSearchError: null,
  difficultyLevel: null,
  composer: {
    id: 'c1',
    name: 'Chopin',
    fullName: 'Frédéric Chopin',
    epochName: ' ',
    portraitUrl: null,
  },
  ...overrides,
});

const score = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  source: 'IMSLP',
  sourceId: '1',
  title: 'Partitura',
  downloadUrl: ' ',
  thumbnailUrl: null,
  fileSize: null,
  pageCount: null,
  fileFormat: 'PDF',
  type: 'SCORES',
  groupIndex: null,
  groupTitle: null,
  editor: null,
  publisher: null,
  ...overrides,
});

describe('WorksService', () => {
  let prisma: {
    work: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      aggregateRaw: jest.Mock;
    };
    workScore: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    workGenre: { findMany: jest.Mock; findUnique: jest.Mock };
    instrument: { findMany: jest.Mock; findUnique: jest.Mock };
    epoch: { findMany: jest.Mock; findUnique: jest.Mock };
    composer: { findMany: jest.Mock; aggregateRaw: jest.Mock };
    storedAsset: { findFirst: jest.Mock };
  };
  let appCache: { del: jest.Mock; remember: jest.Mock };
  /** Valor já em cache para uma chave, quando o teste quiser simular um hit. */
  let cacheHit: (key: string) => unknown;
  let imslp: { ensure: jest.Mock };
  let textIndex: { hasTextIndex: jest.Mock };
  let service: WorksService;

  beforeEach(() => {
    prisma = {
      work: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(({ data }) =>
          Promise.resolve({
            customAudioUrl: null,
            customAudioFile: null,
            customAudioSource: null,
            ...data,
          }),
        ),
        aggregateRaw: jest.fn().mockResolvedValue([]),
      },
      workScore: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
      },
      workGenre: {
        findMany: jest.fn().mockResolvedValue([{ id: 'g1', name: 'Sonata' }]),
        findUnique: jest.fn().mockResolvedValue({ name: 'Sonata' }),
      },
      instrument: {
        findMany: jest.fn().mockResolvedValue([{ id: 'i1', name: 'Piano' }]),
        findUnique: jest.fn().mockResolvedValue({ id: 'i1', name: 'Piano' }),
      },
      epoch: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'e1', name: 'Romântico' }]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'e1', name: 'Romântico' }),
      },
      composer: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregateRaw: jest.fn().mockResolvedValue([]),
      },
      storedAsset: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    cacheHit = () => undefined;
    appCache = {
      del: jest.fn().mockResolvedValue(undefined),
      remember: jest.fn(
        async (key: string, _options: unknown, load: () => Promise<unknown>) =>
          cacheHit(key) ?? (await load()),
      ),
    };
    imslp = { ensure: jest.fn().mockResolvedValue(0) };
    textIndex = { hasTextIndex: jest.fn().mockReturnValue(false) };
    service = new WorksService(
      prisma as unknown as PrismaService,
      appCache as unknown as AppCacheService,
      imslp as unknown as ImslpScoresService,
      textIndex as unknown as TextIndexService,
      {
        deleteAsset: jest.fn().mockResolvedValue(undefined),
      } as unknown as StorageService,
    );
  });

  describe('busca', () => {
    it('por id direto', async () => {
      prisma.work.findUnique.mockResolvedValue(summary(WORK));
      await expect(service.search({ id: WORK })).resolves.toEqual([
        expect.objectContaining({
          id: WORK,
          opOrCatalog: null,
          annotationsCount: 2,
          instrumentName: 'Piano',
        }),
      ]);

      prisma.work.findUnique.mockResolvedValue(null);
      await expect(service.search({ id: 'x' })).resolves.toEqual([]);
    });

    it('termo curto devolve as populares, com teto de 50', async () => {
      prisma.work.findMany.mockResolvedValue([summary('a')]);

      await service.search({ q: 'a', limit: 500 });

      expect(prisma.work.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('com índice de texto, ordena pela relevância devolvida', async () => {
      textIndex.hasTextIndex.mockReturnValue(true);
      prisma.work.aggregateRaw.mockResolvedValue([
        { _id: { $oid: 'b' } },
        { _id: 'a' },
        { _id: {} },
      ]);
      prisma.work.findMany.mockResolvedValue([summary('a'), summary('b')]);

      const result = await service.search({ q: 'noturno' });

      expect(result.map((w) => w.id)).toEqual(['b', 'a']);
    });

    it('índice falhando cai no regex escapado', async () => {
      textIndex.hasTextIndex.mockReturnValue(true);
      prisma.work.aggregateRaw.mockRejectedValue(new Error('no text index'));
      prisma.work.findMany
        .mockResolvedValueOnce([{ id: 'a' }])
        .mockResolvedValueOnce([summary('a')]);

      await service.search({ q: 'op.9' });

      const [{ where }] = prisma.work.findMany.mock.calls[0];
      expect(where.OR[0].title.contains).toBe('op\\.9');
    });

    it('sem resultado não busca os detalhes', async () => {
      await expect(service.search({ q: 'nada' })).resolves.toEqual([]);
      expect(prisma.work.findMany).toHaveBeenCalledTimes(1);
    });

    it('getByIdOrThrow: 404 quando não existe', async () => {
      await expect(service.getByIdOrThrow('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.work.findUnique.mockResolvedValue(summary(WORK));
      await expect(service.getByIdOrThrow(WORK)).resolves.toMatchObject({
        id: WORK,
      });
    });
  });

  describe('detalhe', () => {
    it('monta com obra-mãe, filhas, instrumento e época, e guarda em cache', async () => {
      prisma.work.findUnique
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce({
          id: 'pai',
          title: 'Op. 9',
          composer: { id: 'c1', name: 'Chopin', fullName: 'F. Chopin' },
        });
      prisma.work.findMany.mockResolvedValue([
        { id: 'f1', title: 'Nº 1', subtitle: '' },
      ]);

      const result = await service.findOne(WORK);

      expect(result).toMatchObject({
        parentWork: { id: 'pai', composer: { fullName: 'F. Chopin' } },
        childWorks: [{ id: 'f1', title: 'Nº 1', subtitle: null }],
        instrument: { id: 'i1', name: 'Piano' },
        epoch: { id: 'e1', name: 'Romântico' },
        composer: { epochName: null },
      });
      expect(appCache.remember).toHaveBeenCalledWith(
        `works:detail:${WORK}`,
        expect.objectContaining({ ttlMs: 5 * 60 * 1000 }),
        expect.any(Function),
      );
    });

    it('sem mãe, instrumento nem época', async () => {
      prisma.work.findUnique.mockResolvedValueOnce(
        detail({ parentWorkId: null, instrumentId: null, epochId: null }),
      );

      const result = await service.findOne(WORK);

      expect(result).toMatchObject({
        parentWork: null,
        instrument: null,
        epoch: null,
      });
    });

    it('404 e cache', async () => {
      await expect(service.findOne(WORK)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      cacheHit = () => ({ id: 'cache' });
      await expect(service.findOne(WORK)).resolves.toEqual({ id: 'cache' });
    });
  });

  describe('catálogo', () => {
    it('sem filtro: mais recentes, com total em cache e nomes resolvidos', async () => {
      prisma.work.findMany.mockResolvedValue([
        {
          id: 'w1',
          title: 'A',
          subtitle: null,
          opOrCatalog: null,
          compositionYear: null,
          tone: null,
          mediaDuration: null,
          workType: 'SINGLE',
          isVerified: false,
          composerId: 'c1',
          instrumentId: 'i1',
          epochId: 'e1',
        },
        {
          id: 'w2',
          title: 'B',
          subtitle: null,
          opOrCatalog: null,
          compositionYear: null,
          tone: null,
          mediaDuration: null,
          workType: 'SINGLE',
          isVerified: false,
          composerId: 'sumiu',
          instrumentId: null,
          epochId: 'x',
        },
      ]);
      prisma.composer.findMany.mockResolvedValue([
        { id: 'c1', name: 'Chopin', fullName: null, epochName: null },
      ]);
      prisma.work.count.mockResolvedValue(10);

      const result = await service.getCatalog({});

      expect(result.totalCount).toBe(10);
      expect(result.hasMore).toBe(true);
      expect(result.works[0]).toMatchObject({
        composer: { name: 'Chopin' },
        instrument: { name: 'Piano' },
        epoch: { name: 'Romântico' },
      });
      expect(result.works[1]).toMatchObject({
        composer: { name: 'Desconhecido' },
        instrument: null,
        epoch: { name: 'Desconhecida' },
      });
    });

    it('total de obras em cache é reaproveitado', async () => {
      cacheHit = (key: string) =>
        key.endsWith('total-count') ? 207892 : undefined;

      await expect(service.getCatalog({})).resolves.toMatchObject({
        totalCount: 207892,
      });
      expect(prisma.work.count).not.toHaveBeenCalled();
    });

    it('filtros e busca juntos viram AND; gênero por id vira nome', async () => {
      prisma.work.findMany.mockResolvedValue([
        {
          id: 'w1',
          title: 'A',
          subtitle: null,
          opOrCatalog: null,
          compositionYear: null,
          tone: null,
          mediaDuration: null,
          workType: 'SINGLE',
          isVerified: true,
          composer: { id: 'c1', name: 'C', fullName: null, epochName: null },
          instrument: null,
          epoch: null,
        },
      ]);
      prisma.work.count.mockResolvedValue(1);

      const result = await service.getCatalog({
        composerId: 'c1',
        instrumentId: 'i1',
        epochId: 'e1',
        difficultyLevel: 'BEGINNER',
        categoryNames: 'Piano',
        workGenreId: 'g1',
        search: 'op.',
      });

      const [{ where }] = prisma.work.findMany.mock.calls[0];
      expect(where.AND[0]).toMatchObject({
        composerId: 'c1',
        workGenresArr: { has: 'Sonata' },
        categoryNames: { has: 'Piano' },
      });
      expect(where.AND[1].OR[0].title.contains).toBe('op\\.');
      expect(result).toMatchObject({ totalCount: 1, hasMore: false });
      expect(result.works[0].epoch).toEqual({ id: '', name: 'Desconhecida' });
    });

    it('só busca, só um filtro, e catálogo em cache', async () => {
      await service.getCatalog({ search: 'x' });
      expect(prisma.work.findMany.mock.calls[0][0].where).toHaveProperty('OR');

      await service.getCatalog({ epochId: 'e1' });
      expect(prisma.work.findMany.mock.calls[1][0].where).toEqual({
        epochId: 'e1',
      });

      cacheHit = () => ({ works: [] });
      await expect(service.getCatalog({})).resolves.toEqual({ works: [] });
    });

    it('busca o compositor pelos ids, sem filtro de relação (que custava ~18 s)', async () => {
      prisma.composer.findMany.mockResolvedValue([{ id: 'c9' }]);

      await service.getCatalog({ search: 'chopin' });

      const [{ where }] = prisma.work.findMany.mock.calls[0];
      expect(where.OR).toContainEqual({ composerId: { in: ['c9'] } });
      expect(JSON.stringify(where)).not.toContain('"composer"');
      expect(prisma.work.count.mock.calls[0][0].where).toEqual(where);
    });

    // O caminho rápido: `$text` no lugar do regex que varria as 207 mil obras.
    describe('busca pelo índice de texto', () => {
      const pipelineDe = (chamada: number) =>
        prisma.work.aggregateRaw.mock.calls[chamada][0].pipeline as Array<
          Record<string, unknown>
        >;

      beforeEach(() => {
        textIndex.hasTextIndex.mockReturnValue(true);
        prisma.composer.aggregateRaw.mockResolvedValue([
          { _id: { $oid: 'c9' } },
        ]);
        prisma.work.aggregateRaw.mockResolvedValue([
          { rows: [{ _id: { $oid: 'w1' } }], total: [{ value: 252 }] },
        ]);
        prisma.work.findMany.mockResolvedValue([
          {
            id: 'w1',
            title: 'Noturno',
            subtitle: null,
            opOrCatalog: null,
            compositionYear: null,
            tone: null,
            mediaDuration: null,
            workType: 'INDIVIDUAL',
            isVerified: true,
            composer: {
              id: 'c9',
              name: 'Chopin',
              fullName: 'Frédéric Chopin',
              epochName: null,
            },
            instrument: { name: 'Piano' },
            epoch: { id: 'e1', name: 'Romântico' },
          },
        ]);
      });

      it('busca por $text, junta as obras do compositor e conta no mesmo round-trip', async () => {
        const result = await service.getCatalog({ search: 'chopin' });

        expect(result.totalCount).toBe(252);
        expect(result.works[0]).toMatchObject({ id: 'w1', title: 'Noturno' });

        const pipeline = pipelineDe(0);
        expect(pipeline[0]).toEqual({
          $match: { $text: { $search: 'chopin' } },
        });
        expect(JSON.stringify(pipeline)).toContain('$unionWith');
        expect(JSON.stringify(pipeline)).toContain('$facet');

        // O regex não chega a rodar.
        expect(prisma.work.count).not.toHaveBeenCalled();
      });

      it('o teto de tempo vai para o banco, não só para a resposta HTTP', async () => {
        await service.getCatalog({ search: 'chopin' });

        expect(prisma.work.aggregateRaw.mock.calls[0][0].options).toEqual(
          expect.objectContaining({ maxTimeMS: 8000 }),
        );
      });

      it('os demais filtros entram nos dois ramos da união', async () => {
        await service.getCatalog({ search: 'chopin', epochId: 'e1' });

        const pipeline = pipelineDe(0);
        expect(pipeline[0]).toEqual({
          $match: { epochId: { $oid: 'e1' }, $text: { $search: 'chopin' } },
        });
        const uniao = JSON.stringify(
          pipeline.find((estagio) => '$unionWith' in estagio),
        );
        expect(uniao).toContain('"epochId":{"$oid":"e1"}');
      });

      // `$text` casa palavra inteira: "beeth" não encontra "Beethoven".
      it('sem resultado por $text, volta ao regex em vez de devolver vazio', async () => {
        prisma.work.aggregateRaw.mockResolvedValue([{ rows: [], total: [] }]);
        prisma.composer.aggregateRaw.mockResolvedValue([]);
        prisma.composer.findMany.mockResolvedValue([{ id: 'c9' }]);
        prisma.work.count.mockResolvedValue(434);

        const result = await service.getCatalog({ search: 'beeth' });

        expect(result.totalCount).toBe(434);
        const [{ where }] = prisma.work.findMany.mock.calls[0];
        expect(where.OR).toContainEqual({ composerId: { in: ['c9'] } });
      });

      it('falha do pipeline não derruba a busca — cai no regex', async () => {
        prisma.work.aggregateRaw.mockRejectedValue(new Error('sem índice'));
        prisma.work.count.mockResolvedValue(3);

        await expect(
          service.getCatalog({ search: 'chopin' }),
        ).resolves.toMatchObject({ totalCount: 3 });
      });
    });

    it('opções de filtro com famosos e níveis', async () => {
      prisma.composer.findMany.mockResolvedValue([
        { id: 'c1', name: 'Chopin', fullName: null, _count: { works: 9 } },
      ]);

      const options = await service.getFilterOptions();

      expect(options.popularComposers).toEqual([
        { id: 'c1', name: 'Chopin', fullName: undefined, worksCount: 9 },
      ]);
      expect(options.difficultyLevels).toHaveLength(3);
      expect(options.instruments[0]).toEqual({
        id: 'i1',
        name: 'Piano',
        originalName: undefined,
      });

      cacheHit = () => ({ cached: true });
      await expect(service.getFilterOptions()).resolves.toEqual({
        cached: true,
      });
    });
  });

  describe('gêneros e relacionadas', () => {
    it('todos os gêneros, com cache', async () => {
      await expect(service.getAllGenres()).resolves.toEqual([
        { id: 'g1', name: 'Sonata' },
      ]);
      cacheHit = () => [{ id: 'cache' }];
      await expect(service.getAllGenres()).resolves.toEqual([{ id: 'cache' }]);
    });

    it('autocomplete de gênero escapa o termo e limita', async () => {
      await service.searchGenres({ q: ' so.', limit: 99 });
      expect(prisma.workGenre.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'so\\.', mode: 'insensitive' } },
          take: 50,
        }),
      );

      await service.searchGenres({});
      expect(prisma.workGenre.findMany.mock.calls[1][0].where).toBeUndefined();
    });

    it('relacionadas por compositor ou instrumento', async () => {
      prisma.work.findUnique.mockResolvedValue({
        composerId: 'c1',
        instrumentId: 'i1',
      });
      prisma.work.findMany.mockResolvedValue([
        {
          id: 'r1',
          title: 'R',
          opOrCatalog: '',
          compositionYear: null,
          tone: null,
          mediaDuration: null,
          workType: 'SINGLE',
          instrument: null,
          composer: { id: 'c1', name: 'C', epochName: null },
        },
      ]);

      const related = await service.findRelated(WORK);

      const [{ where }] = prisma.work.findMany.mock.calls[0];
      expect(where.AND[1].OR).toEqual([
        { composerId: 'c1' },
        { instrumentId: 'i1' },
      ]);
      expect(related[0].opOrCatalog).toBeNull();
    });

    it('relacionadas: obra sem instrumento, inexistente e cache', async () => {
      prisma.work.findUnique.mockResolvedValue({
        composerId: 'c1',
        instrumentId: null,
      });
      await service.findRelated(WORK, 3);
      expect(prisma.work.findMany.mock.calls[0][0].where.AND[1].OR).toEqual([
        { composerId: 'c1' },
      ]);

      prisma.work.findUnique.mockResolvedValue(null);
      await expect(service.findRelated('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      cacheHit = () => [{ id: 'cache' }];
      await expect(service.findRelated(WORK)).resolves.toEqual([
        { id: 'cache' },
      ]);
    });
  });

  describe('mídia', () => {
    const owned = {
      title: 'Noturno',
      createdBy: 'u1',
      customAudioFile: null,
      customAudioSource: null,
    };

    beforeEach(() => {
      prisma.work.findUnique.mockResolvedValue(owned);
    });

    it('só o autor ou admin edita', async () => {
      await expect(
        service.updateMedia(WORK, 'outro', false, { mediaSource: 'spotify' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.updateMedia(WORK, 'outro', true, { mediaSource: 'spotify' }),
      ).resolves.toMatchObject({ success: true });

      prisma.work.findUnique.mockResolvedValue(null);
      await expect(
        service.updateMedia(WORK, 'u1', false, { mediaSource: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('grava Spotify, YouTube e videoaula, e limpa o cache do detalhe', async () => {
      const result = await service.updateMedia(WORK, 'u1', false, {
        spotifyTrackId: 'sp1',
        spotifyTrackUrl: 'https://open.spotify.com/x',
        youtubeVideoId: 'yt1',
        youtubeVideoUrl: 'https://youtu.be/yt1',
        youtubeTitle: 'Vídeo',
        videoAulaUrl: 'https://youtu.be/aula',
      });

      const [{ data }] = prisma.work.update.mock.calls[0];
      expect(data).toMatchObject({
        spotifyTrackId: 'sp1',
        youtubeVideoId: 'yt1',
        videoAulaTitle: 'Noturno',
        videoAulaType: 'video',
        videoAulaSource: 'youtube',
        videoAulaAddedBy: 'u1',
      });
      expect(appCache.del).toHaveBeenCalledWith(`works:detail:${WORK}`);
      expect(result.audioInfo.hasCustomAudio).toBe(false);
    });

    it('áudio enviado, áudio por link e remoção', async () => {
      let result = await service.updateMedia(WORK, 'u1', false, {
        customAudioFile: 'https://cdn/a.mp3',
      });
      expect(prisma.work.update.mock.calls[0][0].data).toMatchObject({
        customAudioUrl: 'https://cdn/a.mp3',
        customAudioSource: 'upload',
      });
      expect(result.audioInfo.hasCustomAudio).toBe(true);

      result = await service.updateMedia(WORK, 'u1', false, {
        customAudioUrl: 'https://outro/b.mp3',
      });
      expect(prisma.work.update.mock.calls[1][0].data).toMatchObject({
        customAudioSource: 'alternative',
        customAudioFile: null,
      });

      prisma.work.findUnique.mockResolvedValue({
        ...owned,
        customAudioFile: 'f',
        customAudioSource: 'upload',
      });
      await service.updateMedia(WORK, 'u1', false, {
        customAudioUrl: 'https://outro/c.mp3',
      });
      expect(prisma.work.update.mock.calls[2][0].data).not.toHaveProperty(
        'customAudioFile',
      );

      await service.updateMedia(WORK, 'u1', false, { removeCustomAudio: true });
      expect(prisma.work.update.mock.calls[3][0].data).toMatchObject({
        customAudioUrl: null,
        customAudioFile: null,
      });
    });

    it('nada para atualizar é 400', async () => {
      await expect(
        service.updateMedia(WORK, 'u1', false, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['spotify', 'spotifyTrackId'],
      ['youtube', 'youtubeVideoId'],
      ['custom-audio', 'customAudioUrl'],
      ['video-aula', 'videoAulaUrl'],
    ] as const)('limpa %s', async (type, field) => {
      const result = await service.clearMedia(WORK, 'u1', false, type);

      expect(result.clearedFields).toContain(field);
      expect(prisma.work.update.mock.calls[0][0].data[field]).toBeNull();
    });

    it('limpar o áudio enviado pela API apaga também o arquivo', async () => {
      prisma.work.findUnique.mockResolvedValue({
        createdBy: 'u1',
        customAudioUrl: 'https://res.cloudinary.com/opus/video/upload/a.mp3',
        videoAulaUrl: null,
      });
      prisma.storedAsset.findFirst.mockResolvedValue({ id: 'asset-1' });

      await service.clearMedia(WORK, 'u1', false, 'custom-audio');

      expect(prisma.storedAsset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            kind: 'WORK_AUDIO',
            secureUrl: 'https://res.cloudinary.com/opus/video/upload/a.mp3',
          }),
        }),
      );
      expect(
        (service as unknown as { storage: { deleteAsset: jest.Mock } }).storage
          .deleteAsset,
      ).toHaveBeenCalledWith('asset-1');
    });
  });

  describe('partituras', () => {
    it('listagem garante o IMSLP antes; busca por sourceId não', async () => {
      await service.getScores(WORK, {});
      expect(imslp.ensure).toHaveBeenCalledWith(WORK);

      imslp.ensure.mockClear();
      await service.getScores(WORK, { sourceId: '1', source: 'IMSLP' });
      expect(imslp.ensure).not.toHaveBeenCalled();
    });

    it('busca direta conta o acesso; inexistente volta vazia', async () => {
      await expect(
        service.getScores(WORK, { sourceId: '1', source: 'IMSLP' }),
      ).resolves.toEqual({
        scores: [],
        total: 0,
        hasMore: false,
      });

      prisma.workScore.findFirst.mockResolvedValue(score());
      const result = await service.getScores(WORK, {
        sourceId: '1',
        source: 'IMSLP',
      });
      expect(prisma.workScore.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { lastAccessed: expect.any(Date), accessCount: { increment: 1 } },
      });
      expect(result.scores[0].downloadUrl).toBeNull();
    });

    it('paginação por tipo separa os baldes', async () => {
      prisma.workScore.findMany.mockResolvedValue([
        score({ id: 'a', type: 'SCORES' }),
        score({ id: 'b', type: 'SCORES' }),
        score({ id: 'c', type: 'PARTS' }),
        score({ id: 'd', type: 'ARRANGEMENT' }),
        score({ id: 'e', type: 'LIBRETTO' }),
        score({ id: 'f', type: 'OTHER' }),
        score({ id: 'g', type: 'SCORES', source: 'UPLOAD' }),
      ]);

      const result = await service.getScores(WORK, { limitPerType: 1 });

      expect(result.totalByType).toEqual({
        scores: 2,
        parts: 1,
        arrangements: 1,
        uploads: 1,
        librettos: 1,
        others: 1,
      });
      expect(result.scores.map((s) => s.id)).toEqual([
        'a',
        'c',
        'd',
        'g',
        'e',
        'f',
      ]);
      expect(result.hasMore).toBe(true);
    });

    it('paginação simples com fonte', async () => {
      prisma.workScore.findMany.mockResolvedValue([score()]);
      prisma.workScore.count.mockResolvedValue(1);

      const result = await service.getScores(WORK, {
        source: 'IMSLP',
        limit: 10,
        offset: 0,
      });

      expect(prisma.workScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workId: WORK, isActive: true, source: 'IMSLP' },
          take: 10,
          skip: 0,
        }),
      );
      expect(result).toMatchObject({ total: 1, hasMore: false });
    });
  });
});
