import { escapeRegex } from '../common/utils/regex.util';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { CacheNamespace } from '../common/cache/cache-keys';
import { PrismaService } from '../prisma/prisma.service';
import { ListTeachersQueryDto } from './dto/list-teachers-query.dto';
import { PublicTeacherSummaryDto } from './dto/public-teacher-summary.dto';
import { PublicTeachersListResponseDto } from './dto/public-teachers-list-response.dto';
import { TeacherFilterOptionsResponseDto } from './dto/teacher-filter-options-response.dto';
import { PublicTeacherDetailDto } from './dto/public-teacher-detail.dto';

const TEACHERS_LIST_TTL_MS = 5 * 60 * 1000;
const TEACHER_FILTER_OPTIONS_TTL_MS = 30 * 60 * 1000;
const TEACHER_DETAIL_TTL_MS = 5 * 60 * 1000;

export const PUBLIC_TEACHER_WHERE: Prisma.TeacherWhereInput = {
  isPublicProfile: true,
  status: 'ACTIVE',
};

const TEACHER_WITH_USER_SELECT = {
  id: true,
  bio: true,
  publicBio: true,
  specialties: true,
  instruments: true,
  experience: true,
  education: true,
  achievements: true,
  website: true,
  socialMedia: true,
  highlightedWorks: true,
  teachingMethod: true,
  ageGroups: true,
  skillLevels: true,
  isVerified: true,
  averageRating: true,
  totalReviews: true,
  totalStudents: true,
  totalLessons: true,
  completionRate: true,
  createdAt: true,
  profileImage: true,
  status: true,
  maxStudentsPerWeek: true,
  defaultLessonDuration: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      city: true,
      state: true,
      image: true,
    },
  },
} as const;

type RawTeacherWithUser = Prisma.TeacherGetPayload<{
  select: typeof TEACHER_WITH_USER_SELECT;
}>;

