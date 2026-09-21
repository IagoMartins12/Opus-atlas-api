import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Prisma, TokenType } from '@prisma/client';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmAccountResponseDto } from './dto/confirm-account-response.dto';
import { EmailChangeResponseDto } from './dto/email-change-response.dto';
import { EmailStatusResponseDto } from './dto/email-status-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from './interfaces/jwt-payload.interface';
import { GoogleProfile } from './interfaces/google-profile.interface';
import { IssuedSession } from './interfaces/issued-session.interface';
import { UserTokenService } from './user-token.service';
import { validatePasswordStrength } from './utils/password-strength.util';

/** Hashes bcrypt legados começam com `$2a$`, `$2b$` ou `$2y$` (produzidos pelo NextAuth). */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.';

const RESEND_CONFIRMATION_GENERIC_MESSAGE =
  'Se este e-mail tiver uma conta ainda não confirmada, enviaremos um novo link de confirmação.';

/**
 * O mesmo `provider` que o adaptador do NextAuth gravava em `Account`: quem
 * entrou pelo Google no site antigo é reconhecido aqui sem novo vínculo.
 */
const GOOGLE_PROVIDER = 'google';

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isTeacher: true,
  isStudent: true,
} as const;

type AuthUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: number;
  isTeacher: boolean;
  isStudent: boolean;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly userTokenService: UserTokenService,
  ) {}

  async register(dto: RegisterDto): Promise<IssuedSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('Já existe uma conta com este e-mail');
    }

    const hashedPassword = await argon2.hash(dto.password);
    const username = await this.generateUniqueUsername(
      dto.firstName ?? normalizedEmail.split('@')[0],
    );

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        username,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isTeacher: true,
        isStudent: true,
      },
    });

    await this.sendAccountConfirmationEmail(
      user.id,
      normalizedEmail,
      user.firstName,
    );

    return this.issueSession(user);
  }

  /**
   * Envio de e-mail nunca bloqueia o registro: a conta já foi criada com sucesso
   * antes desta chamada — uma falha de SMTP não pode derrubar o cadastro.
   */
  private async sendAccountConfirmationEmail(
    userId: string,
    email: string,
    firstName: string | null,
    context?: { ipAddress: string; userAgent: string },
  ): Promise<void> {
    try {
      const token = await this.userTokenService.createToken({
        userId,
        type: TokenType.EMAIL_CONFIRMATION,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      const confirmationUrl = `${this.getFrontendBaseUrl()}/confirm-account/${token}`;

      await this.mailService.sendAccountConfirmationEmail(email, {
        firstName: firstName ?? 'Usuário',
        confirmationUrl,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao preparar e-mail de confirmação para ${email}: ${(error as Error).message}`,
      );
    }
  }

  private getFrontendBaseUrl(): string {
    return this.configService.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
  }

  async login(dto: LoginDto): Promise<IssuedSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isTeacher: true,
        isStudent: true,
        hashedPassword: true,
      },
    });

    if (!user || !user.hashedPassword) {
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }

    const passwordMatches = await this.verifyPasswordWithRehash(
      user.id,
      user.hashedPassword,
      dto.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }

    return this.issueSession(user);
  }

  async refresh(dto: { refreshToken: string }): Promise<IssuedSession> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const storedToken = await this.prisma.userToken.findFirst({
      where: {
        token: this.hashToken(dto.refreshToken),
        type: TokenType.REFRESH_TOKEN,
        userId: payload.sub,
      },
    });

    if (
      !storedToken ||
      storedToken.used ||
      storedToken.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    // Rotação obrigatória: o token apresentado nunca pode ser reutilizado,
    // mesmo que a verificação de assinatura JWT ainda seja válida (seção 3.3 do SPEC.md).
    await this.prisma.userToken.update({
      where: { id: storedToken.id },
      data: { used: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isTeacher: true,
        isStudent: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Usuário do refresh token não existe mais',
      );
    }

    return this.issueSession(user);
  }

  /**
   * Revoga o refresh token informado. Idempotente: um token já inválido/expirado
   * não gera erro, pois o resultado desejado (sessão encerrada) já está satisfeito.
   */
  async logout(dto: { refreshToken: string }): Promise<void> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.verifyRefreshToken(dto.refreshToken);
    } catch {
      return;
    }

    await this.prisma.userToken.updateMany({
      where: {
        token: this.hashToken(dto.refreshToken),
        type: TokenType.REFRESH_TOKEN,
        userId: payload.sub,
        used: false,
      },
      data: { used: true },
    });
  }

  /**
   * Sempre resolve com a mesma mensagem genérica, exista ou não o e-mail —
   * evita enumeração de contas (porta o comportamento de
   * `Classical-Music/src/app/api/auth/forgot-password/route.ts`).
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    context: { ipAddress: string; userAgent: string },
  ): Promise<MessageResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, firstName: true, hashedPassword: true },
    });

    if (!user) {
      // Atraso artificial para não revelar, por tempo de resposta, que o e-mail não existe.
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 + Math.random() * 1000),
      );

      return { success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE };
    }

    if (!user.hashedPassword) {
      await this.mailService.sendGoogleAccountResetNotice(user.email!, {
        firstName: user.firstName ?? 'Usuário',
      });

      return { success: true, message: FORGOT_PASSWORD_GENERIC_MESSAGE };
    }

    const rateLimit = await this.userTokenService.checkRateLimit(
      { userId: user.id },
      TokenType.PASSWORD_RESET,
      5,
    );

    if (!rateLimit.allowed) {
      throw new HttpException(
        {
          message: 'Muitas tentativas de reset. Tente novamente em 1 hora.',
          remainingAttempts: rateLimit.remainingAttempts,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const token = await this.userTokenService.createToken({
      userId: user.id,
      type: TokenType.PASSWORD_RESET,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const resetUrl = `${this.getFrontendBaseUrl()}/reset-password/${token}`;

    await this.mailService.sendPasswordResetEmail(user.email!, {
      firstName: user.firstName ?? 'Usuário',
      resetUrl,
    });

    return {
      success: true,
      message: FORGOT_PASSWORD_GENERIC_MESSAGE,
      remainingAttempts: rateLimit.remainingAttempts - 1,
    };
  }

  async resetPassword(
    dto: ResetPasswordDto,
    context: { ipAddress: string },
  ): Promise<MessageResponseDto> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Senhas não coincidem');
    }

    const strength = validatePasswordStrength(dto.password);
    if (!strength.valid) {
      throw new BadRequestException({
        message: 'Senha não atende aos critérios de segurança',
        passwordErrors: strength.errors,
      });
    }

    const validation = await this.userTokenService.validateToken(
      dto.token,
      TokenType.PASSWORD_RESET,
    );

    if (!validation.valid) {
      throw new BadRequestException(
        validation.expired
          ? 'Token expirado. Solicite um novo reset de senha.'
          : validation.used
            ? 'Este link de reset já foi utilizado. Solicite um novo.'
            : 'Token inválido',
      );
    }

    const userId = validation.token!.userId!;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, hashedPassword: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (!user.hashedPassword) {
      throw new BadRequestException(
        'Esta conta está vinculada ao Google. Use o login do Google.',
      );
    }

    const isSamePassword = await this.verifyPasswordWithRehash(
      user.id,
      user.hashedPassword,
      dto.password,
    ).catch(() => false);

    if (isSamePassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    const hashedPassword = await argon2.hash(dto.password);

    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedPassword },
    });

    await this.userTokenService.markTokenAsUsed(dto.token);
    await this.userTokenService.revokeAllUserTokens(
      userId,
      TokenType.PASSWORD_RESET,
    );
    // Encerra todas as sessões ativas — quem trocou a senha não deveria
    // permanecer logado em dispositivos que a senha antiga não autoriza mais.
    await this.userTokenService.revokeAllUserTokens(
      userId,
      TokenType.REFRESH_TOKEN,
    );

    await this.mailService
      .sendPasswordChangedEmail(user.email!, {
        firstName: user.firstName ?? 'Usuário',
        ipAddress: context.ipAddress,
      })
      .catch((error) =>
        this.logger.warn(
          `Falha ao notificar troca de senha para ${user.email}: ${(error as Error).message}`,
        ),
      );

    return {
      success: true,
      message:
        'Senha alterada com sucesso! Você já pode fazer login com sua nova senha.',
    };
  }

  async confirmAccount(token: string): Promise<ConfirmAccountResponseDto> {
    const validation = await this.userTokenService.validateToken(
      token,
      TokenType.EMAIL_CONFIRMATION,
    );

    if (!validation.valid) {
      throw new BadRequestException(
        validation.expired
          ? 'Token expirado. Solicite um novo link de confirmação.'
          : validation.used
            ? 'Este link de confirmação já foi utilizado.'
            : 'Token inválido',
      );
    }

    const userId = validation.token!.userId!;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, emailVerified: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (user.emailVerified) {
      await this.userTokenService.markTokenAsUsed(token);

      return {
        success: true,
        message: 'Email já confirmado anteriormente',
        alreadyConfirmed: true,
      };
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    });
    await this.userTokenService.markTokenAsUsed(token);

    return { success: true, message: 'Email confirmado com sucesso!' };
  }

  /**
   * Reenvia o link de confirmação de conta.
   *
   * Responde sempre a mesma mensagem — exista o e-mail ou não, já confirmado
   * ou não, e também quando o limite estoura —, para não servir de consulta de
   * contas. O legado respondia "Esta conta já foi confirmada", o que contava a
   * quem perguntasse que o e-mail estava cadastrado. Limite de três links por
   * hora por conta; cada link novo derruba o anterior (`createToken` revoga os
   * pendentes do mesmo tipo).
   */
  async resendAccountConfirmation(
    dto: ResendConfirmationDto,
    context: { ipAddress: string; userAgent: string },
  ): Promise<MessageResponseDto> {
    const generic = {
      success: true,
      message: RESEND_CONFIRMATION_GENERIC_MESSAGE,
    };

    const normalizedEmail = dto.email?.trim().toLowerCase();
    const user = dto.token
      ? await this.userOfConfirmationToken(dto.token)
      : await this.prisma.user.findUnique({
          where: { email: normalizedEmail ?? '' },
          select: {
            id: true,
            email: true,
            firstName: true,
            emailVerified: true,
          },
        });
    // Pelo e-mail, o destino é o que a pessoa digitou (e foi achado); pelo
    // link, o da conta dona dele.
    const target = dto.token ? user?.email : normalizedEmail;

    if (!user || !target || user.emailVerified) {
      return generic;
    }

    const rateLimit = await this.userTokenService.checkRateLimit(
      { userId: user.id },
      TokenType.EMAIL_CONFIRMATION,
      3,
    );

    if (!rateLimit.allowed) {
      return generic;
    }

    await this.sendAccountConfirmationEmail(
      user.id,
      target,
      user.firstName,
      context,
    );

    return generic;
  }

  /**
   * Conta dona de um link de confirmação — vencido ou já usado também. O link
   * chegou ao e-mail dela, então pedir outro por ele não revela nada novo.
   */
  private async userOfConfirmationToken(token: string) {
    const validation = await this.userTokenService.validateToken(
      token,
      TokenType.EMAIL_CONFIRMATION,
    );
    const userId = validation.token?.userId;

    if (!userId) {
      return null;
    }

    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, emailVerified: true },
    });
  }

  /** Endpoint público — usado pelo front para checar disponibilidade/estado de um e-mail. */
  async checkEmailStatus(email: string): Promise<EmailStatusResponseDto> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { emailVerified: true },
    });

    return { exists: !!user, verified: !!user?.emailVerified };
  }

  async confirmEmailChange(token: string): Promise<EmailChangeResponseDto> {
    const validation = await this.userTokenService.validateToken(
      token,
      TokenType.EMAIL_CHANGE,
    );

    if (!validation.valid) {
      throw new BadRequestException(
        validation.expired
          ? 'Token expirado. Solicite uma nova mudança de e-mail.'
          : validation.used
            ? 'Este link de confirmação já foi utilizado.'
            : 'Token inválido',
      );
    }

    const record = validation.token!;
    const userId = record.userId!;
    const metadata = (record.metadata ?? {}) as {
      newEmail?: string;
      oldEmail?: string;
    };
    const newEmail = metadata.newEmail ?? record.anonymousEmail ?? undefined;

    if (!newEmail) {
      throw new BadRequestException('Token inválido — e-mail não encontrado');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });

    if (emailTaken && emailTaken.id !== userId) {
      throw new ForbiddenException(
        'Este e-mail já está sendo usado por outra conta.',
      );
    }

    const oldEmail = metadata.oldEmail ?? user.email ?? '';

    await this.prisma.user.update({
      where: { id: userId },
      data: { email: newEmail, emailVerified: new Date() },
    });
    await this.userTokenService.markTokenAsUsed(token);

    const firstName = user.firstName ?? 'Usuário';

    if (oldEmail && oldEmail !== newEmail) {
      await this.mailService
        .sendEmailChangedToOldAddress(oldEmail, { firstName, newEmail })
        .catch(() => undefined);
    }

    await this.mailService
      .sendEmailChangeConfirmedToNewAddress(newEmail, { firstName })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Email alterado com sucesso!',
      oldEmail,
      newEmail,
    };
  }

  /**
   * Entrada pelo Google — reconhece, vincula ou cria a conta.
   *
   * O vínculo é a `Account` com `provider = 'google'` e o `sub` do Google em
   * `providerAccountId`, exatamente como o adaptador do NextAuth gravava.
   *
   * - **Já vinculada:** entra.
   * - **E-mail já cadastrado (por senha):** vincula e entra. O Google só é
   *   aceito com `email_verified`, então vincular não entrega a conta a quem
   *   não é dono do e-mail — e a conta passa a constar como confirmada.
   * - **Nova:** nasce com e-mail confirmado, sem senha, e recebe boas-vindas.
   *
   * Os tokens do Google não são guardados: a plataforma só precisa saber quem
   * é a pessoa, não agir em nome dela no Google.
   */
  async loginWithGoogle(
    profile: GoogleProfile,
  ): Promise<{ session: IssuedSession; isNewUser: boolean }> {
    if (!profile.emailVerified || !profile.email) {
      throw new UnauthorizedException('O Google não confirmou este e-mail');
    }

    const email = profile.email.trim().toLowerCase();

    const linked = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: GOOGLE_PROVIDER,
          providerAccountId: profile.sub,
        },
      },
      select: { user: { select: AUTH_USER_SELECT } },
    });

    if (linked) {
      return {
        session: await this.issueSession(linked.user),
        isNewUser: false,
      };
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { ...AUTH_USER_SELECT, emailVerified: true, image: true },
    });

    if (existing) {
      await this.linkGoogleAccount(existing.id, profile.sub);

      const fill = {
        ...(existing.emailVerified ? {} : { emailVerified: new Date() }),
        ...(!existing.image && profile.picture
          ? { image: profile.picture }
          : {}),
      };

      if (Object.keys(fill).length > 0) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: fill,
        });
      }

      return { session: await this.issueSession(existing), isNewUser: false };
    }

    const user = await this.createGoogleUser(email, profile);

    return { session: await this.issueSession(user), isNewUser: true };
  }

  private async createGoogleUser(
    email: string,
    profile: GoogleProfile,
  ): Promise<AuthUser> {
    const username = await this.generateUniqueUsername(
      profile.givenName ?? email.split('@')[0],
    );

    let user: AuthUser;

    try {
      user = await this.prisma.user.create({
        data: {
          email,
          username,
          firstName: profile.givenName,
          lastName: profile.familyName,
          image: profile.picture,
          emailVerified: new Date(),
          accounts: {
            create: {
              type: 'oauth',
              provider: GOOGLE_PROVIDER,
              providerAccountId: profile.sub,
            },
          },
        },
        select: AUTH_USER_SELECT,
      });
    } catch (error) {
      // Duas abas concluindo o primeiro login ao mesmo tempo: a outra criou a
      // conta. Vincula e segue com ela.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.user.findUnique({
          where: { email },
          select: AUTH_USER_SELECT,
        });

        if (raced) {
          await this.linkGoogleAccount(raced.id, profile.sub);
          return raced;
        }
      }

      throw error;
    }

    await this.mailService
      .sendWelcomeEmail(email, {
        firstName: user.firstName ?? 'Usuário',
        onboardingUrl: `${this.getFrontendBaseUrl()}/?onboarding=true`,
      })
      .catch((error) =>
        this.logger.warn(
          `Falha ao enviar boas-vindas para ${email}: ${(error as Error).message}`,
        ),
      );

    return user;
  }

  private async linkGoogleAccount(
    userId: string,
    googleSub: string,
  ): Promise<void> {
    try {
      await this.prisma.account.create({
        data: {
          userId,
          type: 'oauth',
          provider: GOOGLE_PROVIDER,
          providerAccountId: googleSub,
        },
      });
    } catch (error) {
      // Vínculo criado por uma requisição simultânea: o resultado é o mesmo.
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
      ) {
        throw error;
      }
    }
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.configService.get<string>('auth.refreshSecret') },
      );
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token informado não é um refresh token');
    }

    return payload;
  }

  /**
   * Verifica a senha contra o hash salvo. Hashes bcrypt legados (base pré-existente,
   * criada pelo NextAuth) continuam funcionando e são reescritos para argon2id
   * de forma transparente no primeiro login bem-sucedido (seção 3.3 do SPEC.md).
   */
  private async verifyPasswordWithRehash(
    userId: string,
    hashedPassword: string,
    plainPassword: string,
  ): Promise<boolean> {
    if (BCRYPT_HASH_PATTERN.test(hashedPassword)) {
      const matches = await bcrypt.compare(plainPassword, hashedPassword);

      if (matches) {
        const rehashed = await argon2.hash(plainPassword);
        await this.prisma.user.update({
          where: { id: userId },
          data: { hashedPassword: rehashed },
        });
      }

      return matches;
    }

    return argon2.verify(hashedPassword, plainPassword);
  }

  /** Refresh tokens nunca são persistidos em texto puro — só seu hash SHA-256. */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * `User.username` é `@unique` no schema — no MongoDB isso rejeita mais de um
   * documento com o campo ausente/nulo, então todo registro precisa de um valor.
   * Deriva um slug do nome/e-mail e tenta variações até achar um livre.
   */
  private async generateUniqueUsername(seed: string): Promise<string> {
    const base =
      seed
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || 'user';

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate =
        attempt === 0 ? base : `${base}${crypto.randomInt(1000, 9999)}`;

      const existing = await this.prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    return `${base}${crypto.randomUUID().slice(0, 8)}`;
  }

  private async issueSession(user: AuthUser): Promise<IssuedSession> {
    if (!user.email) {
      throw new BadRequestException(
        'Usuário sem e-mail válido para autenticação',
      );
    }

    const accessSecret = this.configService.get<string>('auth.accessSecret');
    const refreshSecret = this.configService.get<string>('auth.refreshSecret');
    const accessExpiresIn = this.configService.get<JwtSignOptions['expiresIn']>(
      'auth.accessExpiresIn',
      '15m',
    );
    const refreshExpiresIn = this.configService.get<
      JwtSignOptions['expiresIn']
    >('auth.refreshExpiresIn', '7d');

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      isTeacher: user.isTeacher,
      isStudent: user.isStudent,
      type: 'access',
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      type: 'refresh',
      jti: crypto.randomUUID(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: accessSecret,
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      }),
    ]);

    const refreshExpiresInSeconds =
      this.parseExpiresInToSeconds(refreshExpiresIn);

    await this.prisma.userToken.create({
      data: {
        userId: user.id,
        type: TokenType.REFRESH_TOKEN,
        token: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresInSeconds * 1000),
      },
    });

    // Último acesso. Cadastro, login e renovação passam todos por aqui, e a
    // renovação acontece a cada `accessExpiresIn` enquanto a pessoa usa o site —
    // precisão de minutos, com uma escrita por renovação. O `POST
    // /profile/heartbeat` também grava `lastSeen`, mas só enquanto o front o
    // chama; sem ele, "usuários ativos" (métricas, relatórios, lista de
    // usuários) contaria um campo parado.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeen: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpiresInToSeconds(accessExpiresIn),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isTeacher: user.isTeacher,
        isStudent: user.isStudent,
      },
    };
  }

  /**
   * Converte o `expiresIn` do JWT para segundos.
   *
   * O tipo do jsonwebtoken aceita número (já em segundos) ou string no formato
   * `15m`/`7d`. Tratar os dois casos aqui evita `as any` no ponto de assinatura
   * e mantém o retorno de `expiresIn` da API sempre em segundos.
   */
  private parseExpiresInToSeconds(value: JwtSignOptions['expiresIn']): number {
    if (typeof value === 'number') {
      return value;
    }

    if (!value) {
      return 900;
    }

    const match = /^(\d+)([smhd])$/.exec(String(value).trim());
    if (!match) {
      return 900;
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const unitToSeconds: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return amount * (unitToSeconds[unit] ?? 60);
  }
}
