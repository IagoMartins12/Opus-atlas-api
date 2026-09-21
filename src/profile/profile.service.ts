import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  StorageAssetKind,
  StudentInviteStatus,
  TokenType,
} from '@prisma/client';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { UserTokenService } from '../auth/user-token.service';
import { AppCacheService } from '../common/cache/cache.service';
import { CacheNamespace } from '../common/cache/cache-keys';
import {
  StorageService,
  UploadedFile,
} from '../common/storage/storage.service';
import { MailService } from '../mail/mail.service';
import {
  PortalProfileService,
  ProfileRoles,
  StudentSection,
  TeacherSection,
} from '../portal/profile/profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import {
  AccountCascadeInfoDto,
  DeleteAccountResponseDto,
  HeartbeatResponseDto,
  ProfileStatsDto,
} from './dto/profile-response.dto';
import { OPTIONAL_PROFILE_SECTIONS } from './dto/profile-query.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import {
  OnboardingDto,
  UpdateAccountDto,
  UpdateProfileDto,
} from './dto/update-profile.dto';
import {
  UserInstrumentDto,
  UserInstrumentInputDto,
} from './dto/user-instrument.dto';
import { parsePhoneNumber } from './utils/phone-parser.util';

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

/** Campos de texto opcionais da conta: vazio vira `null`. */
const TEXT_FIELDS = [
  'firstName',
  'lastName',
  'bio',
  'city',
  'state',
  'country',
] as const;

/**
 * A conta, como `GET /profile` a devolve: os campos que a sessão do NextAuth
 * carregava, mais forma de login e plano. `hashedPassword`, `accounts` e
 * `teacherProfile` entram só para calcular `login` e `teacherVerified`, e
 * saem da resposta.
 */
const ACCOUNT_SELECT = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  image: true,
  bio: true,
  role: true,
  isTeacher: true,
  isStudent: true,
  userType: true,
  onboardingCompleted: true,
  emailVerified: true,
  createdAt: true,
  lastSeen: true,
  city: true,
  state: true,
  country: true,
  phone: true,
  phoneCountryCode: true,
  phoneNumber: true,
  favoriteComposerId: true,
  favoriteEpochId: true,
  experienceLevel: true,
  practiceTimePerWeek: true,
  profilePublic: true,
  showLocation: true,
  currentPlan: true,
  planExpiresAt: true,
  isTrialActive: true,
  totalXP: true,
  hashedPassword: true,
  accounts: { select: { provider: true } },
  teacherProfile: { select: { isVerified: true } },
} as const;

type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

type AccountRoles = ProfileRoles & { onboardingCompleted: boolean };

interface RequestContext {
  ipAddress: string;
  userAgent: string;
}

function toAccount(
  user: AccountRow,
  studentInviteStatus: StudentInviteStatus | null,
) {
  const { hashedPassword, accounts, teacherProfile, ...fields } = user;

  return {
    ...fields,
    name: [fields.firstName, fields.lastName].filter(Boolean).join(' '),
    teacherVerified: fields.isTeacher
      ? (teacherProfile?.isVerified ?? false)
      : null,
    studentInviteStatus,
    login: {
      hasPassword: Boolean(hashedPassword),
      providers: [...new Set(accounts.map((account) => account.provider))],
    },
  };
}

export type ProfileAccount = ReturnType<typeof toAccount>;

export interface ProfileView {
  account: ProfileAccount;
  instruments?: UserInstrumentDto[];
  stats?: ProfileStatsDto;
  teacher?: TeacherSection | null;
  student?: StudentSection | null;
}

