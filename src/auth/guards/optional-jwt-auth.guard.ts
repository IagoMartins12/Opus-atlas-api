import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Como `JwtAuthGuard`, mas nunca lança: usado em rotas públicas que ainda assim
 * personalizam a resposta quando o chamador está autenticado (ex.: `userVote`
 * numa anotação pública). Sempre combinado com `@Public()` — sem ela, o
 * `JwtAuthGuard` global já barraria a request antes de chegar aqui.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
