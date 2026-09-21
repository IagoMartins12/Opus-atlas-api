import { Injectable } from '@nestjs/common';
import { TokenType, UserToken } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonInput } from '../common/utils/json.util';

/**
 * Prazo de expiração por tipo de token de uso único, espelhando
 * `Classical-Music/src/app/libs/tokenUtils.ts` (`TOKEN_CONFIG`) — os tipos
 * de sessão (`REFRESH_TOKEN`) não entram aqui, são geridos em `AuthService`.
 */
const THIRTY_DAYS_IN_HOURS = 24 * 30;

const EXPIRES_IN_HOURS: Partial<Record<TokenType, number>> = {
  EMAIL_CONFIRMATION: 24,
  PASSWORD_RESET: 1,
  EMAIL_CHANGE: 48,
  NEWSLETTER_CONFIRMATION: 48,
  NEWSLETTER_UNSUBSCRIBE: 24 * 365,

  // Convites de professor e aluno duram 30 dias, como no legado. Sem estas
  // entradas o padrão de 24h se aplicaria, e um convite enviado numa
  // sexta-feira expiraria antes de a pessoa abrir o e-mail na segunda.
  STUDENT_INVITATION: THIRTY_DAYS_IN_HOURS,
  STUDENT_INVITATION_ACCEPT: THIRTY_DAYS_IN_HOURS,
  STUDENT_INVITATION_DECLINE: THIRTY_DAYS_IN_HOURS,
  TEACHER_INVITATION_ACCEPT: THIRTY_DAYS_IN_HOURS,
  TEACHER_INVITATION_DECLINE: THIRTY_DAYS_IN_HOURS,
};

export interface TokenValidationResult {
  valid: boolean;
  token?: UserToken;
  expired?: boolean;
  used?: boolean;
}

/**
 * Tokens de uso único (confirmação de conta, reset de senha, mudança de e-mail)
 * persistidos na tabela `UserToken` já existente — porta o comportamento de
 * `tokenUtils.ts` do front (seção 4.7.2 do SPEC.md: lógica portada, não reinventada).
 */
@Injectable()
export class UserTokenService {
  constructor(private readonly prisma: PrismaService) {}

  generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Invalida tokens não usados do mesmo tipo/identidade antes de criar um novo
   * — garante que só o link mais recente enviado por e-mail funcione. Aceita
   * `anonymousEmail` no lugar de `userId` para fluxos sem conta (newsletter de
   * visitante não cadastrado) — mesmo campo `UserToken.anonymousEmail` já
   * usado por `tokenUtils.ts` no legado.
   */
  async createToken(options: {
    userId?: string;
    anonymousEmail?: string;
    type: TokenType;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    /**
     * Invalida os tokens anteriores do mesmo tipo para o mesmo usuário.
     *
     * Verdadeiro por padrão, que é o certo para reset de senha e confirmação
     * de e-mail: emitir um novo link deve derrubar o antigo.
     *
     * **Falso para convites.** Um aluno pode ter convites pendentes de vários
     * professores ao mesmo tempo; revogar por tipo faria o convite do professor
     * A ser cancelado no instante em que o professor B convidasse a mesma
     * pessoa, sem aviso para ninguém.
     */
    revokePrevious?: boolean;
  }): Promise<string> {
    const {
      userId,
      anonymousEmail,
      type,
      metadata,
      ipAddress,
      userAgent,
      revokePrevious = true,
    } = options;
    const token = this.generateSecureToken();
    const expiresInHours = EXPIRES_IN_HOURS[type] ?? 24;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    if (revokePrevious) {
      await this.prisma.userToken.updateMany({
        where: userId
          ? { userId, type, used: false }
          : { anonymousEmail, type, used: false },
        data: { used: true },
      });
    }

    await this.prisma.userToken.create({
      data: {
        userId,
        anonymousEmail,
        type,
        token,
        expiresAt,
        metadata: toJsonInput(metadata) ?? {},
        ipAddress,
        userAgent,
      },
    });

    return token;
  }

  async validateToken(
    token: string,
    type: TokenType,
  ): Promise<TokenValidationResult> {
    const record = await this.prisma.userToken.findUnique({ where: { token } });

    if (!record || record.type !== type) {
      return { valid: false };
    }

    if (record.used) {
      return { valid: false, used: true, token: record };
    }

    if (record.expiresAt.getTime() < Date.now()) {
      return { valid: false, expired: true, token: record };
    }

    return { valid: true, token: record };
  }

  async markTokenAsUsed(token: string): Promise<void> {
    await this.prisma.userToken.update({
      where: { token },
      data: { used: true },
    });
  }

  async revokeAllUserTokens(userId: string, type: TokenType): Promise<void> {
    await this.prisma.userToken.updateMany({
      where: { userId, type, used: false },
      data: { used: true },
    });
  }

  /** Máximo de tokens de um tipo emitidos para o mesmo usuário/e-mail anônimo
   * na última hora. */
  async checkRateLimit(
    identity: { userId?: string; anonymousEmail?: string },
    type: TokenType,
    maxPerHour: number,
  ): Promise<{ allowed: boolean; remainingAttempts: number }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentCount = await this.prisma.userToken.count({
      where: {
        ...(identity.userId
          ? { userId: identity.userId }
          : { anonymousEmail: identity.anonymousEmail }),
        type,
        createdAt: { gte: oneHourAgo },
      },
    });

    return {
      allowed: recentCount < maxPerHour,
      remainingAttempts: Math.max(0, maxPerHour - recentCount),
    };
  }
}
