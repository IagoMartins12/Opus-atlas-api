import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScoreSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ToggleComposerFavoriteDto } from './dto/toggle-composer-favorite.dto';
import {
  ComposerFavoriteListResponseDto,
  ComposerFavoriteStatusResponseDto,
  ToggleComposerFavoriteResponseDto,
} from './dto/composer-favorite.dto';
import { ToggleWorkFavoriteDto } from './dto/toggle-work-favorite.dto';
import {
  WorkFavoriteListResponseDto,
  WorkFavoriteStatusResponseDto,
  ToggleWorkFavoriteResponseDto,
} from './dto/work-favorite.dto';
import { ToggleScoreFavoriteDto } from './dto/toggle-score-favorite.dto';
import {
  ScoreFavoriteActionResponseDto,
  ScoreFavoriteListResponseDto,
  ScoreFavoriteStatusResponseDto,
  WorkScoreStatItemDto,
  WorkScoreStatsResponseDto,
} from './dto/score-favorite.dto';
import { parseScoreType } from '../../common/utils/enum.util';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

const COMPOSER_SELECT = {
  id: true,
  name: true,
  fullName: true,
  portraitUrl: true,
  epochName: true,
} as const;

const WORK_SELECT = {
  id: true,
  title: true,
  opOrCatalog: true,
  composer: { select: { name: true, fullName: true } },
} as const;

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityTracker,
  ) {}

  // ---------------------------------------------------------------------
  // Compositores
  // ---------------------------------------------------------------------

  async toggleComposerFavorite(
    userId: string,
    dto: ToggleComposerFavoriteDto,
  ): Promise<ToggleComposerFavoriteResponseDto> {
    const composer = await this.prisma.composer.findUnique({
      where: { id: dto.composerId },
      select: { id: true },
    });

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    if (dto.action === 'add') {
      const favorite = await this.prisma.favoriteComposer.upsert({
        where: {
          userId_composerId: { userId, composerId: dto.composerId },
        },
        update: {},
        create: { userId, composerId: dto.composerId },
        include: { composer: { select: COMPOSER_SELECT } },
      });

      this.activity.track(userId, 'favorites', 'favorite.composer.added');

      return {
        success: true,
        action: 'added',
        favorite: {
          id: favorite.id,
          userId: favorite.userId,
          composerId: favorite.composerId,
          composer: favorite.composer,
        },
      };
    }

    await this.prisma.favoriteComposer.deleteMany({
      where: { userId, composerId: dto.composerId },
    });

    return { success: true, action: 'removed' };
  }

  async getComposerFavoriteStatus(
    userId: string,
    composerId: string,
  ): Promise<ComposerFavoriteStatusResponseDto> {
    const favorite = await this.prisma.favoriteComposer.findFirst({
      where: { userId, composerId },
      include: { composer: { select: COMPOSER_SELECT } },
    });

    return {
      isFavorited: !!favorite,
      favorite: favorite
        ? {
            id: favorite.id,
            userId: favorite.userId,
            composerId: favorite.composerId,
            composer: favorite.composer,
          }
        : null,
    };
  }

  async listComposerFavorites(
    userId: string,
  ): Promise<ComposerFavoriteListResponseDto> {
    const favorites = await this.prisma.favoriteComposer.findMany({
      where: { userId },
      include: { composer: { select: COMPOSER_SELECT } },
      orderBy: { composer: { name: 'asc' } },
    });

    return {
      favorites: favorites.map((fav) => ({
        id: fav.id,
        userId: fav.userId,
        composerId: fav.composerId,
        composer: fav.composer,
      })),
      count: favorites.length,
    };
  }

  // ---------------------------------------------------------------------
  // Obras
  // ---------------------------------------------------------------------

  async toggleWorkFavorite(
    userId: string,
    dto: ToggleWorkFavoriteDto,
  ): Promise<ToggleWorkFavoriteResponseDto> {
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    if (dto.action === 'add') {
      const favorite = await this.prisma.favoriteWork.upsert({
        where: { userId_workId: { userId, workId: dto.workId } },
        update: {},
        create: { userId, workId: dto.workId },
        include: { work: { select: WORK_SELECT } },
      });

      this.activity.track(userId, 'favorites', 'favorite.work.added');

      return {
        success: true,
        action: 'added',
        favorite: {
          id: favorite.id,
          userId: favorite.userId,
          workId: favorite.workId,
          work: favorite.work,
        },
      };
    }

    await this.prisma.favoriteWork.deleteMany({
      where: { userId, workId: dto.workId },
    });

    return { success: true, action: 'removed' };
  }

  async getWorkFavoriteStatus(
    userId: string,
    workId: string,
  ): Promise<WorkFavoriteStatusResponseDto> {
    const favorite = await this.prisma.favoriteWork.findFirst({
      where: { userId, workId },
      include: { work: { select: WORK_SELECT } },
    });

    return {
      isFavorited: !!favorite,
      favorite: favorite
        ? {
            id: favorite.id,
            userId: favorite.userId,
            workId: favorite.workId,
            work: favorite.work,
          }
        : null,
    };
  }

  async listWorkFavorites(
    userId: string,
  ): Promise<WorkFavoriteListResponseDto> {
    const favorites = await this.prisma.favoriteWork.findMany({
      where: { userId },
      include: { work: { select: WORK_SELECT } },
      orderBy: { work: { title: 'asc' } },
    });

    return {
      favorites: favorites.map((fav) => ({
        id: fav.id,
        userId: fav.userId,
        workId: fav.workId,
        work: fav.work,
      })),
      count: favorites.length,
    };
  }

  // ---------------------------------------------------------------------
  // Partituras
  // ---------------------------------------------------------------------

  async toggleScoreFavorite(
    userId: string,
    dto: ToggleScoreFavoriteDto,
  ): Promise<ScoreFavoriteActionResponseDto> {
    const scoreSource = dto.scoreSource ?? ScoreSource.IMSLP;

    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    if (dto.action === 'add') {
      if (!dto.scoreData) {
        throw new BadRequestException(
          'Dados da partitura são obrigatórios para adicionar',
        );
      }

      const favorite = await this.prisma.favoriteScore.upsert({
        where: {
          user_work_score_unique: {
            userId,
            workId: dto.workId,
            scoreId: dto.scoreId,
            scoreSource,
          },
        },
        update: {
          personalRating: dto.personalRating,
          notes: dto.notes,
          tags: dto.tags ?? [],
          lastAccessed: new Date(),
          accessCount: { increment: 1 },
          scoreTitle: dto.scoreData.title,
          downloadUrl: dto.scoreData.downloadUrl,
          fileSize: dto.scoreData.fileSize,
          pageCount: dto.scoreData.pageCount,
        },
        create: {
          userId,
          workId: dto.workId,
          scoreId: dto.scoreId,
          scoreSource,
          scoreTitle: dto.scoreData.title,
          scoreType: parseScoreType(dto.scoreData.type),
          downloadUrl: dto.scoreData.downloadUrl,
          fileSize: dto.scoreData.fileSize,
          pageCount: dto.scoreData.pageCount,
          personalRating: dto.personalRating,
          notes: dto.notes,
          tags: dto.tags ?? [],
          accessCount: 1,
        },
        include: { work: { select: WORK_SELECT } },
      });

      this.activity.track(userId, 'favorites', 'favorite.score.added');

      return {
        success: true,
        action: 'added',
        favorite: {
          id: favorite.id,
          userId: favorite.userId,
          workId: favorite.workId,
          scoreId: favorite.scoreId,
          scoreSource: favorite.scoreSource,
          scoreTitle: favorite.scoreTitle,
          scoreType: favorite.scoreType,
          personalRating: favorite.personalRating,
          notes: favorite.notes,
          tags: favorite.tags,
          addedAt: favorite.addedAt,
          work: favorite.work,
        },
      };
    }

    if (dto.action === 'remove') {
      await this.prisma.favoriteScore.deleteMany({
        where: {
          userId,
          workId: dto.workId,
          scoreId: dto.scoreId,
          scoreSource,
        },
      });

      return { success: true, action: 'removed' };
    }

    // action === 'update'
    const updated = await this.prisma.favoriteScore.updateMany({
      where: { userId, workId: dto.workId, scoreId: dto.scoreId, scoreSource },
      data: {
        personalRating: dto.personalRating,
        notes: dto.notes,
        tags: dto.tags,
        lastAccessed: new Date(),
        accessCount: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Favorito não encontrado para atualizar');
    }

    return { success: true, action: 'updated' };
  }

  async getScoreFavoriteStatus(
    userId: string,
    workId: string,
    scoreId: string,
    scoreSource: ScoreSource,
  ): Promise<ScoreFavoriteStatusResponseDto> {
    const favorite = await this.prisma.favoriteScore.findFirst({
      where: { userId, workId, scoreId, scoreSource },
      include: { work: { select: WORK_SELECT } },
    });

    return {
      isFavorited: !!favorite,
      favorite: favorite
        ? {
            id: favorite.id,
            userId: favorite.userId,
            workId: favorite.workId,
            scoreId: favorite.scoreId,
            scoreSource: favorite.scoreSource,
            scoreTitle: favorite.scoreTitle,
            scoreType: favorite.scoreType,
            personalRating: favorite.personalRating,
            notes: favorite.notes,
            tags: favorite.tags,
            addedAt: favorite.addedAt,
            work: favorite.work,
          }
        : null,
    };
  }

  async listScoreFavorites(
    userId: string,
    workId?: string,
  ): Promise<ScoreFavoriteListResponseDto> {
    const favorites = await this.prisma.favoriteScore.findMany({
      where: { userId, ...(workId ? { workId } : {}) },
      include: { work: { select: WORK_SELECT } },
      orderBy: { addedAt: 'desc' },
    });

    return {
      favorites: favorites.map((fav) => ({
        id: fav.id,
        userId: fav.userId,
        workId: fav.workId,
        scoreId: fav.scoreId,
        scoreSource: fav.scoreSource,
        scoreTitle: fav.scoreTitle,
        scoreType: fav.scoreType,
        personalRating: fav.personalRating,
        notes: fav.notes,
        tags: fav.tags,
        addedAt: fav.addedAt,
        work: fav.work,
      })),
      count: favorites.length,
    };
  }

  /**
   * Estatísticas de favoritos por partitura de uma obra, calculadas em tempo real
   * a partir de `FavoriteScore` — sem tabela de cache dedicada (simplificação
   * deliberada em relação ao legado `ScoreFavoriteStats`; ver ROADMAP.md).
   */
  async getWorkScoreStats(workId: string): Promise<WorkScoreStatsResponseDto> {
    const favorites = await this.prisma.favoriteScore.findMany({
      where: { workId },
      select: {
        scoreId: true,
        scoreSource: true,
        scoreTitle: true,
        scoreType: true,
        downloadUrl: true,
        personalRating: true,
      },
    });

    const grouped = new Map<
      string,
      WorkScoreStatItemDto & { ratings: number[] }
    >();

    for (const fav of favorites) {
      const key = `${fav.scoreId}-${fav.scoreSource}`;
      const entry = grouped.get(key) ?? {
        workId,
        scoreId: fav.scoreId,
        scoreSource: fav.scoreSource,
        scoreTitle: fav.scoreTitle,
        scoreType: fav.scoreType,
        downloadUrl: fav.downloadUrl,
        totalFavorites: 0,
        avgRating: null,
        ratings: [] as number[],
      };

      entry.totalFavorites += 1;
      if (fav.personalRating) {
        entry.ratings.push(fav.personalRating);
      }
      grouped.set(key, entry);
    }

    const topScores = Array.from(grouped.values())
      .map(({ ratings, ...rest }) => ({
        ...rest,
        avgRating:
          ratings.length > 0
            ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
            : null,
      }))
      .sort((a, b) => b.totalFavorites - a.totalFavorites)
      .slice(0, 20);

    return {
      totalFavorites: topScores.reduce((sum, s) => sum + s.totalFavorites, 0),
      totalScores: topScores.length,
      mostFavorited: topScores[0] ?? null,
      topScores,
    };
  }

  async getMostFavoritedScore(workId: string): Promise<WorkScoreStatItemDto[]> {
    const stats = await this.getWorkScoreStats(workId);
    return stats.mostFavorited ? [stats.mostFavorited] : [];
  }
}
