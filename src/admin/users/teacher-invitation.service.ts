import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TeacherStatus, TokenType } from '@prisma/client';
import { UserTokenService } from '../../auth/user-token.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { errorMessage } from '../../common/utils/error.util';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Reenvios que a própria pessoa pode pedir por hora. */
const MAX_RESENDS_PER_HOUR = 3;

const displayName = (user: {
  firstName: string | null;
  lastName: string | null;
}) => [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

/**
 * Convite para ser professor — o que faltava depois da troca de papel.
 *
 * **O que acontecia na API antes disto.** O admin marcava a conta como
 * professor e o perfil nascia `PENDING` em silêncio: nenhum e-mail saía, e as
 * páginas `confirm-teacher-invite` e `decline-teacher-invite` do front não
 * tinham rota para chamar. O professor ficava pendente para sempre.
 *
 * **O fluxo.** Promovido, a pessoa recebe um e-mail com dois links (30 dias).
 * Aceitar ativa o perfil — **não o verifica**: aceitar o convite não é ser
 * aprovado, e o selo continua sendo decisão do admin. Recusar desfaz a troca de
 * papel. Um link usado derruba o outro.
 *
 * **Diferença do legado.** O legado conferia `role === 1` como "professor" —
 * na API ser professor é `isTeacher`, não papel (RN-1) — e aceitava o convite
 * por `GET`, que um pré-carregador de link do cliente de e-mail disparava
 * sozinho. Aqui aceitar e recusar são `POST`, feitos pela página do front.
 */
@Injectable()
export class TeacherInvitationService {
  private readonly logger = new Logger(TeacherInvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserTokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly cache: AppCacheService,
  ) {}

  /** Emite os links e envia o e-mail. Falha de e-mail vira log, não erro. */
  async send(userId: string, invitedById?: string): Promise<boolean> {
    const [user, invitedBy] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      }),
      invitedById
        ? this.prisma.user.findUnique({
            where: { id: invitedById },
            select: { firstName: true, lastName: true },
          })
        : null,
    ]);

    if (!user?.email) {
      this.logger.warn(
        `Convite de professor não enviado: conta ${userId} sem e-mail`,
      );
      return false;
    }

    // Só o link mais recente vale: um reenvio derruba os anteriores.
    const [acceptToken, declineToken] = await Promise.all([
      this.tokens.createToken({
        userId,
        type: TokenType.TEACHER_INVITATION_ACCEPT,
      }),
      this.tokens.createToken({
        userId,
        type: TokenType.TEACHER_INVITATION_DECLINE,
      }),
    ]);

    const baseUrl = this.config.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );

    try {
      await this.mail.sendTeacherInvitationEmail(user.email, {
        firstName: user.firstName || 'professor',
        invitedByName: invitedBy
          ? displayName(invitedBy) || 'A equipe'
          : 'A equipe',
        acceptUrl: `${baseUrl}/confirm-teacher-invite/${acceptToken}`,
        declineUrl: `${baseUrl}/decline-teacher-invite/${declineToken}`,
      });
      return true;
    } catch (error: unknown) {
      this.logger.error(
        `Falha ao enviar convite de professor para ${userId}: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  async accept(token: string) {
    const userId = await this.consume(
      token,
      TokenType.TEACHER_INVITATION_ACCEPT,
    );
    const teacher = await this.requireInvitedTeacher(userId);

    // Só o pendente vira ativo. Um perfil que o admin desativou depois do
    // convite não volta por um link antigo.
    if (teacher.status === TeacherStatus.PENDING) {
      await this.prisma.teacher.update({
        where: { id: teacher.id },
        data: { status: TeacherStatus.ACTIVE },
      });
    }

    await this.tokens.revokeAllUserTokens(
      userId,
      TokenType.TEACHER_INVITATION_DECLINE,
    );
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);

    return {
      success: true,
      message:
        'Convite aceito. Seu perfil de professor está ativo; a verificação é feita pela equipe.',
    };
  }

  async decline(token: string) {
    const userId = await this.consume(
      token,
      TokenType.TEACHER_INVITATION_DECLINE,
    );
    const teacher = await this.requireInvitedTeacher(userId);

    // Desativa em vez de apagar, como a troca de papel pelo admin: se houver
    // aula ou vínculo, o histórico depende do perfil existir.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isTeacher: false },
      }),
      this.prisma.teacher.update({
        where: { id: teacher.id },
        data: { status: TeacherStatus.INACTIVE, isVerified: false },
      }),
    ]);

    await this.tokens.revokeAllUserTokens(
      userId,
      TokenType.TEACHER_INVITATION_ACCEPT,
    );
    await this.cache.invalidateMany([CacheNamespace.TEACHERS]);

    return { success: true, message: 'Convite recusado.' };
  }

  /**
   * Novo link, pedido pela própria pessoa com o link antigo (vencido ou não).
   * O link prova que o e-mail é dela; o novo vai para o mesmo endereço.
   */
  async resend(token: string) {
    const record = await this.prisma.userToken.findUnique({
      where: { token },
      select: { userId: true, type: true },
    });

    if (
      !record?.userId ||
      (record.type !== TokenType.TEACHER_INVITATION_ACCEPT &&
        record.type !== TokenType.TEACHER_INVITATION_DECLINE)
    ) {
      throw new NotFoundException('Convite não encontrado');
    }

    const teacher = await this.requireInvitedTeacher(record.userId);

    if (teacher.status !== TeacherStatus.PENDING) {
      throw new BadRequestException('Este convite já foi respondido');
    }

    const limit = await this.tokens.checkRateLimit(
      { userId: record.userId },
      TokenType.TEACHER_INVITATION_ACCEPT,
      MAX_RESENDS_PER_HOUR,
    );

    if (!limit.allowed) {
      throw new HttpException(
        'Muitos reenvios. Tente de novo em uma hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.send(record.userId);
    return {
      success: true,
      message: 'Enviamos um novo convite para o seu e-mail.',
    };
  }

  // -------------------------------------------------------------------

  private async consume(token: string, type: TokenType): Promise<string> {
    const validation = await this.tokens.validateToken(token, type);

    if (!validation.valid || !validation.token?.userId) {
      throw new BadRequestException(
        validation.expired
          ? 'Este convite expirou. Peça um novo pelo link.'
          : 'Convite inválido ou já utilizado',
      );
    }

    await this.tokens.markTokenAsUsed(token);
    return validation.token.userId;
  }

  /** A conta ainda é professor pendente de convite? */
  private async requireInvitedTeacher(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isTeacher: true,
        teacherProfile: { select: { id: true, status: true } },
      },
    });

    if (!user?.isTeacher || !user.teacherProfile) {
      // O admin desfez a promoção depois de enviar o convite.
      throw new BadRequestException('Este convite não vale mais');
    }

    return user.teacherProfile;
  }
}
