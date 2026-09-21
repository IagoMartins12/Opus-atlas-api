import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccessTokenPayload } from '../interfaces/jwt-payload.interface';

const ROLE_NAME_TO_LEVEL: Record<string, number> = {
  USER: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
};

/**
 * Autoriza por papel numérico do `User.role` (0 comum, 1 admin, 2 super admin).
 * Usado em conjunto com `@Roles('ADMIN')` em rotas administrativas.
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
