import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppCacheService } from '../common/cache/cache.service';
import { workDetailCacheKey } from '../catalog/works/work-cache-keys';
import { PrismaService } from '../prisma/prisma.service';
import { MediaSearchRequestDto } from './dto/media-search-request.dto';
import { MediaSearchResponseDto } from './dto/media-search-response.dto';
import {
  generateSimpleQuery,
  isValidClassicalResult,
  isValidForAutoSearch,
  isValidMusicVideo,
} from './media-search.helpers';

type SearchableWork = {
  id: string;
  title: string;
  workType: string;
  movementNumber: number | null;
  opOrCatalog: string | null;
  tone: string | null;
  moviment: string | null;
  spotifyTrackId: string | null;
  spotifyTrackUrl: string | null;
  spotifyDisplayTitle: string | null;
  spotifyDuration: number | null;
  spotifyArtists: unknown;
  spotifyThumbnail: string | null;
  youtubeVideoId: string | null;
  youtubeVideoUrl: string | null;
  youtubeTitle: string | null;
  customAudioUrl: string | null;
  workGenresArr: string[];
  composer: { fullName: string };
  instrument: { name: string } | null;
};

type SpotifyTrack = {
  id: string;
  name: string;
  artists: Array<{ name: string; id: string }>;
  album: {
    name: string;
    images: Array<{ url: string; height: number; width: number }>;
  };
  duration_ms: number;
  popularity: number;
  preview_url: string | null;
  external_urls: { spotify: string };
};

type YouTubeVideo = {
  id: { videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
      medium?: { url: string };
    };
  };
};

type AlternativeAudioSource = {
  source: string;
  audioUrl: string;
  duration?: number | null;
  quality?: string | null;
  license?: string | null;
  title?: string | null;
  artist?: string | null;
  fileSize?: string | null;
  format?: string | null;
  validatedAt?: string | null;
  contentType?: string | null;
  contentLength?: string | null;
};

@Injectable()
export class MediaSearchService {
  private readonly logger = new Logger(MediaSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cache: AppCacheService,
  ) {}