/**
 * Perfil do usuário logado.
 *
 * **Uma leitura e uma escrita para tudo o que é dele.** Antes eram três rotas
 * de leitura (`login-method`, `instruments`, `stats`) e sete de escrita
 * (`location`, `phone`, `musical-preferences`, `privacy`, `user-type`,
 * `PUT instruments` e o `PATCH` do portal, que nunca respondia porque este
 * controller registrava a mesma rota antes). Agora `GET /profile` escolhe as
 * partes por `include` e `PATCH /profile` aceita blocos opcionais. Ficam à
 * parte só as operações com regra própria: senha, troca de e-mail, foto,
 * exportação, exclusão e presença.
 */
@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly userTokenService: UserTokenService,
    private readonly configService: ConfigService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
    private readonly portal: PortalProfileService,
  ) {}

  /** O diretório público de professores mostra estes dados, e tem cache. */
  private async refreshTeacherDirectory(): Promise<void> {
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);
  }

  // -------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------

  /**
   * O perfil, com as partes pedidas.
   *
   * `account` vem sempre — é o "quem sou eu" que o front consulta a cada
   * navegação, e custa uma consulta (duas para aluno). As seções de professor
   * e de aluno só existem para quem tem o papel, e são criadas na primeira
   * leitura, como o portal fazia.
   */
  async get(userId: string, include?: string): Promise<ProfileView> {
    const sections = sectionsOf(include);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ACCOUNT_SELECT,
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const [studentInviteStatus, instruments, stats, teacher, student] =
      await Promise.all([
        user.isStudent ? this.inviteStatusOf(userId) : null,
        sections.has('instruments') ? this.userInstruments(userId) : undefined,
        sections.has('stats') ? this.stats(userId) : undefined,
        sections.has('teacher')
          ? user.isTeacher
            ? this.portal.teacherSection(userId)
            : null
          : undefined,
        sections.has('student')
          ? user.isStudent
            ? this.portal.studentSection(userId)
            : null
          : undefined,
      ]);

    const view: ProfileView = {
      account: toAccount(user, studentInviteStatus),
    };

    if (instruments !== undefined) view.instruments = instruments;
    if (stats !== undefined) view.stats = stats;
    if (teacher !== undefined) view.teacher = teacher;
    if (student !== undefined) view.student = student;

    return view;
  }

  /**
   * Situação do convite do aluno, como a sessão do legado mostrava.
   *
   * Vale o aceito, se houver algum vínculo ativo aceito; senão, o do vínculo
   * mais recente. O legado ordenava o enum em ordem decrescente contando que
   * "ACCEPTED vem antes" — mas a ordem é alfabética, e PENDING vinha antes: o
   * aluno aceito por um professor e convidado por outro aparecia pendente.
   */
  private async inviteStatusOf(
    userId: string,
  ): Promise<StudentInviteStatus | null> {
    const relationships = await this.prisma.teacherStudent.findMany({
      where: { student: { userId }, isActive: true },
      select: { inviteStatus: true },
      orderBy: { startDate: 'desc' },
      take: 20,
    });

    if (
      relationships.some(
        (rel) => rel.inviteStatus === StudentInviteStatus.ACCEPTED,
      )
    ) {
      return StudentInviteStatus.ACCEPTED;
    }

    return relationships[0]?.inviteStatus ?? null;
  }

  private async userInstruments(userId: string): Promise<UserInstrumentDto[]> {
    const userInstruments = await this.prisma.userInstrument.findMany({
      where: { userId },
      include: {
        instrument: { select: { id: true, name: true, category: true } },
      },
      orderBy: [{ isPrimary: 'desc' }, { instrument: { name: 'asc' } }],
    });

    return userInstruments.map((ui) => ({
      id: ui.id,
      instrumentId: ui.instrumentId,
      name: ui.instrument.name,
      category: ui.instrument.category,
      level: ui.level,
      isPrimary: ui.isPrimary,
      isLearning: ui.isLearning,
      startedAt: ui.startedAt,
    }));
  }

  private async stats(userId: string): Promise<ProfileStatsDto> {
    const [
      instrumentsCount,
      favoriteWorksCount,
      favoriteComposersCount,
      learnedWorksCount,
    ] = await Promise.all([
      this.prisma.userInstrument.count({ where: { userId } }),
      this.prisma.favoriteWork.count({ where: { userId } }),
      this.prisma.favoriteComposer.count({ where: { userId } }),
      this.prisma.learned.count({ where: { userId } }),
    ]);

    return {
      instrumentsCount,
      favoriteWorksCount,
      favoriteComposersCount,
      learnedWorksCount,
    };
  }

  // -------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------

  /**
   * Atualiza o que veio, numa transação, e devolve o perfil com os blocos
   * alterados.
   *
   * Bloco de professor ou de aluno em conta sem o papel é 403 — não cria
   * perfil para quem não o tem. Os papéis são lidos do banco, não do token:
   * o token vive 15 minutos e o admin pode ter mudado o papel nesse meio.
   */
  async update(userId: string, dto: UpdateProfileDto): Promise<ProfileView> {
    if (!dto.account && !dto.instruments && !dto.teacher && !dto.student) {
      throw new BadRequestException('Nada para atualizar');
    }

    const roles = await this.rolesOf(userId);

    if (dto.teacher && !roles.isTeacher) {
      throw new ForbiddenException('Sua conta não tem perfil de professor');
    }

    if (dto.student && !roles.isStudent) {
      throw new ForbiddenException('Sua conta não tem perfil de aluno');
    }

    await this.write(userId, dto, roles);

    return this.get(userId, touchedSections(dto));
  }

  /**
   * Primeiro preenchimento.
   *
   * O que impede a repetição é `onboardingCompleted`, não a existência do
   * perfil: no legado o `GET` do portal criava o perfil sozinho, e o
   * onboarding, que recusava perfil existente, ficava impossível depois da
   * primeira visita. Bloco de papel que a conta não tem é ignorado.
   */
  async completeOnboarding(
    userId: string,
    dto: OnboardingDto,
  ): Promise<ProfileView> {
    const roles = await this.rolesOf(userId);

    if (roles.onboardingCompleted) {
      throw new ConflictException(
        'O cadastro inicial já foi concluído. Use a atualização de perfil.',
      );
    }

    // O perfil do papel nasce no cadastro inicial mesmo sem bloco — é o que o
    // portal espera encontrar na primeira visita.
    if (roles.isTeacher) await this.portal.ensureTeacher(userId);
    if (roles.isStudent) await this.portal.ensureStudent(userId);

    await this.write(
      userId,
      {
        ...dto,
        teacher: roles.isTeacher ? dto.teacher : undefined,
        student: roles.isStudent ? dto.student : undefined,
      },
      roles,
      { onboardingCompleted: true },
    );

    return this.get(userId);
  }

  private async write(
    userId: string,
    dto: UpdateProfileDto,
    roles: AccountRoles,
    extra: Prisma.UserUncheckedUpdateInput = {},
  ): Promise<void> {
    if (dto.instruments) {
      assertSinglePrimary(dto.instruments);
    }

    // `update` precisa do registro: quem ainda não abriu o portal não tem.
    if (dto.teacher) await this.portal.ensureTeacher(userId);
    if (dto.student) await this.portal.ensureStudent(userId);

    const account = { ...this.accountData(dto.account), ...extra };
    const instruments = dto.instruments;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (Object.keys(account).length > 0) {
        await tx.user.update({ where: { id: userId }, data: account });
      }

      if (instruments) {
        await tx.userInstrument.deleteMany({ where: { userId } });

        if (instruments.length > 0) {
          await tx.userInstrument.createMany({
            data: instruments.map((instrument) => ({
              userId,
              instrumentId: instrument.instrumentId,
              level: instrument.level,
              isPrimary: instrument.isPrimary,
              isLearning: instrument.isLearning,
            })),
          });
        }
      }

      if (dto.student) {
        await tx.student.update({
          where: { userId },
          data: {
            ...this.portal.studentData(dto.student),
            lastActiveAt: new Date(),
          },
        });
      }

      if (dto.teacher) {
        await tx.teacher.update({
          where: { userId },
          data: this.portal.teacherData(dto.teacher),
        });
      }
    });

    await this.portal.recordProfileChange(
      userId,
      { isTeacher: roles.isTeacher, isStudent: roles.isStudent },
      changedFields(dto),
    );
    await this.refreshTeacherDirectory();
  }

  private async rolesOf(userId: string): Promise<AccountRoles> {
    const roles = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isTeacher: true, isStudent: true, onboardingCompleted: true },
    });

    if (!roles) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return roles;
  }

  private accountData(dto?: UpdateAccountDto): Prisma.UserUncheckedUpdateInput {
    if (!dto) {
      return {};
    }

    const data: Prisma.UserUncheckedUpdateInput = {};

    for (const field of TEXT_FIELDS) {
      const value = dto[field];

      if (value !== undefined) {
        data[field] = blankToNull(value);
      }
    }

    if (dto.phone !== undefined) Object.assign(data, phoneData(dto.phone));
    if (dto.userType !== undefined) data.userType = dto.userType;
    if (dto.experienceLevel !== undefined) {
      data.experienceLevel = dto.experienceLevel;
    }
    if (dto.favoriteComposerId !== undefined) {
      data.favoriteComposerId = dto.favoriteComposerId;
    }
    if (dto.favoriteEpochId !== undefined) {
      data.favoriteEpochId = dto.favoriteEpochId;
    }
    if (dto.practiceTimePerWeek !== undefined) {
      data.practiceTimePerWeek = dto.practiceTimePerWeek;
    }
    if (dto.profilePublic !== undefined) data.profilePublic = dto.profilePublic;
    if (dto.showLocation !== undefined) data.showLocation = dto.showLocation;

    return data;
  }

  // -------------------------------------------------------------------
  // Operações com regra própria
  // -------------------------------------------------------------------

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, hashedPassword: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Conta de login social sem senha própria: esta chamada define a primeira senha.
    if (!user.hashedPassword) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { hashedPassword: await argon2.hash(dto.newPassword) },
      });
      return;
    }

    const isCurrentValid = await this.verifyPassword(
      user.hashedPassword,
      dto.currentPassword,
    );

    if (!isCurrentValid) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    const isSamePassword = await this.verifyPassword(
      user.hashedPassword,
      dto.newPassword,
    );

    if (isSamePassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedPassword: await argon2.hash(dto.newPassword) },
    });

    // Trocar a senha invalida todas as sessões, igual ao `resetPassword` do AuthModule.
    await this.userTokenService.revokeAllUserTokens(
      userId,
      TokenType.REFRESH_TOKEN,
    );
  }

  async requestEmailChange(
    userId: string,
    dto: RequestEmailChangeDto,
    context: RequestContext,
  ): Promise<void> {
    const normalizedEmail = dto.newEmail.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, hashedPassword: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (!user.hashedPassword) {
      throw new BadRequestException(
        'Para alterar o e-mail, defina uma senha para sua conta primeiro',
      );
    }

    const isValidPassword = await this.verifyPassword(
      user.hashedPassword,
      dto.currentPassword,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    if (normalizedEmail === user.email?.toLowerCase()) {
      throw new BadRequestException('Este já é o seu e-mail atual');
    }

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (emailTaken) {
      throw new ConflictException('Este e-mail já está em uso por outra conta');
    }

    const rateLimit = await this.userTokenService.checkRateLimit(
      { userId },
      TokenType.EMAIL_CHANGE,
      3,
    );

    if (!rateLimit.allowed) {
      throw new BadRequestException(
        'Muitas tentativas. Aguarde 1 hora para solicitar novamente.',
      );
    }

    const token = await this.userTokenService.createToken({
      userId,
      type: TokenType.EMAIL_CHANGE,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        newEmail: normalizedEmail,
        oldEmail: user.email,
        requestTime: new Date().toISOString(),
      },
    });

    const confirmationUrl = `${this.getFrontendBaseUrl()}/confirm-email-change/${token}`;

    await this.mailService.sendEmailChangeRequestEmail(normalizedEmail, {
      firstName: user.firstName ?? 'Usuário',
      confirmationUrl,
    });
  }

  async getCascadeInfo(userId: string): Promise<AccountCascadeInfoDto> {
    const [
      composersCount,
      worksCount,
      scoresCount,
      annotationsCount,
      favoritesCount,
      instrumentsCount,
      favoriteComposersCount,
      learnedWorksCount,
      wantToLearnCount,
      sampleComposers,
      sampleWorks,
      sampleAnnotations,
    ] = await Promise.all([
      this.prisma.composer.count({ where: { createdBy: userId } }),
      this.prisma.work.count({ where: { createdBy: userId } }),
      this.prisma.workScore.count({ where: { uploadedBy: userId } }),
      this.prisma.workAnnotation.count({ where: { userId } }),
      this.prisma.favoriteWork.count({ where: { userId } }),
      this.prisma.userInstrument.count({ where: { userId } }),
      this.prisma.favoriteComposer.count({ where: { userId } }),
      this.prisma.learned.count({ where: { userId } }),
      this.prisma.wantToLearn.count({ where: { userId } }),
      this.prisma.composer.findMany({
        where: { createdBy: userId },
        select: { id: true, name: true, epochName: true },
        take: 3,
      }),
      this.prisma.work.findMany({
        where: { createdBy: userId },
        select: { id: true, title: true, composer: { select: { name: true } } },
        take: 3,
      }),
      this.prisma.workAnnotation.findMany({
        where: { userId },
        select: { id: true, title: true, work: { select: { title: true } } },
        take: 3,
      }),
    ]);

    const totalItems =
      composersCount +
      worksCount +
      scoresCount +
      annotationsCount +
      favoritesCount +
      instrumentsCount +
      favoriteComposersCount +
      learnedWorksCount +
      wantToLearnCount;

    return {
      totalItems,
      composersCount,
      worksCount,
      scoresCount,
      annotationsCount,
      favoritesCount,
      instrumentsCount,
      favoriteComposersCount,
      learnedWorksCount,
      wantToLearnCount,
      sampleComposers,
      sampleWorks,
      sampleAnnotations,
    };
  }

  /**
   * Diferente do legado (que excluía a conta sem nenhuma confirmação): exige a senha atual
   * quando a conta tem uma, hardening consistente com `resetPassword`/`changePassword`.
   */
  async deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): Promise<DeleteAccountResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        hashedPassword: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.hashedPassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          'Confirme sua senha atual para excluir a conta',
        );
      }

      const isValidPassword = await this.verifyPassword(
        user.hashedPassword,
        dto.currentPassword,
      );

      if (!isValidPassword) {
        throw new UnauthorizedException('Senha atual incorreta');
      }
    }

    if (user.email) {
      await this.mailService
        .sendAccountDeletedFarewellEmail(user.email, {
          firstName: user.firstName ?? 'Usuário',
        })
        .catch((error) =>
          this.logger.warn(
            `Falha ao enviar e-mail de despedida para ${user.email}: ${(error as Error).message}`,
          ),
        );
    }

    await this.prisma.user.delete({ where: { id: userId } });

    return {
      deletedAt: new Date().toISOString(),
      email: user.email,
      name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    };
  }

  async heartbeat(
    userId: string,
    dto: HeartbeatDto,
  ): Promise<HeartbeatResponseDto> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeen: dto.timestamp ? new Date(dto.timestamp) : new Date() },
    });

    return { success: true, timestamp: new Date().toISOString() };
  }

  /**
   * Troca a foto de perfil.
   *
   * O arquivo vai para o Cloudinary — a versão anterior gravava em
   * `public/uploads`, que não sobrevive a um contêiner efêmero nem é visível
   * para as outras réplicas. O arquivo antigo é removido pela política do tipo
   * (`replacesPrevious`), então não sobra imagem órfã a cada troca.
   */
  async updateAvatar(
    userId: string,
    file: UploadedFile,
  ): Promise<{ imageUrl: string }> {
    const asset = await this.storage.uploadFile(
      {
        kind: StorageAssetKind.PROFILE_IMAGE,
        scopeId: userId,
        entityType: 'user',
        entityId: userId,
        ownerId: userId,
      },
      file,
    );

    if (!asset.secureUrl) {
      throw new InternalServerErrorException(
        'O armazenamento não devolveu a URL da imagem',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { image: asset.secureUrl },
    });
    await this.refreshTeacherDirectory();

    return { imageUrl: asset.secureUrl };
  }

  /**
   * Remove a foto de perfil.
   *
   * Apaga do armazenamento só o que é foto de perfil da conta — outros
   * arquivos ligados a ela ficam — e limpa o campo. Foto que veio do Google é
   * endereço externo, sem arquivo guardado: só o campo é limpo.
   */
  async removeAvatar(userId: string): Promise<void> {
    const assets = await this.storage.findActiveByEntity('user', userId);

    for (const asset of assets) {
      if (asset.kind === StorageAssetKind.PROFILE_IMAGE) {
        await this.storage.deleteAsset(asset.id);
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { image: null },
    });
    await this.refreshTeacherDirectory();
  }

  private getFrontendBaseUrl(): string {
    return this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
  }

  /** Mesma verificação bcrypt-legado→argon2 usada em `AuthService`. */
  private async verifyPassword(
    hashedPassword: string,
    plainPassword: string,
  ): Promise<boolean> {
    if (BCRYPT_HASH_PATTERN.test(hashedPassword)) {
      return bcrypt.compare(plainPassword, hashedPassword);
    }
    return argon2.verify(hashedPassword, plainPassword);
  }
}

