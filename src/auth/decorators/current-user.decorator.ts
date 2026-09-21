import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenPayload } from '../interfaces/jwt-payload.interface';

/**
 * Extrai o payload do usuário autenticado anexado pelo `JwtAuthGuard`.
 *
 * @example
 * @Get('me')
 * me(@CurrentUser() user: AccessTokenPayload) {}
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