  async searchMedia(
    body: MediaSearchRequestDto,
  ): Promise<MediaSearchResponseDto> {
    const { workId, forceRefresh = false } = body;

    const work = await this.prisma.work.findUnique({
      where: { id: workId },
      select: {
        id: true,
        title: true,
        workType: true,
        movementNumber: true,
        opOrCatalog: true,
        tone: true,
        moviment: true,
        spotifyTrackId: true,
        spotifyTrackUrl: true,
        spotifyDisplayTitle: true,
        spotifyDuration: true,
        spotifyArtists: true,
        spotifyThumbnail: true,
        youtubeVideoId: true,
        youtubeVideoUrl: true,
        youtubeTitle: true,
        customAudioUrl: true,
        workGenresArr: true,
        composer: {
          select: {
            fullName: true,
          },
        },
        instrument: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!work) {
      throw new NotFoundException(`Obra com id "${workId}" não encontrada`);
    }

    if (!forceRefresh && (work.spotifyTrackId || work.youtubeVideoId)) {
      const alternativeAudio = await this.searchAlternativeAudioSources(work);

      return {
        success: true,
        message: 'Mídia já existe',
        spotify: work.spotifyTrackId
          ? {
              trackId: work.spotifyTrackId,
              trackUrl: work.spotifyTrackUrl ?? '',
              displayTitle: work.spotifyDisplayTitle,
              duration: work.spotifyDuration,
              artists: this.parseArtistsFromStorage(work.spotifyArtists),
              thumbnail: work.spotifyThumbnail,
              albumArt: work.spotifyThumbnail,
              previewUrl: null,
              albumName: null,
              popularity: null,
            }
          : null,
        youtube: work.youtubeVideoId
          ? {
              videoId: work.youtubeVideoId,
              videoUrl: work.youtubeVideoUrl ?? '',
              thumbnail: null,
              title: work.youtubeTitle ?? '',
              channel: null,
              publishedAt: null,
            }
          : null,
        alternativeAudio,
        metadata: {
          audioSourceSaved: false,
          alternativeSourcesFound: alternativeAudio.length,
        },
      };
    }

    if (!isValidForAutoSearch(work)) {
      await this.prisma.work.update({
        where: { id: workId },
        data: {
          lastMediaSearch: new Date(),
          mediaSearchError:
            'Obra não válida para busca automática (coletânea/livro)',
        },
      });

      return {
        success: false,
        error:
          'Esta obra não é válida para busca automática (coletânea, livro ou obra muito genérica).',
        alternativeAudio: [],
      };
    }

    this.logger.log(
      `Iniciando busca de mídia para ${work.title} - ${work.composer.fullName}`,
    );

    await this.prisma.work.update({
      where: { id: workId },
      data: {
        lastMediaSearch: new Date(),
      },
    });

    const startedAt = Date.now();

    try {
      const [spotifyResult, youtubeResult, alternativeAudioResult] =
        await Promise.all([
          this.searchSpotifyFirst(work),
          this.searchYouTubeFirst(work),
          this.searchAlternativeAudioSources(work),
        ]);

      let updateData: Record<string, unknown> = {
        lastMediaSearch: new Date(),
        mediaSearchError: null,
        mediaSource: 'auto',
      };

      let spotifyResponse: MediaSearchResponseDto['spotify'] = null;
      let youtubeResponse: MediaSearchResponseDto['youtube'] = null;
      let audioSourceSaved = false;
      let savedAudioUrl: string | null = null;
      let savedAudioSource: string | null = null;

      if (spotifyResult) {
        const composer = spotifyResult.artists.find((artist) => {
          const composerName = work.composer.fullName.toLowerCase();
          const artistName = artist.name.toLowerCase();
          return (
            composerName.includes(artistName) ||
            artistName.includes(composerName)
          );
        });

        const interpreters = spotifyResult.artists.filter(
          (artist) => artist !== composer,
        );

        const displayTitle =
          composer && interpreters.length > 0
            ? `${composer.name} - ${interpreters.map((artist) => artist.name).join(', ')}`
            : spotifyResult.artists.map((artist) => artist.name).join(', ');

        const thumbnail =
          spotifyResult.album.images.length > 0
            ? [...spotifyResult.album.images].sort(
                (left, right) => (right.height || 0) - (left.height || 0),
              )[0].url
            : null;

        spotifyResponse = {
          trackId: spotifyResult.id,
          trackUrl: spotifyResult.external_urls.spotify,
          displayTitle,
          previewUrl: spotifyResult.preview_url,
          albumArt: thumbnail,
          thumbnail,
          artists: spotifyResult.artists.map((artist) => artist.name),
          albumName: spotifyResult.album.name,
          duration: spotifyResult.duration_ms,
          popularity: spotifyResult.popularity,
        };

        updateData = {
          ...updateData,
          spotifyTrackId: spotifyResult.id,
          spotifyTrackUrl: spotifyResult.external_urls.spotify,
          spotifyDisplayTitle: displayTitle,
          spotifyDuration: spotifyResult.duration_ms,
          spotifyArtists: spotifyResult.artists,
          spotifyThumbnail: thumbnail,
        };
      }

      if (youtubeResult) {
        youtubeResponse = {
          videoId: youtubeResult.id.videoId,
          videoUrl: `https://www.youtube.com/watch?v=${youtubeResult.id.videoId}`,
          thumbnail: youtubeResult.snippet.thumbnails.medium?.url ?? null,
          title: youtubeResult.snippet.title,
          channel: youtubeResult.snippet.channelTitle,
          publishedAt: youtubeResult.snippet.publishedAt,
        };

        updateData = {
          ...updateData,
          youtubeVideoId: youtubeResult.id.videoId,
          youtubeVideoUrl: `https://www.youtube.com/watch?v=${youtubeResult.id.videoId}`,
          youtubeTitle: youtubeResult.snippet.title,
        };
      }

      if (alternativeAudioResult.length > 0 && !work.customAudioUrl) {
        const firstValidSource = await this.validateFirstAudioSource(
          alternativeAudioResult,
        );

        if (firstValidSource) {
          updateData = {
            ...updateData,
            customAudioUrl: firstValidSource.audioUrl,
            customAudioSource: firstValidSource.source,
            customAudioMetadata: {
              title: firstValidSource.title,
              source: firstValidSource.source,
              quality: firstValidSource.quality,
              license: firstValidSource.license,
              duration: firstValidSource.duration,
              format: firstValidSource.format,
              autoSavedAt: new Date().toISOString(),
            },
          };

          audioSourceSaved = true;
          savedAudioUrl = firstValidSource.audioUrl;
          savedAudioSource = firstValidSource.source;
        }
      }

      await this.prisma.work.update({
        where: { id: workId },
        data: updateData,
      });
      // O detalhe da obra mostra o áudio e os vídeos que acabaram de ser gravados.
      await this.cache.del(workDetailCacheKey(workId));

      return {
        success: true,
        spotify: spotifyResponse,
        youtube: youtubeResponse,
        alternativeAudio: alternativeAudioResult,
        metadata: {
          processingTime: Date.now() - startedAt,
          alternativeSourcesFound: alternativeAudioResult.length,
          spotifyThumbnailSaved: Boolean(updateData.spotifyThumbnail),
          audioSourceSaved,
          savedAudioUrl,
          savedAudioSource,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido';

      await this.prisma.work.update({
        where: { id: workId },
        data: {
          mediaSearchError: message,
          lastMediaSearch: new Date(),
        },
      });

      throw error;
    }
  }

  private async searchSpotifyFirst(
    work: SearchableWork,
  ): Promise<SpotifyTrack | null> {
    const clientId = this.configService.get<string>(
      'mediaSearch.spotifyClientId',
    );
    const clientSecret = this.configService.get<string>(
      'mediaSearch.spotifyClientSecret',
    );

    if (!clientId || !clientSecret) {
      this.logger.warn('Credenciais do Spotify não configuradas');
      return null;
    }

    const token = await this.getSpotifyAccessToken(clientId, clientSecret);
    if (!token) {
      return null;
    }

    const query = generateSimpleQuery(work);
    const response = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=20&market=BR`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      this.logger.warn(
        `Spotify retornou ${response.status} para query ${query}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      tracks?: { items?: SpotifyTrack[] };
    };

    for (const track of data.tracks?.items ?? []) {
      const artistNames = track.artists.map((artist) => artist.name).join(', ');
      if (!isValidClassicalResult(track.name, artistNames)) {
        continue;
      }

      const composerName = work.composer.fullName.toLowerCase();
      const trackData = `${track.name} ${artistNames}`.toLowerCase();
      if (
        trackData.includes(composerName) ||
        composerName.split(' ').some((part) => part && trackData.includes(part))
      ) {
        return track;
      }
    }

    return null;
  }

  private async getSpotifyAccessToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string | null> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      this.logger.warn(`Falha ao obter token do Spotify: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { access_token?: string };
    return data.access_token ?? null;
  }

  private async searchYouTubeFirst(
    work: SearchableWork,
  ): Promise<YouTubeVideo | null> {
    const apiKey = this.configService.get<string>('mediaSearch.youtubeApiKey');
    if (!apiKey) {
      this.logger.warn('YOUTUBE_API_KEY não configurada');
      return null;
    }

    const query = generateSimpleQuery(work);
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '20');
    searchUrl.searchParams.set('order', 'relevance');
    searchUrl.searchParams.set('key', apiKey);

    const response = await fetch(searchUrl.toString());
    if (!response.ok) {
      this.logger.warn(
        `YouTube retornou ${response.status} para query ${query}`,
      );
      return null;
    }

    const data = (await response.json()) as { items?: YouTubeVideo[] };
    for (const video of data.items ?? []) {
      if (!isValidMusicVideo(video.snippet.title)) {
        continue;
      }

      if (
        !isValidClassicalResult(video.snippet.title, video.snippet.channelTitle)
      ) {
        continue;
      }

      const composerName = work.composer.fullName.toLowerCase();
      const videoData =
        `${video.snippet.title} ${video.snippet.channelTitle}`.toLowerCase();
      if (
        videoData.includes(composerName) ||
        composerName.split(' ').some((part) => part && videoData.includes(part))
      ) {
        return video;
      }
    }

    return null;
  }

  private async searchAlternativeAudioSources(
    work: SearchableWork,
  ): Promise<AlternativeAudioSource[]> {
    const frontendBaseUrl =
      this.configService.get<string>('mediaSearch.frontendBaseUrl') ||
      this.configService.get<string[]>('cors.allowedOrigins', [])[0] ||
      'http://localhost:3000';

    try {
      const response = await fetch(
        `${frontendBaseUrl}/api/alternative-audio-sources`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: work.title,
            composer: work.composer.fullName,
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Falha ao buscar fontes alternativas: ${response.status}`,
        );
        return [];
      }

      const data = (await response.json()) as {
        sources?: AlternativeAudioSource[];
      };

      return data.sources ?? [];
    } catch (error) {
      this.logger.warn('Erro ao buscar fontes alternativas', error as Error);
      return [];
    }
  }

