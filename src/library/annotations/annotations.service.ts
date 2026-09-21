import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { ListAnnotationsQueryDto } from './dto/list-annotations-query.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';
import { ActivityTracker } from '../../common/events/activity-tracker.service';

const AUTHOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  image: true,
  userType: true,
  experienceLevel: true,
} as const;

const WORK_SELECT = {
  id: true,
  title: true,
  composer: { select: { name: true, fullName: true } },
} as const;

const ANNOTATION_INCLUDE = {
  user: { select: AUTHOR_SELECT },
  work: { select: WORK_SELECT },
  _count: { select: { helpfulVotes: true } },
} as const;

@Injectable()
export class AnnotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityTracker,
  ) {}

  async create(userId: string, dto: CreateAnnotationDto) {
    const work = await this.prisma.work.findUnique({
      where: { id: dto.workId },
      select: { id: true },
    });

    if (!work) {
      throw new NotFoundException('Obra não encontrada');
    }

    const annotation = await this.prisma.workAnnotation.create({
      data: {
        userId,
        workId: dto.workId,
        title: dto.title.trim(),
        content: dto.content.trim(),
        category: dto.category,
        scope: dto.scope,
        measureStart: dto.measureStart,
        measureEnd: dto.measureEnd,
        movement: dto.movement?.trim(),
        section: dto.section?.trim(),
        pageNumber: dto.pageNumber,
        hand: dto.hand,
        voice: dto.voice,
        instrument: dto.instrument?.trim(),
        difficulty: dto.difficulty,
        tags: (dto.tags ?? []).filter((tag) => tag.trim().length > 0),
        isPublic: dto.isPublic,
      },
      include: ANNOTATION_INCLUDE,
    });

    await Promise.all([
      this.prisma.work.update({
        where: { id: dto.workId },
        data: {
          annotationsCount: { increment: 1 },
          lastAnnotationAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { totalAnnotationsCount: { increment: 1 } },
      }),
    ]);

    this.activity.track(userId, 'annotations', 'annotation.created');

    return { success: true, annotation: { ...annotation, userVote: null } };
  }

  async findAll(query: ListAnnotationsQueryDto, currentUserId?: string) {
    const { workId, category, difficulty, scope, userId, search } = query;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.WorkAnnotationWhereInput = {
      ...(workId ? { workId } : {}),
      ...(category ? { category } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(scope ? { scope } : {}),
      ...(userId ? { userId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: escapeRegex(search), mode: 'insensitive' } },
              {
                content: { contains: escapeRegex(search), mode: 'insensitive' },
              },
              { tags: { has: search } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.WorkAnnotationOrderByWithRelationInput[] =
      query.sortBy === 'recent'
        ? [{ createdAt: 'desc' }]
        : query.sortBy === 'oldest'
          ? [{ createdAt: 'asc' }]
          : [{ helpfulCount: 'desc' }, { createdAt: 'desc' }];

    const [annotations, total] = await Promise.all([
      this.prisma.workAnnotation.findMany({
        where,
        include: ANNOTATION_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workAnnotation.count({ where }),
    ]);

    const userVotes = currentUserId
      ? await this.prisma.annotationHelpfulVote.findMany({
          where: {
            userId: currentUserId,
            annotationId: { in: annotations.map((a) => a.id) },
          },
        })
      : [];

    if (annotations.length > 0) {
      await this.prisma.workAnnotation.updateMany({
        where: { id: { in: annotations.map((a) => a.id) } },
        data: { viewCount: { increment: 1 } },
      });
    }

    return {
      annotations: annotations.map((annotation) => ({
        ...annotation,
        viewCount: annotation.viewCount + 1,
        userVote:
          userVotes.find((vote) => vote.annotationId === annotation.id)
            ?.isHelpful ?? null,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  async findOne(id: string, currentUserId?: string) {
    const annotation = await this.prisma.workAnnotation.findUnique({
      where: { id },
      include: ANNOTATION_INCLUDE,
    });

    if (!annotation) {
      throw new NotFoundException('Anotação não encontrada');
    }

    if (!annotation.isPublic && annotation.userId !== currentUserId) {
      throw new NotFoundException('Anotação não encontrada');
    }

    let userVote: boolean | null = null;
    if (currentUserId) {
      const vote = await this.prisma.annotationHelpfulVote.findUnique({
        where: {
          userId_annotationId: { userId: currentUserId, annotationId: id },
        },
      });
      userVote = vote?.isHelpful ?? null;
    }

    await this.prisma.workAnnotation.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return {
      success: true,
      annotation: {
        ...annotation,
        viewCount: annotation.viewCount + 1,
        userVote,
      },
    };
  }

  async update(id: string, userId: string, dto: UpdateAnnotationDto) {
    const existing = await this.prisma.workAnnotation.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Anotação não encontrada ou sem permissão');
    }

    const updated = await this.prisma.workAnnotation.update({
      where: { id },
      data: {
        ...dto,
        title: dto.title?.trim(),
        content: dto.content?.trim(),
        movement: dto.movement?.trim(),
        section: dto.section?.trim(),
        instrument: dto.instrument?.trim(),
      },
      include: ANNOTATION_INCLUDE,
    });

    const vote = await this.prisma.annotationHelpfulVote.findUnique({
      where: { userId_annotationId: { userId, annotationId: id } },
    });

    return {
      success: true,
      annotation: { ...updated, userVote: vote?.isHelpful ?? null },
    };
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.workAnnotation.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Anotação não encontrada ou sem permissão');
    }

    await this.prisma.workAnnotation.delete({ where: { id } });

    await Promise.all([
      this.prisma.work.update({
        where: { id: existing.workId },
        data: { annotationsCount: { decrement: 1 } },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { totalAnnotationsCount: { decrement: 1 } },
      }),
    ]);
  }

  async vote(id: string, userId: string, isHelpful: boolean) {
    const annotation = await this.prisma.workAnnotation.findUnique({
      where: { id },
      select: { id: true, userId: true, isPublic: true },
    });

    if (!annotation) {
      throw new NotFoundException('Anotação não encontrada');
    }

    if (annotation.userId === userId) {
      throw new BadRequestException('Não é possível votar na própria anotação');
    }

    if (!annotation.isPublic) {
      throw new ForbiddenException('Não é possível votar em anotação privada');
    }

    const existingVote = await this.prisma.annotationHelpfulVote.findUnique({
      where: { userId_annotationId: { userId, annotationId: id } },
    });

    let newUserVote: boolean | null = null;
    let helpfulCountChange = 0;

    if (!existingVote) {
      await this.prisma.annotationHelpfulVote.create({
        data: { userId, annotationId: id, isHelpful },
      });
      newUserVote = isHelpful;
      if (isHelpful) helpfulCountChange = 1;
    } else if (existingVote.isHelpful === isHelpful) {
      await this.prisma.annotationHelpfulVote.delete({
        where: { userId_annotationId: { userId, annotationId: id } },
      });
      newUserVote = null;
      if (existingVote.isHelpful) helpfulCountChange = -1;
    } else {
      await this.prisma.annotationHelpfulVote.update({
        where: { userId_annotationId: { userId, annotationId: id } },
        data: { isHelpful },
      });
      newUserVote = isHelpful;
      helpfulCountChange = isHelpful ? 1 : -1;
    }

    const updated = await this.prisma.workAnnotation.update({
      where: { id },
      data: { helpfulCount: { increment: helpfulCountChange } },
      select: { helpfulCount: true },
    });

    // O voto útil conta para as conquistas do AUTOR da anotação, não de quem
    // votou — os badges de "primeira ajuda" e "expert útil" medem o
    // reconhecimento recebido.
    if (helpfulCountChange > 0) {
      this.activity.track(
        annotation.userId,
        'annotations',
        'annotation.helpful-vote.received',
      );
    }

    return {
      success: true,
      userVote: newUserVote,
      helpfulCount: updated.helpfulCount,
    };
  }
}
