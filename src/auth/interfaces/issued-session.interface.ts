import { AuthUserDto } from '../dto/auth-user.dto';

/**
 * Sessão recém-emitida, com os dois tokens.
 *
 * Só o `AuthCookieService` decide o que dela vai para o corpo da resposta: os
 * tokens vão sempre nos cookies `httpOnly`, e no corpo apenas fora de produção.
 */
export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  /** Vida do token de acesso, em segundos. */
  expiresIn: number;
  user: AuthUserDto;
}
