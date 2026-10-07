import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlanType, Prisma, TeacherStatus } from '@prisma/client';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { PrismaService } from '../../prisma/prisma.service';
import { TeacherInvitationService } from './teacher-invitation.service';
import { toCsv } from '../../common/utils/csv.util';
import { nextCursorOf, pageArgs } from '../../common/pagination/cursor';
import {
  AdminUserAnalyticsQueryDto,
  AdminUserItemsQueryDto,
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
    const where = await this.buildWhere(query);
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

    const agora = new Date();
    const [[counts], assinatura, historico] = await Promise.all([
      this.withCounts([user]),
      // A assinatura que dá acesso hoje (a mais recente das vivas).
      this.prisma.subscription.findFirst({
        where: {
          userId,
          OR: [
            { status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
            { status: 'CANCELLED', endDate: { gt: agora } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          planType: true,
          billingPeriod: true,
          status: true,
          endDate: true,
          trialEndDate: true,
        },
      }),
      // O que o painel fez com esta conta — a trilha, filtrada pelo alvo.
      this.prisma.adminAuditLog.findMany({
        where: { entityType: 'user', entityId: userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          action: true,
          actorId: true,
          metadata: true,
          success: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      ...user,
      counts: counts.counts,
      assinatura,
      historicoNoPainel: historico,
    };
  }

  /**
   * O que a conta guardou ou fez, para abrir a partir dos números do
   * detalhe: favoritos, aprendidas, quero aprender, anotações, envios ao
   * catálogo e arquivos. Uma linha por item, no mesmo formato para todos os
   * tipos — a tela só lista.
   */
  async items(userId: string, query: AdminUserItemsQueryDto) {
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const skip = (page - 1) * limit;
    const obra = {
      select: {
        id: true,
        title: true,
        composer: { select: { name: true } },
      },
    } as const;

    const existe = await this.prisma.user.count({ where: { id: userId } });
    if (!existe) throw new NotFoundException('Usuário não encontrado');

    type Linha = {
      id: string;
      titulo: string;
      detalhe: string | null;
      em: Date | null;
      workId?: string | null;
      entityType?: string | null;
      entityId?: string | null;
    };
    let linhas: Linha[] = [];
    let total = 0;

    switch (query.kind) {
      case 'favoritos': {
        const where = { userId };
        const [rows, n] = await Promise.all([
          this.prisma.favoriteWork.findMany({
            where,
            orderBy: { id: 'desc' },
            skip,
            take: limit,
            select: { id: true, createdAt: true, work: obra },
          }),
          this.prisma.favoriteWork.count({ where }),
        ]);
        total = n;
        linhas = rows.map((r) => ({
          id: r.id,
          titulo: r.work.title,
          detalhe: r.work.composer?.name ?? null,
          em: r.createdAt ?? null,
          workId: r.work.id,
        }));
        break;
      }
      case 'aprendidas': {
        const where = { userId };
        const [rows, n] = await Promise.all([
          this.prisma.learned.findMany({
            where,
            orderBy: { learnedAt: 'desc' },
            skip,
            take: limit,
            select: {
              id: true,
              learnedAt: true,
              mastery: true,
              work: obra,
            },
          }),
          this.prisma.learned.count({ where }),
        ]);
        total = n;
        linhas = rows.map((r) => ({
          id: r.id,
          titulo: r.work.title,
          detalhe: [r.work.composer?.name, `domínio ${r.mastery}%`]
            .filter(Boolean)
            .join(' · '),
          em: r.learnedAt,
          workId: r.work.id,
        }));
        break;
      }
      case 'quero-aprender': {
        const where = { userId };
        const [rows, n] = await Promise.all([
          this.prisma.wantToLearn.findMany({
            where,
            orderBy: { addedAt: 'desc' },
            skip,
            take: limit,
            select: {
              id: true,
              addedAt: true,
              progress: true,
              work: obra,
            },
          }),
          this.prisma.wantToLearn.count({ where }),
        ]);
        total = n;
        linhas = rows.map((r) => ({
          id: r.id,
          titulo: r.work.title,
          detalhe: [
            r.work.composer?.name,
            r.progress ? `${Math.round(r.progress)}% do caminho` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          em: r.addedAt,
          workId: r.work.id,
        }));
        break;
      }
      case 'anotacoes': {
        const where = { userId };
        const [rows, n] = await Promise.all([
          this.prisma.workAnnotation.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: {
              id: true,
              title: true,
              isPublic: true,
              createdAt: true,
              work: obra,
            },
          }),
          this.prisma.workAnnotation.count({ where }),
        ]);
        total = n;
        linhas = rows.map((r) => ({
          id: r.id,
          titulo: r.title,
          detalhe: [r.work.title, r.isPublic ? 'pública' : 'privada']
            .filter(Boolean)
            .join(' · '),
          em: r.createdAt,
          workId: r.work.id,
        }));
        break;
      }
      case 'envios': {
        const where = { userId };
        const [rows, n] = await Promise.all([
          this.prisma.uploadHistory.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: {
              id: true,
              entityType: true,
              entityId: true,
              action: true,
              changes: true,
              reason: true,
              createdAt: true,
            },
          }),
          this.prisma.uploadHistory.count({ where }),
        ]);
        total = n;
        linhas = rows.map((r) => ({
          id: r.id,
          titulo: nomeNoHistorico(r.changes) ?? r.entityType,
          detalhe: [
            `${ACAO_ENVIO[r.action] ?? r.action} ${TIPO_ENVIO[r.entityType] ?? r.entityType}`,
            camposDoEnvio(r.changes),
            r.reason ? `“${r.reason.slice(0, 120)}”` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          em: r.createdAt,
          entityType: r.entityType,
          entityId: r.entityId,
        }));
        break;
      }
      case 'arquivos': {
        const where = { ownerId: userId, deletedAt: null };
        const [rows, n] = await Promise.all([
          this.prisma.storedAsset.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: {
              id: true,
              kind: true,
              format: true,
              bytes: true,
              status: true,
              createdAt: true,
              entityType: true,
              entityId: true,
            },
          }),
          this.prisma.storedAsset.count({ where }),
        ]);
        total = n;
        linhas = rows.map((r) => ({
          id: r.id,
          titulo: TIPO_ARQUIVO[r.kind] ?? r.kind,
          detalhe: [
            r.format?.toUpperCase(),
            r.bytes ? `${Math.round(r.bytes / 1024)} KB` : null,
            r.status === 'PENDING' ? 'não confirmado' : null,
          ]
            .filter(Boolean)
            .join(' · '),
          em: r.createdAt,
          entityType: r.entityType,
          entityId: r.entityId,
        }));
        break;
      }
    }

    return {
      kind: query.kind,
      items: linhas,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * O resumo da base para o topo da tela de usuários: quem chega, quem volta,
   * quem termina o cadastro, quem confirma o e-mail, quem paga, e quanto da
   * base de fato usa o site (guarda, estuda, anota, contribui).
   */
  async overview() {
    const agora = Date.now();
    const desde = (dias: number) => new Date(agora - dias * DAY_MS);

    const [
      total,
      novos30,
      novosAnteriores,
      ativos7,
      ativos30,
      nunca,
      verificados,
      onboarding,
      publicos,
      porNivel,
      porTipo,
      professores,
      admins,
      comFavorito,
      comAprendida,
      comAnotacao,
      contribuintes,
      pagantes,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: desde(30) } } }),
      this.prisma.user.count({
        where: { createdAt: { gte: desde(60), lt: desde(30) } },
      }),
      this.prisma.user.count({ where: { lastSeen: { gte: desde(7) } } }),
      this.prisma.user.count({ where: { lastSeen: { gte: desde(30) } } }),
      this.prisma.user.count({ where: { lastSeen: null } }),
      this.prisma.user.count({ where: { emailVerified: { not: null } } }),
      this.prisma.user.count({ where: { onboardingCompleted: true } }),
      this.prisma.user.count({ where: { profilePublic: true } }),
      this.prisma.user.groupBy({
        by: ['experienceLevel'],
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({ by: ['userType'], _count: { _all: true } }),
      this.prisma.user.count({ where: { isTeacher: true } }),
      this.prisma.user.count({ where: { role: 2 } }),
      this.distinctUsers('favoriteWork'),
      this.distinctUsers('learned'),
      this.distinctUsers('workAnnotation'),
      this.distinctUsers('uploadHistory'),
      this.prisma.subscription.groupBy({
        by: ['planType'],
        where: {
          planType: { not: PlanType.FREE },
          OR: [
            { status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
            { status: 'CANCELLED', endDate: { gt: new Date(agora) } },
          ],
        },
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      novos30,
      novosAnteriores,
      ativos7,
      ativos30,
      nuncaEntraram: nunca,
      emailVerificado: verificados,
      cadastroConcluido: onboarding,
      perfilPublico: publicos,
      professores,
      administradores: admins,
      usam: {
        favoritam: comFavorito,
        aprenderam: comAprendida,
        anotam: comAnotacao,
        contribuem: contribuintes,
      },
      porNivel: Object.fromEntries(
        porNivel.map((r) => [r.experienceLevel ?? 'UNSET', r._count._all]),
      ),
      porPerfil: Object.fromEntries(
        porTipo.map((r) => [r.userType ?? 'UNSET', r._count._all]),
      ),
      pagantesPorPlano: Object.fromEntries(
        pagantes.map((r) => [r.planType, r._count._all]),
      ),
    };
  }

  /** Quantas contas distintas têm ao menos um registro na coleção. */
  private async distinctUsers(
    modelo: 'favoriteWork' | 'learned' | 'workAnnotation' | 'uploadHistory',
  ): Promise<number> {
    const rows = await (
      this.prisma[modelo] as unknown as {
        groupBy: (a: object) => Promise<unknown[]>;
      }
    ).groupBy({ by: ['userId'] });
    return rows.length;
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

    const [annotations, favorites, learned, uploads, wantToLearn, contribs] =
      await Promise.all([
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
          where: { ownerId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.wantToLearn.groupBy({
          by: ['userId'],
          where: { userId: { in: ids } },
          _count: { _all: true },
        }),
        this.prisma.uploadHistory.groupBy({
          by: ['userId'],
          where: { userId: { in: ids } },
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
    const wantMap = byUser(wantToLearn);
    const contribMap = byUser(contribs);
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
        wantToLearn: wantMap.get(user.id) ?? 0,
        contributions: contribMap.get(user.id) ?? 0,
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
    const where = await this.buildWhere(query);

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

    const grant = dto.teacherPlanGrant;
    if (grant && dto.isTeacher !== true) {
      throw new BadRequestException(
        'O plano concedido acompanha o convite de professor (isTeacher: true)',
      );
    }
    const grantExpiresAt = grant?.expiresAt ? new Date(grant.expiresAt) : null;
    if (grantExpiresAt && grantExpiresAt <= new Date()) {
      throw new BadRequestException('O vencimento do plano precisa ser futuro');
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
      } else if (becomingTeacher && target.teacherProfile) {
        // Já foi professor (perfil desativado): volta a pendente, e o convite
        // sai de novo. Antes, a conta virava professor sem convite nenhum e
        // com o perfil ainda inativo.
        await tx.teacher.update({
          where: { userId: targetUserId },
          data: { status: TeacherStatus.PENDING },
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

    // Promovido agora: o convite sai por e-mail (o perfil está pendente), com
    // o plano que a equipe decidiu conceder, se houver.
    if (becomingTeacher) {
      await this.invitations.send(
        targetUserId,
        actingUserId,
        grant
          ? { planType: grant.planType, expiresAt: grantExpiresAt }
          : undefined,
      );
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

  private async buildWhere(
    query: ListAdminUsersQueryDto,
  ): Promise<Prisma.UserWhereInput> {
    const search = query.search?.trim();
    const agora = Date.now();
    const and: Prisma.UserWhereInput[] = [];

    if (query.emailVerified !== undefined) {
      and.push({
        emailVerified: query.emailVerified ? { not: null } : null,
      });
    }

    if (query.activity === '7d' || query.activity === '30d') {
      const dias = query.activity === '7d' ? 7 : 30;
      and.push({ lastSeen: { gte: new Date(agora - dias * DAY_MS) } });
    } else if (query.activity === 'inactive90') {
      and.push({ lastSeen: { lt: new Date(agora - 90 * DAY_MS) } });
    } else if (query.activity === 'never') {
      and.push({ lastSeen: null });
    }

    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }

    // O plano vem da assinatura viva, não do `currentPlan` do usuário: esse
    // campo é um cache que o legado nem sempre atualizava.
    if (query.plan) {
      const vivas = await this.prisma.subscription.findMany({
        where: {
          planType: { not: PlanType.FREE },
          OR: [
            { status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
            { status: 'CANCELLED', endDate: { gt: new Date(agora) } },
          ],
          ...(query.plan !== PlanType.FREE ? { planType: query.plan } : {}),
        },
        select: { userId: true },
        distinct: ['userId'],
      });
      const ids = vivas.map((v) => v.userId);
      and.push(
        query.plan === PlanType.FREE
          ? { id: { notIn: ids } }
          : { id: { in: ids } },
      );
    }

    if (search) {
      const contem = {
        contains: escapeRegex(search),
        mode: 'insensitive' as const,
      };
      and.push({
        OR: [
          { email: contem },
          { firstName: contem },
          { lastName: contem },
          { username: contem },
        ],
      });
    }

    return {
      ...(query.userType ? { userType: query.userType } : {}),
      ...(query.experienceLevel
        ? { experienceLevel: query.experienceLevel }
        : {}),
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.isTeacher !== undefined ? { isTeacher: query.isTeacher } : {}),
      ...(query.onboardingCompleted !== undefined
        ? { onboardingCompleted: query.onboardingCompleted }
        : {}),
      ...(query.profilePublic !== undefined
        ? { profilePublic: query.profilePublic }
        : {}),
      ...(and.length ? { AND: and } : {}),
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
  /** Arquivos enviados (foto, partitura, áudio) ainda guardados. */
  uploads: number;
  wantToLearn: number;
  /** Envios ao catálogo: cadastros, edições e remoções (`upload_history`). */
  contributions: number;
}

const EMPTY_COUNTS: UserCounts = {
  annotations: 0,
  favorites: 0,
  learned: 0,
  uploads: 0,
  wantToLearn: 0,
  contributions: 0,
};

const ACAO_ENVIO: Record<string, string> = {
  create: 'cadastrou',
  update: 'editou',
  delete: 'apagou',
};

const TIPO_ENVIO: Record<string, string> = {
  composer: 'compositor',
  work: 'obra',
  score: 'partitura',
  workScore: 'partitura',
  user: 'perfil',
};

const TIPO_ARQUIVO: Record<string, string> = {
  PROFILE_IMAGE: 'Foto de perfil',
  COMPOSER_IMAGE: 'Retrato de compositor',
  SCORE_FILE: 'Partitura',
  SCORE_THUMBNAIL: 'Capa de partitura',
  WORK_AUDIO: 'Áudio de obra',
  WORK_VIDEO_LESSON: 'Videoaula',
  PERFORMANCE_VIDEO: 'Vídeo de execução',
  ASSIGNMENT_VIDEO: 'Vídeo de tarefa',
  BLOG_MEDIA: 'Mídia do blog',
  BLOG_AUDIO: 'Áudio do blog',
  BLOG_TTS_AUDIO: 'Narração do blog',
  AD_MEDIA: 'Mídia de anúncio',
};

/** O nome do registro gravado no histórico de envio, quando há. */
function nomeNoHistorico(changes: Prisma.JsonValue | null): string | null {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return null;
  }
  const c = changes as Record<string, unknown>;
  const fonte =
    (c.after as Record<string, unknown> | undefined) ??
    (c.before as Record<string, unknown> | undefined) ??
    c;
  const nome = fonte?.title ?? fonte?.name ?? fonte?.fullName;
  return typeof nome === 'string' && nome ? nome : null;
}

/** "3 campos: título, ano, catálogo" a partir do `changes` do envio. */
function camposDoEnvio(changes: Prisma.JsonValue | null): string | null {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return null;
  }
  const c = changes as Record<string, unknown>;
  const fonte =
    c.after && typeof c.after === 'object'
      ? (c.after as Record<string, unknown>)
      : c;
  const nomes = Object.keys(fonte).filter(
    (k) => !['id', 'createdAt', 'updatedAt'].includes(k),
  );
  if (!nomes.length) return null;
  const lista = nomes.slice(0, 4).join(', ');
  return `${nomes.length} ${nomes.length === 1 ? 'campo' : 'campos'}: ${lista}${nomes.length > 4 ? '…' : ''}`;
}
