import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccessTokenPayload } from '../interfaces/jwt-payload.interface';
import { ROLE_NAME_TO_LEVEL } from '../../common/auth/roles';

/**
 * Autoriza por papel numérico do `User.role` — 0 pessoa comum, **1 professor**,
 * 2 administrador. Os níveis vêm de `common/auth/roles.ts`, fonte única.
 *
 * Usado com `@Roles('ADMIN')` nas rotas administrativas. Antes `ADMIN` valia 1,
 * e como a comparação é `role >= exigido`, **todo professor abria o painel**:
 * o legado usava `role: 1` para marcar professor e essas contas vieram assim.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AccessTokenPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    const requiredLevels = requiredRoles.map(
      (role) => ROLE_NAME_TO_LEVEL[role] ?? Number.MAX_SAFE_INTEGER,
    );
    const minimumRequiredLevel = Math.min(...requiredLevels);

    if (user.role < minimumRequiredLevel) {
      throw new ForbiddenException(
        'Você não tem permissão para acessar este recurso',
      );
    }

    return true;
  }
}