function sectionsOf(include?: string): Set<string> {
  if (include === undefined) {
    return new Set(OPTIONAL_PROFILE_SECTIONS);
  }

  return new Set(include.split(',').map((part) => part.trim()));
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/** Telefone em E.164; vazio apaga os três campos. */
function phoneData(phone: string) {
  const trimmed = phone.trim();

  if (!trimmed) {
    return { phone: null, phoneCountryCode: null, phoneNumber: null };
  }

  const { phoneCountryCode, phoneNumber } = parsePhoneNumber(trimmed);

  return { phone: trimmed, phoneCountryCode, phoneNumber };
}

function assertSinglePrimary(instruments: UserInstrumentInputDto[]): void {
  if (instruments.filter((instrument) => instrument.isPrimary).length > 1) {
    throw new BadRequestException(
      'Apenas um instrumento pode ser marcado como principal',
    );
  }
}

/** Blocos que a escrita tocou — a resposta devolve só eles, mais a conta. */
function touchedSections(dto: UpdateProfileDto): string {
  return [
    'account',
    ...(dto.instruments ? ['instruments'] : []),
    ...(dto.teacher ? ['teacher'] : []),
    ...(dto.student ? ['student'] : []),
  ].join(',');
}

/** Nomes dos campos alterados, por bloco — para a trilha escolar. */
function changedFields(dto: UpdateProfileDto): Record<string, string[]> {
  const account = [
    ...Object.keys(dto.account ?? {}),
    ...(dto.instruments ? ['instruments'] : []),
  ];

  return {
    ...(account.length > 0 ? { conta: account } : {}),
    ...(dto.student ? { aluno: Object.keys(dto.student) } : {}),
    ...(dto.teacher ? { professor: Object.keys(dto.teacher) } : {}),
  };
}
