import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppCacheService } from '../common/cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaSearchController } from './media-search.controller';
import {
  generateSimpleQuery,
  isValidClassicalResult,
  isValidForAutoSearch,
  isValidMusicVideo,
} from './media-search.helpers';
import { MediaSearchService } from './media-search.service';

const WORK = '68600fb6df23f271f94bb803';

const work = (overrides: Record<string, unknown> = {}) => ({
  id: WORK,
  title: 'Nocturne in E-flat major, Op. 9 No. 2',
  workType: 'SINGLE',
  movementNumber: null,
  opOrCatalog: 'Op. 9',
  tone: null,
  moviment: null,
  spotifyTrackId: null,
  spotifyTrackUrl: null,
  spotifyDisplayTitle: null,
  spotifyDuration: null,
  spotifyArtists: null,
  spotifyThumbnail: null,
  youtubeVideoId: null,
  youtubeVideoUrl: null,
  youtubeTitle: null,
  customAudioUrl: null,
  workGenresArr: [],
  composer: { fullName: 'Frédéric Chopin' },
  instrument: { name: 'Piano' },
  ...overrides,
});

describe('regras da busca de mídia', () => {
  it('coletânea, livro e título curto não entram na busca automática', () => {
    expect(isValidForAutoSearch(work())).toBe(true);
    expect(
      isValidForAutoSearch(work({ title: 'Complete Works for Piano' })),
    ).toBe(false);
    expect(
      isValidForAutoSearch(
        work({ workType: 'COLLECTED_WORKS', movementNumber: 12 }),
      ),
    ).toBe(false);
    expect(
      isValidForAutoSearch(
        work({ workType: 'COLLECTED_WORKS', movementNumber: 2 }),
      ),
    ).toBe(true);
    expect(isValidForAutoSearch(work({ title: 'Ab' }))).toBe(false);
  });

  it('a consulta tira catálogo, parênteses e pontuação', () => {
    expect(
      generateSimpleQuery(
        work({ title: 'Ballade No. 1 (1835), Op. 23; "Grande"' }),
      ),
    ).toBe('Ballade No. 1 Grande - Frédéric Chopin');
  });

  it('resultado clássico precisa de palavra do gênero e não pode ser remix', () => {
    expect(isValidClassicalResult('Nocturne Op. 9', 'Rubinstein')).toBe(true);
    expect(isValidClassicalResult('Nocturne remix', 'DJ')).toBe(false);
    expect(isValidClassicalResult('Nocturne', 'Alguém')).toBe(false);
  });

  it('vídeo de aula ou análise não é gravação', () => {
    expect(isValidMusicVideo('Chopin Nocturne - Live')).toBe(true);
    expect(isValidMusicVideo('Chopin Nocturne Tutorial')).toBe(false);
  });
});