@Injectable()
export class PublicTeachersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Diretório público de professores verificados/com perfil público. Note que
   * o `id` de cada professor na resposta é o `User.id`, não o `Teacher.id`
   * (mesma convenção do legado, usada como slug de `/teachers/:id`).
   */
  async findAll(
    query: ListTeachersQueryDto,
  ): Promise<PublicTeachersListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const skip = (page - 1) * limit;
    const where = this.buildWhereClause(query);
    const orderBy = this.buildOrderBy(query.sortBy ?? 'rating');

    const cacheKey = this.buildListCacheKey(query, page, limit);
    const cached =
      await this.cacheManager.get<PublicTeachersListResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const [teachers, totalCount, aggregateStats] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        select: TEACHER_WITH_USER_SELECT,
        orderBy,
        take: limit,
        skip,
      }),
      this.prisma.teacher.count({ where }),
      this.getAggregateStats(where),
    ]);

    const response: PublicTeachersListResponseDto = {
      teachers: teachers.map((teacher) => this.toSummaryDto(teacher)),
      stats: { totalTeachers: totalCount, ...aggregateStats },
      pagination: {
        page,
        limit,
        total: totalCount,
        hasMore: skip + teachers.length < totalCount,
      },
    };

    await this.cacheManager.set(cacheKey, response, TEACHERS_LIST_TTL_MS);
    return response;
  }

  /**
   * Contadores por instrumento/especialidade/nível/faixa etária/localização —
   * endpoint próprio (diferente do legado, que embutia isso dentro da listagem)
   * para permitir cache independente, já que filtros mudam bem menos que a
   * paginação/ordenação da listagem em si.
   */
  async getFilterOptions(): Promise<TeacherFilterOptionsResponseDto> {
    const cacheKey = `${CacheNamespace.TEACHERS}:filter-options:v1`;
    const cached =
      await this.cacheManager.get<TeacherFilterOptionsResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const teachers = await this.prisma.teacher.findMany({
      where: PUBLIC_TEACHER_WHERE,
      select: {
        instruments: true,
        specialties: true,
        skillLevels: true,
        ageGroups: true,
        user: { select: { city: true, state: true } },
      },
    });

    const instrumentCount = this.countValues(
      teachers.flatMap((teacher) => teacher.instruments),
    );
    const specialtyCount = this.countValues(
      teachers.flatMap((teacher) => teacher.specialties),
    );
    const skillLevelCount = this.countValues(
      teachers.flatMap((teacher) => teacher.skillLevels),
    );
    const ageGroupCount = this.countValues(
      teachers.flatMap((teacher) => teacher.ageGroups),
    );
    const locationCount = this.countValues(
      teachers
        .map((teacher) =>
          [teacher.user.city, teacher.user.state].filter(Boolean).join(', '),
        )
        .filter((location) => location.length > 0),
    );

    const response: TeacherFilterOptionsResponseDto = {
      instruments: instrumentCount,
      specialties: specialtyCount,
      skillLevels: skillLevelCount,
      ageGroups: ageGroupCount,
      locations: locationCount,
    };

    await this.cacheManager.set(
      cacheKey,
      response,
      TEACHER_FILTER_OPTIONS_TTL_MS,
    );
    return response;
  }

  /** `id` é o `User.id` do professor, não o `Teacher.id` — mesma convenção do legado. */
  async findOne(userId: string): Promise<PublicTeacherDetailDto> {
    const cacheKey = `${CacheNamespace.TEACHERS}:detail:${userId}`;
    const cached =
      await this.cacheManager.get<PublicTeacherDetailDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const teacher = await this.prisma.teacher.findFirst({
      where: { userId, ...PUBLIC_TEACHER_WHERE },
      select: TEACHER_WITH_USER_SELECT,
    });

    if (!teacher) {
      throw new NotFoundException('Professor não encontrado');
    }

    const summary = this.toSummaryDto(teacher);
    const response: PublicTeacherDetailDto = {
      ...summary,
      fullBio: teacher.publicBio || teacher.bio || 'Biografia não disponível.',
      teachingPhilosophy: teacher.teachingMethod,
      contactPreferences: {
        preferredMethod: teacher.user.phone ? 'whatsapp' : 'email',
        responseTime: '24 horas',
        acceptingStudents:
          teacher.status === 'ACTIVE' &&
          teacher.totalStudents < teacher.maxStudentsPerWeek,
        maxStudentsPerWeek: teacher.maxStudentsPerWeek,
        defaultLessonDuration: teacher.defaultLessonDuration,
      },
    };

    await this.cacheManager.set(cacheKey, response, TEACHER_DETAIL_TTL_MS);
    return response;
  }

  private toSummaryDto(teacher: RawTeacherWithUser): PublicTeacherSummaryDto {
    const yearsExperience = Math.floor(
      (Date.now() - teacher.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 365),
    );

    return {
      id: teacher.user.id,
      name: `${teacher.user.firstName} ${teacher.user.lastName}`.trim(),
      profileImage: teacher.profileImage ?? teacher.user.image,
      bio: teacher.bio,
      publicBio: teacher.publicBio ?? teacher.bio,
      specialties: teacher.specialties,
      instruments: teacher.instruments,
      experience: teacher.experience,
      education: teacher.education,
      achievements: teacher.achievements,
      website: teacher.website,
      socialMedia: teacher.socialMedia,
      highlightedWorks: teacher.highlightedWorks,
      teachingMethod: teacher.teachingMethod,
      ageGroups: teacher.ageGroups,
      skillLevels: teacher.skillLevels,
      email: teacher.user.email,
      phone: teacher.user.phone,
      location:
        [teacher.user.city, teacher.user.state].filter(Boolean).join(', ') ||
        null,
      isVerified: teacher.isVerified,
      averageRating: teacher.averageRating,
      totalReviews: teacher.totalReviews,
      totalStudents: teacher.totalStudents,
      totalLessons: teacher.totalLessons,
      completionRate: teacher.completionRate,
      teachingSince: teacher.createdAt,
      yearsExperience: Math.max(1, yearsExperience),
    };
  }

  /**
   * Estatísticas agregadas sobre TODO o conjunto filtrado — corrige um bug do
   * legado, que calculava `averageRating`/`verifiedTeachers`/`totalActiveStudents`
   * só a partir da página atual (até 12 professores) em vez do total.
   */
  private async getAggregateStats(where: Prisma.TeacherWhereInput) {
    const [verifiedTeachers, aggregate] = await Promise.all([
      this.prisma.teacher.count({ where: { ...where, isVerified: true } }),
      this.prisma.teacher.aggregate({
        where,
        _avg: { averageRating: true },
        _sum: { totalStudents: true },
      }),
    ]);

    return {
      verifiedTeachers,
      averageRating: aggregate._avg.averageRating ?? 0,
      totalActiveStudents: aggregate._sum.totalStudents ?? 0,
    };
  }

  private buildWhereClause(
    query: ListTeachersQueryDto,
  ): Prisma.TeacherWhereInput {
    const where: Prisma.TeacherWhereInput = { ...PUBLIC_TEACHER_WHERE };

    if (query.verified) {
      where.isVerified = true;
    }
    if (query.instrument) {
      where.instruments = { has: query.instrument };
    }
    if (query.specialty) {
      where.specialties = { has: query.specialty };
    }
    if (query.skillLevel) {
      where.skillLevels = { has: query.skillLevel };
    }
    if (query.ageGroup) {
      where.ageGroups = { has: query.ageGroup };
    }
    if (query.location) {
      where.user = {
        OR: [
          {
            city: {
              contains: escapeRegex(query.location),
              mode: 'insensitive',
            },
          },
          {
            state: {
              contains: escapeRegex(query.location),
              mode: 'insensitive',
            },
          },
        ],
      };
    }

    return where;
  }

  private buildOrderBy(
    sortBy: 'rating' | 'students' | 'experience' | 'name',
  ): Prisma.TeacherOrderByWithRelationInput[] {
    switch (sortBy) {
      case 'students':
        return [{ totalStudents: 'desc' }, { averageRating: 'desc' }];
      case 'experience':
        return [{ createdAt: 'asc' }, { averageRating: 'desc' }];
      case 'name':
        return [{ user: { firstName: 'asc' } }];
      case 'rating':
      default:
        return [
          { averageRating: 'desc' },
          { totalReviews: 'desc' },
          { isVerified: 'desc' },
        ];
    }
  }

  private buildListCacheKey(
    query: ListTeachersQueryDto,
    page: number,
    limit: number,
  ): string {
    return [
      `${CacheNamespace.TEACHERS}:list`,
      page,
      limit,
      query.sortBy ?? 'rating',
      query.instrument ?? 'all',
      query.specialty ?? 'all',
      query.skillLevel ?? 'all',
      query.ageGroup ?? 'all',
      query.location ?? 'all',
      query.verified ? 'verified' : 'all',
    ].join(':');
  }

  private countValues(values: string[]): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count);
  }
}
