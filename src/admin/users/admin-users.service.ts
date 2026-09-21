import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TeacherStatus } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { TeacherInvitationService } from './teacher-invitation.service';
import { toCsv } from '../../common/utils/csv.util';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import {
  AdminUserAnalyticsQueryDto,
  ExportAdminUsersQueryDto,
  ListAdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

const MAX_EXPORT_ROWS = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

/**
 * Projeção do usuário para o admin.
 *
 * Declarada como `select`, nunca `include`. O legado usava `include` na rota de
 * detalhe, o que traz **todos** os campos escalares de `User` — `hashedPassword`
 * incluído — para a memória do processo. A resposta era montada campo a campo,
 * então o hash não chegava ao cliente, mas carregá-lo sem necessidade é o tipo
 * de descuido que vira vazamento no dia em que alguém trocar a montagem por um
 * `...user`.
 */
const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  username: true,
  image: true,
  bio: true,
  role: true,
  userType: true,
  experienceLevel: true,
  isTeacher: true,
  isStudent: true,
  profilePublic: true,
  onboardingCompleted: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
  lastSeen: true,
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
    private readonly invitations: TeacherInvitationService,
  ) {}

  // -------------------------------------------------------------------
  // Listagem
  // -------------------------------------------------------------------

  /**
   * A lista aceita as duas paginações: `page` (a tela antiga, que mostra o
   * total e os números das páginas) e `cursor` (a rolagem infinita). Com
   * cursor não há `count`: contar a base inteira a cada rolagem é justamente
   * o custo que a rolagem quer evitar, e o total já veio na primeira página.
   */
  async list(query: ListAdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = this.buildWhere(query);
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const paging = pageArgs({ cursor: query.cursor, page, limit });

    const users = await this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      // O id desempata: sem ele, dois cadastros do mesmo instante trocam de
      // lugar entre uma busca e outra, e o cursor pula ou repete um deles.
      orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
      take: paging.take,
      skip: paging.skip,
      cursor: paging.cursor,
    });

    const total = query.cursor ? null : await this.prisma.user.count({ where });

    return {
      users: await this.withCounts(users),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === null ? null : Math.ceil(total / limit),
        nextCursor: nextCursorOf(users, limit),
      },
    };
  }

  async findOne(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...USER_SELECT,
        teacherProfile: {
          select: {
            id: true,
            status: true,
            isVerified: true,
            totalStudents: true,
            totalLessons: true,
          },
        },
        studentProfile: {
          select: {
            id: true,
            level: true,
            status: true,
            totalLessonsAttended: true,
            currentStreak: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const [counts] = await this.withCounts([user]);

    return { ...user, counts: counts.counts };
  }

  /**
   * Contagens por usuário, resolvidas em lote.
   *
   * Uma consulta agregada por tipo de contagem, em vez de uma por usuário —
   * mesma correção aplicada quatro vezes no Portal.
   */
  private async withCounts<T extends { id: string }>(
    users: T[],
  ): Promise<Array<T & { counts: UserCounts }>> {
    const ids = users.map((user) => user.id);

    if (ids.length === 0) {
      return users.map((user) => ({ ...user, counts: { ...EMPTY_COUNTS } }));
    }

    const [annotations, favorites, learned, uploads] = await Promise.all([
      this.prisma.workAnnotation.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.favoriteWork.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.learned.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.storedAsset.groupBy({
        by: ['ownerId'],
        where: { ownerId: { in: ids } },
        _count: { _all: true },
      }),
    ]);

    const byUser = (
      rows: Array<{ userId: string; _count: { _all: number } }>,
    ): Map<string, number> =>
      new Map(rows.map((row) => [row.userId, row._count._all]));

    const annotationsMap = byUser(annotations);
    const favoritesMap = byUser(favorites);
    const learnedMap = byUser(learned);
    const uploadsMap = new Map(
      uploads
        .filter((row): row is typeof row & { ownerId: string } =>
          Boolean(row.ownerId),
        )
        .map((row) => [row.ownerId, row._count._all]),
    );

    return users.map((user) => ({
      ...user,
      counts: {
        annotations: annotationsMap.get(user.id) ?? 0,
        favorites: favoritesMap.get(user.id) ?? 0,
        learned: learnedMap.get(user.id) ?? 0,
        uploads: uploadsMap.get(user.id) ?? 0,
      },
    }));
  }

  // -------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------

  /**
   * Números da base de usuários no período.
   *
   * Sem cache de processo: o legado usava `unstable_cache` do Next, que é por
   * instância e não sobrevive à escala horizontal. Aqui são contagens indexadas
   * e paralelas; se virar gargalo, o cache entra no Redis compartilhado.
   */
  async analytics(query: AdminUserAnalyticsQueryDto) {
    const period = query.period ?? '30d';
    const since = new Date(Date.now() - PERIOD_DAYS[period] * DAY_MS);
    const previousSince = new Date(
      since.getTime() - PERIOD_DAYS[period] * DAY_MS,
    );

    const [total, novos, anteriores, ativos, porTipo, porPapel, professores] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: since } } }),
        this.prisma.user.count({
          where: { createdAt: { gte: previousSince, lt: since } },
        }),
        this.prisma.user.count({ where: { lastSeen: { gte: since } } }),
        this.prisma.user.groupBy({
          by: ['userType'],
          _count: { _all: true },
        }),
        this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
        this.prisma.user.count({ where: { isTeacher: true } }),
      ]);

    return {
      period,
      total,
      newInPeriod: novos,
      // `null` em vez de 100% quando não havia base anterior: crescimento
      // infinito a partir de zero não é informação.
      growthRate:
        anteriores > 0
          ? Math.round(((novos - anteriores) / anteriores) * 1000) / 10
          : null,
      activeInPeriod: ativos,
      teachers: professores,
      byUserType: Object.fromEntries(
        porTipo.map((row) => [row.userType ?? 'UNSET', row._count._all]),
      ),
      byRole: Object.fromEntries(
        porPapel.map((row) => [String(row.role), row._count._all]),
      ),
    };
  }

  // -------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------

  /**
   * Exporta a base de usuários.
   *
   * O CSV do legado escapava aspas mas **não neutralizava prefixo de fórmula**.
   * Nome e e-mail são escritos pelo usuário: um cadastro chamado
   * `=HYPERLINK(...)` executava ao abrir a planilha — e quem abre a exportação
   * de usuários é o administrador, ou seja, a conta de maior privilégio.
   */
  async export(query: ExportAdminUsersQueryDto) {
    const where = this.buildWhere(query);

    const users = await this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
      take: MAX_EXPORT_ROWS,
    });

    const rows = await this.withCounts(users);

    if (query.format === 'json') {
      return {
        users: rows,
        count: rows.length,
        truncated: rows.length >= MAX_EXPORT_ROWS,
        exportedAt: new Date(),
      };
    }

    const csv = toCsv(
      [
        'ID',
        'Nome',
        'E-mail',
        'Usuário',
        'Tipo',
        'Nível',
        'Papel',
        'Professor',
        'Aluno',
        'Anotações',
        'Favoritos',
        'Aprendidas',
        'Envios',
        'Cadastro',
        'Última atividade',
      ],
      rows.map((user) => [
        user.id,
        this.fullName(user),
        user.email,
        user.username,
        user.userType,
        user.experienceLevel,
        user.role,
        user.isTeacher ? 'Sim' : 'Não',
        user.isStudent ? 'Sim' : 'Não',
        user.counts.annotations,
        user.counts.favorites,
        user.counts.learned,
        user.counts.uploads,
        user.createdAt,
        user.lastSeen,
      ]),
    );

    return { csv, count: rows.length };
  }

  // -------------------------------------------------------------------
  // Alteração
  // -------------------------------------------------------------------

  /**
   * Altera papel e marcas de um usuário.
   *
   * Quatro proteções que o legado não tinha:
   *
   * 1. **O valor de `role` é validado** (0, 1 ou 2). Como o guard compara
   *    `role < nívelExigido`, gravar `999` daria acesso a tudo e `-1` trancaria
   *    a conta fora de qualquer rota.
   * 2. **Ninguém rebaixa a si mesmo.** É a forma mais fácil de perder o acesso
   *    administrativo por engano, e não há caminho de volta pela própria API.
   * 3. **O último super admin não pode ser rebaixado.** Sem isso, a instalação
   *    fica sem ninguém capaz de administrar.
   * 4. **Perfil de professor e usuário mudam na mesma transação.** No legado o
   *    `teacher.create` acontecia antes do `user.update`: falhando o segundo,
   *    ficava um perfil de professor pendurado numa conta que não é professor.
   */
  async update(
    actingUserId: string,
    targetUserId: string,
    dto: UpdateAdminUserDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        role: true,
        isTeacher: true,
        teacherProfile: { select: { id: true } },
      },
    });

    if (!target) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (dto.role !== undefined && dto.role !== target.role) {
      await this.assertRoleChangeAllowed(actingUserId, target, dto.role);
    }

    // Ser professor é `isTeacher`, nunca o papel. O legado usava `role: 1`
    // para "fazer professor" — e 1 é o nível de administrador em toda checagem
    // de permissão (`@Roles('ADMIN')` aceita `role >= 1`). Acoplados, promover
    // alguém a admin o transformava em professor (com convite por e-mail), e
    // rebaixar um admin desativava o perfil de professor dele.
    const becomingTeacher = dto.isTeacher === true && !target.isTeacher;
    const leavingTeacher = dto.isTeacher === false && target.isTeacher;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          role: dto.role,
          userType: dto.userType,
          isStudent: dto.isStudent,
          isTeacher: becomingTeacher
            ? true
            : leavingTeacher
              ? false
              : dto.isTeacher,
        },
      });

      if (becomingTeacher && !target.teacherProfile) {
        // Nasce pendente e não verificado: promover a professor não é o mesmo
        // que aprovar o professor.
        await tx.teacher.create({
          data: {
            userId: targetUserId,
            status: TeacherStatus.PENDING,
            isVerified: false,
          },
        });
      }

      if (leavingTeacher && target.teacherProfile) {
        // Desativa em vez de apagar: as aulas e o histórico dos alunos
        // dependem do perfil existir.
        await tx.teacher.update({
          where: { userId: targetUserId },
          data: { status: TeacherStatus.INACTIVE, isVerified: false },
        });
      }
    });

    // Virar ou deixar de ser professor muda o diretório público.
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);

    // Promovido agora: o convite sai por e-mail (o perfil nasceu pendente).
    if (becomingTeacher && !target.teacherProfile) {
      await this.invitations.send(targetUserId, actingUserId);
    }

    return this.findOne(targetUserId);
  }

  private async assertRoleChangeAllowed(
    actingUserId: string,
    target: { id: string; role: number },
    nextRole: number,
  ): Promise<void> {
    if (target.id === actingUserId && nextRole < target.role) {
      throw new ConflictException(
        'Você não pode rebaixar o próprio papel. Peça a outro super admin.',
      );
    }

    if (target.role === 2 && nextRole < 2) {
      const superAdmins = await this.prisma.user.count({
        where: { role: 2 },
      });

      if (superAdmins <= 1) {
        throw new ConflictException(
          'Este é o último super admin; rebaixá-lo deixaria a instalação sem administração.',
        );
      }
    }
  }

  // -------------------------------------------------------------------

  private buildWhere(query: ListAdminUsersQueryDto): Prisma.UserWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.userType ? { userType: query.userType } : {}),
      ...(query.experienceLevel
        ? { experienceLevel: query.experienceLevel }
        : {}),
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.isTeacher !== undefined ? { isTeacher: query.isTeacher } : {}),
      ...(search
        ? {
            OR: [
              {
                email: {
                  contains: escapeRegex(search),
                  mode: 'insensitive' as const,
                },
              },
              {
                firstName: {
                  contains: escapeRegex(search),
                  mode: 'insensitive' as const,
                },
              },
              {
                lastName: {
                  contains: escapeRegex(search),
                  mode: 'insensitive' as const,
                },
              },
              {
                username: {
                  contains: escapeRegex(search),
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
  }

  private fullName(user: Pick<UserRow, 'firstName' | 'lastName'>): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }
}

export interface UserCounts {
  annotations: number;
  favorites: number;
  learned: number;
  uploads: number;
}

const EMPTY_COUNTS: UserCounts = {
  annotations: 0,
  favorites: 0,
  learned: 0,
  uploads: 0,
};