describe('MediaSearchService', () => {
  let prisma: { work: { findUnique: jest.Mock; update: jest.Mock } };
  let config: Record<string, unknown>;
  let cache: { del: jest.Mock };
  let fetchMock: jest.SpyInstance;
  let service: MediaSearchService;

  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, ...init });

  /** Responde por URL: token do Spotify, busca do Spotify, YouTube, fontes alternativas, HEAD. */
  const route = (
    handlers: Record<string, () => Response | Promise<Response>>,
  ) =>
    fetchMock.mockImplementation((input: string | URL) => {
      const url = String(input);
      const key = Object.keys(handlers).find((prefix) => url.includes(prefix));
      return Promise.resolve(
        key ? handlers[key]() : new Response('{}', { status: 404 }),
      );
    });

  beforeEach(() => {
    prisma = {
      work: {
        findUnique: jest.fn().mockResolvedValue(work()),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    config = {
      'mediaSearch.spotifyClientId': 'id',
      'mediaSearch.spotifyClientSecret': 'secret',
      'mediaSearch.youtubeApiKey': 'yt',
      'mediaSearch.frontendBaseUrl': 'http://front',
    };
    cache = { del: jest.fn().mockResolvedValue(undefined) };
    fetchMock = jest.spyOn(global, 'fetch');
    service = new MediaSearchService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn(
          (key: string, fallback?: unknown) => config[key] ?? fallback,
        ),
      } as unknown as ConfigService,
      cache as unknown as AppCacheService,
    );
  });

  afterEach(() => fetchMock.mockRestore());

  it('obra inexistente é 404', async () => {
    prisma.work.findUnique.mockResolvedValue(null);

    await expect(service.searchMedia({ workId: WORK })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('mídia já gravada volta sem buscar de novo, com artistas lidos de JSON', async () => {
    prisma.work.findUnique.mockResolvedValue(
      work({
        spotifyTrackId: 'sp1',
        spotifyArtists: JSON.stringify([{ name: 'Rubinstein' }, 'Pollini', 3]),
        youtubeVideoId: 'yt1',
      }),
    );
    route({ 'alternative-audio-sources': () => json({ sources: [] }) });

    const result = await service.searchMedia({ workId: WORK });

    expect(result).toMatchObject({
      message: 'Mídia já existe',
      spotify: {
        trackId: 'sp1',
        trackUrl: '',
        artists: ['Rubinstein', 'Pollini'],
      },
      youtube: { videoId: 'yt1', title: '' },
    });
    expect(prisma.work.update).not.toHaveBeenCalled();
  });

  it('artistas guardados em formato inválido viram lista vazia', async () => {
    prisma.work.findUnique.mockResolvedValue(
      work({ spotifyTrackId: 'sp1', spotifyArtists: '{quebrado' }),
    );
    route({ 'alternative-audio-sources': () => json({}) });

    const result = await service.searchMedia({ workId: WORK });
    expect(result.spotify?.artists).toEqual([]);

    prisma.work.findUnique.mockResolvedValue(
      work({ spotifyTrackId: 'sp1', spotifyArtists: 42 }),
    );
    expect(
      (await service.searchMedia({ workId: WORK })).spotify?.artists,
    ).toEqual([]);
  });

  it('obra inválida para busca automática registra o motivo', async () => {
    prisma.work.findUnique.mockResolvedValue(work({ title: 'Complete Works' }));

    const result = await service.searchMedia({
      workId: WORK,
      forceRefresh: true,
    });

    expect(result).toMatchObject({ success: false, alternativeAudio: [] });
    expect(prisma.work.update).toHaveBeenCalledWith({
      where: { id: WORK },
      data: expect.objectContaining({
        mediaSearchError: expect.stringContaining('coletânea'),
      }),
    });
  });

  it('busca completa: grava Spotify, YouTube e o primeiro áudio livre válido, e limpa o cache', async () => {
    route({
      'accounts.spotify.com': () => json({ access_token: 'tok' }),
      'api.spotify.com': () =>
        json({
          tracks: {
            items: [
              {
                id: 'x',
                name: 'Remix',
                artists: [{ name: 'DJ', id: 'd' }],
                album: { name: 'A', images: [] },
              },
              {
                id: 'sp1',
                name: 'Nocturne Op. 9 No. 2',
                artists: [
                  { name: 'Frédéric Chopin', id: 'c' },
                  { name: 'Arthur Rubinstein', id: 'r' },
                ],
                album: {
                  name: 'Nocturnes',
                  images: [
                    { url: 'small', height: 64, width: 64 },
                    { url: 'big', height: 640, width: 640 },
                  ],
                },
                duration_ms: 270000,
                popularity: 70,
                preview_url: null,
                external_urls: {
                  spotify: 'https://open.spotify.com/track/sp1',
                },
              },
            ],
          },
        }),
      'googleapis.com/youtube': () =>
        json({
          items: [
            {
              id: { videoId: 'aula' },
              snippet: {
                title: 'Chopin Nocturne Tutorial',
                channelTitle: 'Piano',
                publishedAt: '',
                thumbnails: {},
              },
            },
            {
              id: { videoId: 'yt1' },
              snippet: {
                title: 'Chopin Nocturne Op. 9 No. 2 piano',
                channelTitle: 'Canal',
                publishedAt: '2020',
                thumbnails: { medium: { url: 'thumb' } },
              },
            },
          ],
        }),
      'alternative-audio-sources': () =>
        json({
          sources: [
            { source: 'Outra', audioUrl: 'https://outra/a.mp3' },
            {
              source: 'Wikimedia Commons',
              audioUrl: 'https://wiki/a.ogg',
              title: 'Nocturne',
            },
          ],
        }),
      'wiki/a.ogg': () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'audio/ogg', 'content-length': '100' },
        }),
    });

    const result = await service.searchMedia({
      workId: WORK,
      forceRefresh: true,
    });

    expect(result.spotify).toMatchObject({
      trackId: 'sp1',
      displayTitle: 'Frédéric Chopin - Arthur Rubinstein',
      thumbnail: 'big',
    });
    expect(result.youtube).toMatchObject({
      videoId: 'yt1',
      thumbnail: 'thumb',
    });
    expect(result.metadata).toMatchObject({
      audioSourceSaved: true,
      savedAudioSource: 'Wikimedia Commons',
    });
    const lastUpdate = prisma.work.update.mock.calls.at(-1)[0].data;
    expect(lastUpdate).toMatchObject({
      spotifyTrackId: 'sp1',
      youtubeVideoId: 'yt1',
      customAudioUrl: 'https://wiki/a.ogg',
    });
    expect(cache.del).toHaveBeenCalledWith(`works:detail:${WORK}`);
  });

  it('sem credenciais e com serviços fora: nada achado, sem quebrar', async () => {
    config = { 'cors.allowedOrigins': ['http://origem'] };
    route({
      'alternative-audio-sources': () => new Response('x', { status: 500 }),
    });

    const result = await service.searchMedia({
      workId: WORK,
      forceRefresh: true,
    });

    expect(result).toMatchObject({
      success: true,
      spotify: null,
      youtube: null,
      alternativeAudio: [],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://origem/api/alternative-audio-sources',
    );
  });

  it('token do Spotify recusado, busca do Spotify e do YouTube com erro', async () => {
    route({
      'accounts.spotify.com': () => new Response('', { status: 401 }),
      'googleapis.com/youtube': () => new Response('', { status: 403 }),
      'alternative-audio-sources': () =>
        json({
          sources: [{ source: 'MusOpen', audioUrl: 'https://musopen/x' }],
        }),
      musopen: () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    });

    const result = await service.searchMedia({
      workId: WORK,
      forceRefresh: true,
    });

    expect(result).toMatchObject({ spotify: null, youtube: null });
    expect(result.metadata).toMatchObject({ audioSourceSaved: false });
  });

  it('busca do Spotify com erro HTTP e sem trilha do compositor', async () => {
    let searches = 0;
    route({
      'accounts.spotify.com': () => json({ access_token: 'tok' }),
      'api.spotify.com': () =>
        ++searches === 1
          ? new Response('', { status: 500 })
          : json({
              tracks: {
                items: [
                  {
                    id: 'x',
                    name: 'Sonata piano',
                    artists: [{ name: 'Outro', id: 'o' }],
                    album: { name: 'A', images: [] },
                  },
                ],
              },
            }),
      'alternative-audio-sources': () => json({ sources: [] }),
    });

    await expect(
      service.searchMedia({ workId: WORK, forceRefresh: true }),
    ).resolves.toMatchObject({ spotify: null });
    await expect(
      service.searchMedia({ workId: WORK, forceRefresh: true }),
    ).resolves.toMatchObject({ spotify: null });
  });

  it('fonte alternativa que falha na validação é pulada', async () => {
    fetchMock.mockImplementation((input: string) =>
      String(input).includes('alternative-audio-sources')
        ? Promise.resolve(
            json({
              sources: [{ source: 'Freesound', audioUrl: 'https://fs/x' }],
            }),
          )
        : Promise.reject(new Error('timeout')),
    );
    config['mediaSearch.spotifyClientId'] = undefined;
    config['mediaSearch.youtubeApiKey'] = undefined;

    const result = await service.searchMedia({
      workId: WORK,
      forceRefresh: true,
    });

    expect(result.metadata).toMatchObject({
      audioSourceSaved: false,
      alternativeSourcesFound: 1,
    });
  });

  it('obra que já tem áudio próprio não recebe o alternativo', async () => {
    prisma.work.findUnique.mockResolvedValue(
      work({ customAudioUrl: 'https://meu/a.mp3' }),
    );
    config['mediaSearch.spotifyClientId'] = undefined;
    config['mediaSearch.youtubeApiKey'] = undefined;
    route({
      'alternative-audio-sources': () =>
        json({ sources: [{ source: 'MusOpen', audioUrl: 'x' }] }),
    });

    const result = await service.searchMedia({
      workId: WORK,
      forceRefresh: true,
    });

    expect(result.metadata).toMatchObject({ audioSourceSaved: false });
  });

  it('fontes alternativas fora do ar não derrubam a busca', async () => {
    config['mediaSearch.spotifyClientId'] = undefined;
    config['mediaSearch.youtubeApiKey'] = undefined;
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.searchMedia({ workId: WORK, forceRefresh: true }),
    ).resolves.toMatchObject({
      success: true,
      alternativeAudio: [],
    });
  });

  it('erro inesperado registra o motivo na obra e sobe', async () => {
    config['mediaSearch.spotifyClientId'] = undefined;
    config['mediaSearch.youtubeApiKey'] = undefined;
    route({ 'alternative-audio-sources': () => json({ sources: [] }) });
    prisma.work.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('mongo'))
      .mockResolvedValueOnce({});

    await expect(
      service.searchMedia({ workId: WORK, forceRefresh: true }),
    ).rejects.toThrow('mongo');
    expect(prisma.work.update).toHaveBeenLastCalledWith({
      where: { id: WORK },
      data: { mediaSearchError: 'mongo', lastMediaSearch: expect.any(Date) },
    });
  });
});

describe('MediaSearchController', () => {
  it('repassa ao serviço', async () => {
    const searchMedia = jest.fn().mockResolvedValue({ success: true });
    const controller = new MediaSearchController({
      searchMedia,
    } as unknown as MediaSearchService);

    await expect(controller.searchMedia({ workId: WORK })).resolves.toEqual({
      success: true,
    });
    expect(searchMedia).toHaveBeenCalledWith({ workId: WORK });
  });
});
