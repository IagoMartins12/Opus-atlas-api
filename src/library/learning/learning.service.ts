import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StorageAssetKind, StorageAssetStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import { WORK_SCORE_REF_SELECT } from '../dto/work-score-ref.dto';
import {
  AddWantToLearnDto,
  UpdateWantToLearnDto,
} from './dto/want-to-learn.dto';
import { AddLearnedDto, UpdateLearnedDto } from './dto/learned.dto';
import {
  calculateProgress,
  getMilestonesByInstrument,
} from './utils/progress-milestones.util';
import { toJsonInput } from '../../common/utils/json.util';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

const WORK_SELECT = {
  id: true,
  title: true,
  opOrCatalog: true,
  composer: { select: { name: true, fullName: true } },
} as const;

const WORK_SELECT_WITH_INSTRUMENT = {
  ...WORK_SELECT,
  instrument: { select: { name: true } },
} as const;

/** Os campos do vídeo de performance, zerados — o item sem vídeo. */
const NO_VIDEO = {
  videoUrl: null,
  videoFileName: null,
  videoFilePath: null,
  videoFileSize: null,
  videoUploadedAt: null,
  isVideoPublic: false,
} as const;

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityTracker,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------
  // Want to learn
  // ---------------------------------------------------------------------

  async addOrRemoveWantToLearn(userId: string, dto: AddWantToLearnDto) {
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true, instrument: { select: { name: true } } },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    if (dto.action === 'remove') {
      await this.prisma.wantToLearn.deleteMany({
        where: { userId, workId: dto.workId },
      });

      return { success: true, action: 'removed' as const };
    }

    await this.assertWorkScoreBelongsToWork(
      dto.selectedWorkScoreId,
      dto.workId,
    );

    // Exclusão mútua com "já aprendi" (mesma obra não fica nas duas listas).
    await this.prisma.learned.deleteMany({
      where: { userId, workId: dto.workId },
    });

    let progress: number | undefined;
    if (dto.progressMilestones) {
      const milestones = getMilestonesByInstrument(work.instrument?.name);
      progress = calculateProgress(
        dto.progressMilestones as Record<string, boolean>,
        milestones,
      );
    }

    const item = await this.prisma.wantToLearn.upsert({
      where: { userId_workId: { userId, workId: dto.workId } },
      update: {
        priority: dto.priority,
        notes: dto.notes,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        estimatedStudyTime: dto.estimatedStudyTime,
        difficulty: dto.difficulty,
        motivation: dto.motivation,
        context: dto.context,
        selectedWorkScoreId: dto.selectedWorkScoreId,
        progressMilestones: toJsonInput(dto.progressMilestones),
        ...(progress !== undefined ? { progress } : {}),
      },
      create: {
        userId,
        workId: dto.workId,
        priority: dto.priority ?? 0,
        notes: dto.notes,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        estimatedStudyTime: dto.estimatedStudyTime,
        difficulty: dto.difficulty,
        motivation: dto.motivation,
        context: dto.context,
        selectedWorkScoreId: dto.selectedWorkScoreId,
        progressMilestones: toJsonInput(dto.progressMilestones),
        progress,
      },
      include: {
        work: { select: WORK_SELECT_WITH_INSTRUMENT },
        selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
      },
    });

    this.activity.track(userId, 'learning', 'learning.want-to-learn.added');

    return { success: true, action: 'added' as const, item };
  }

  async updateWantToLearn(userId: string, dto: UpdateWantToLearnDto) {
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true, instrument: { select: { name: true } } },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    await this.assertWorkScoreBelongsToWork(
      dto.selectedWorkScoreId,
      dto.workId,
    );

    let progress: number | undefined;
    if (dto.progressMilestones) {
      const milestones = getMilestonesByInstrument(work.instrument?.name);
      progress = calculateProgress(
        dto.progressMilestones as Record<string, boolean>,
        milestones,
      );
    }

    const updated = await this.prisma.wantToLearn.updateMany({
      where: { userId, workId: dto.workId },
      data: {
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.targetDate !== undefined
          ? { targetDate: dto.targetDate ? new Date(dto.targetDate) : null }
          : {}),
        ...(dto.estimatedStudyTime !== undefined
          ? { estimatedStudyTime: dto.estimatedStudyTime }
          : {}),
        ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
        ...(dto.motivation !== undefined ? { motivation: dto.motivation } : {}),
        ...(dto.context !== undefined ? { context: dto.context } : {}),
        ...(dto.selectedWorkScoreId !== undefined
          ? { selectedWorkScoreId: dto.selectedWorkScoreId }
          : {}),
        ...(dto.progressMilestones !== undefined
          ? {
              progressMilestones: toJsonInput(dto.progressMilestones),
              progress,
            }
          : {}),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Item não encontrado na lista de desejos');
    }

    const item = await this.prisma.wantToLearn.findFirst({
      where: { userId, workId: dto.workId },
      include: {
        work: { select: WORK_SELECT_WITH_INSTRUMENT },
        selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
      },
    });

    return { success: true, item };
  }

  async getWantToLearn(userId: string, workId?: string) {
    if (workId) {
      const item = await this.prisma.wantToLearn.findFirst({
        where: { userId, workId },
        include: {
          work: { select: WORK_SELECT_WITH_INSTRUMENT },
          selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
        },
      });

      return { wantToLearn: !!item, item };
    }

    const items = await this.prisma.wantToLearn.findMany({
      where: { userId },
      include: {
        work: { select: WORK_SELECT_WITH_INSTRUMENT },
        selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
      },
      orderBy: [{ priority: 'desc' }, { addedAt: 'desc' }],
    });

    return { items, count: items.length };
  }

  // ---------------------------------------------------------------------
  // Learned
  // ---------------------------------------------------------------------

  async addOrRemoveLearned(userId: string, dto: AddLearnedDto) {
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    const previous = await this.prisma.learned.findFirst({
      where: { userId, workId: dto.workId },
      select: { videoUrl: true },
    });

    if (dto.action === 'remove') {
      await this.prisma.learned.deleteMany({
        where: { userId, workId: dto.workId },
      });
      await this.dropVideo(userId, previous?.videoUrl);

      return { success: true, action: 'removed' as const };
    }

    await this.assertWorkScoreBelongsToWork(
      dto.selectedWorkScoreId,
      dto.workId,
    );

    const video = dto.videoAssetId
      ? await this.videoFields(userId, dto.videoAssetId, dto.videoFileName)
      : {};

    // Exclusão mútua com "quero aprender".
    await this.prisma.wantToLearn.deleteMany({
      where: { userId, workId: dto.workId },
    });

    const data = {
      ...video,
      isVideoPublic: dto.isVideoPublic,
      userId,
      workId: dto.workId,
      mastery: dto.mastery ?? 0,
      studyStartDate: dto.studyStartDate
        ? new Date(dto.studyStartDate)
        : undefined,
      studyDuration: dto.studyDuration,
      notes: dto.notes,
      wouldRecommend: dto.wouldRecommend,
      publicPerformance: dto.publicPerformance,
      difficulty: dto.difficulty,
      enjoyment: dto.enjoyment,
      technicalChallenges: dto.technicalChallenges,
      musicalInsights: dto.musicalInsights,
      selectedWorkScoreId: dto.selectedWorkScoreId,
    };

    const item = await this.prisma.learned.upsert({
      where: { userId_workId: { userId, workId: dto.workId } },
      update: { ...data, learnedAt: new Date() },
      create: data,
      include: {
        work: { select: WORK_SELECT },
        selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
      },
    });

    if ('videoUrl' in video && previous?.videoUrl !== video.videoUrl) {
      await this.dropVideo(userId, previous?.videoUrl);
    }

    this.activity.track(userId, 'learning', 'learning.learned.added');

    return { success: true, action: 'added' as const, item };
  }

  async updateLearned(userId: string, dto: UpdateLearnedDto) {
    const existing = await this.prisma.learned.findFirst({
      where: { userId, workId: dto.workId },
    });

    if (!existing) {
      throw new NotFoundException('Item não encontrado na lista de aprendidas');
    }

    await this.assertWorkScoreBelongsToWork(
      dto.selectedWorkScoreId,
      dto.workId,
    );

    if (dto.removeVideo && dto.videoAssetId) {
      throw new BadRequestException(
        'Troque o vídeo ou tire o vídeo, não os dois',
      );
    }

    const video = dto.removeVideo
      ? NO_VIDEO
      : dto.videoAssetId
        ? await this.videoFields(userId, dto.videoAssetId, dto.videoFileName)
        : {};

    const updated = await this.prisma.learned.updateMany({
      where: { userId, workId: dto.workId },
      data: {
        ...(dto.isVideoPublic !== undefined
          ? { isVideoPublic: dto.isVideoPublic }
          : {}),
        ...video,
        ...(dto.mastery !== undefined
          ? { mastery: dto.mastery, learnedAt: new Date() }
          : {}),
        ...(dto.studyStartDate !== undefined
          ? {
              studyStartDate: dto.studyStartDate
                ? new Date(dto.studyStartDate)
                : null,
            }
          : {}),
        ...(dto.studyDuration !== undefined
          ? { studyDuration: dto.studyDuration }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.wouldRecommend !== undefined
          ? { wouldRecommend: dto.wouldRecommend }
          : {}),
        ...(dto.publicPerformance !== undefined
          ? { publicPerformance: dto.publicPerformance }
          : {}),
        ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
        ...(dto.enjoyment !== undefined ? { enjoyment: dto.enjoyment } : {}),
        ...(dto.technicalChallenges !== undefined
          ? { technicalChallenges: dto.technicalChallenges }
          : {}),
        ...(dto.musicalInsights !== undefined
          ? { musicalInsights: dto.musicalInsights }
          : {}),
        ...(dto.selectedWorkScoreId !== undefined
          ? { selectedWorkScoreId: dto.selectedWorkScoreId }
          : {}),
      },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Item não encontrado na lista de aprendidas');
    }

    // O vídeo que saiu (tirado ou trocado) sai também do armazenamento.
    if ('videoUrl' in video && existing.videoUrl !== video.videoUrl) {
      await this.dropVideo(userId, existing.videoUrl);
    }

    const item = await this.prisma.learned.findFirst({
      where: { userId, workId: dto.workId },
      include: {
        work: { select: WORK_SELECT },
        selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
      },
    });

    return { success: true, item };
  }

  async getLearned(userId: string, workId?: string) {
    if (workId) {
      const item = await this.prisma.learned.findFirst({
        where: { userId, workId },
        include: {
          work: { select: WORK_SELECT },
          selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
        },
      });

      return { learned: !!item, item };
    }

    const items = await this.prisma.learned.findMany({
      where: { userId },
      include: {
        work: { select: WORK_SELECT },
        selectedWorkScore: { select: WORK_SCORE_REF_SELECT },
      },
      orderBy: [{ mastery: 'desc' }, { learnedAt: 'desc' }],
    });

    return { items, count: items.length };
  }

  /**
   * Os campos do vídeo de performance a partir do arquivo enviado. O vídeo
   * sobe direto ao armazenamento (`POST /uploads/signed`, `PERFORMANCE_VIDEO`)
   * e precisa ser de quem pede e estar com o envio confirmado.
   */
  private async videoFields(
    userId: string,
    assetId: string,
    fileName?: string,
  ) {
    const asset = await this.prisma.storedAsset.findUnique({
      where: { id: assetId },
      select: {
        ownerId: true,
        kind: true,
        status: true,
        secureUrl: true,
        bytes: true,
      },
    });

    if (
      !asset ||
      asset.ownerId !== userId ||
      asset.kind !== StorageAssetKind.PERFORMANCE_VIDEO ||
      asset.status !== StorageAssetStatus.ACTIVE ||
      !asset.secureUrl
    ) {
      throw new BadRequestException(
        'Vídeo não encontrado, de outra conta ou com o envio não confirmado',
      );
    }

    return {
      videoUrl: asset.secureUrl,
      videoFileName: fileName ?? null,
      videoFilePath: null,
      videoFileSize: asset.bytes ?? null,
      videoUploadedAt: new Date(),
    };
  }

  /**
   * Apaga do armazenamento o vídeo que saiu do item. Vídeo do legado (no disco
   * do Next) não tem registro aqui e fica onde está. Falha no provedor não
   * desfaz a mudança do item: o arquivo vira órfão, e a varredura o acha.
   */
  private async dropVideo(
    userId: string,
    videoUrl: string | null | undefined,
  ): Promise<void> {
    if (!videoUrl) return;

    const asset = await this.prisma.storedAsset.findFirst({
      where: {
        ownerId: userId,
        kind: StorageAssetKind.PERFORMANCE_VIDEO,
        secureUrl: videoUrl,
        status: { not: StorageAssetStatus.DELETED },
      },
      select: { id: true },
    });

    if (!asset) return;

    try {
      await this.storage.deleteAsset(asset.id);
    } catch (error) {
      this.logger.warn(
        `Vídeo de performance ${asset.id} não foi apagado: ${errorMessage(error)}`,
      );
    }
  }

  private async assertWorkScoreBelongsToWork(
    selectedWorkScoreId: string | undefined,
    workId: string,
  ): Promise<void> {
    if (!selectedWorkScoreId) return;

    const exists = await this.prisma.workScore.findFirst({
      where: { id: selectedWorkScoreId, workId, isActive: true },
      select: { id: true },
    });

    if (!exists) {
      throw new BadRequestException(
        'Partitura não encontrada ou não pertence a esta obra',
      );
    }
  }
}