  private async validateFirstAudioSource(
    sources: AlternativeAudioSource[],
  ): Promise<AlternativeAudioSource | null> {
    const priorityOrder = [
      'Wikimedia Commons',
      'Internet Archive',
      'MusOpen',
      'IMSLP Recordings',
      'Classical Music Archive',
      'Freesound',
    ];

    const sortedSources = [...sources].sort((left, right) => {
      const leftIndex = priorityOrder.indexOf(left.source);
      const rightIndex = priorityOrder.indexOf(right.source);
      return (
        (leftIndex === -1 ? 999 : leftIndex) -
        (rightIndex === -1 ? 999 : rightIndex)
      );
    });

    for (const source of sortedSources.slice(0, 3)) {
      try {
        const headResponse = await fetch(source.audioUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
          headers: {
            'User-Agent': 'OpusAtlas/1.0 (Classical Music Encyclopedia)',
          },
        });

        if (!headResponse.ok) {
          continue;
        }

        const contentType = headResponse.headers.get('content-type');
        const contentLength = headResponse.headers.get('content-length');

        if (contentType?.startsWith('audio/')) {
          return {
            ...source,
            validatedAt: new Date().toISOString(),
            contentType,
            contentLength,
          };
        }
      } catch (error) {
        this.logger.debug(
          `Falha ao validar fonte ${source.source}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return null;
  }

  private parseArtistsFromStorage(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((artist) => {
          if (typeof artist === 'string') {
            return artist;
          }

          if (artist && typeof artist === 'object' && 'name' in artist) {
            return String((artist as { name: unknown }).name);
          }

          return null;
        })
        .filter((artist): artist is string => Boolean(artist));
    }

    if (typeof value === 'string') {
      try {
        return this.parseArtistsFromStorage(JSON.parse(value));
      } catch {
        return [];
      }
    }

    return [];
  }
}
