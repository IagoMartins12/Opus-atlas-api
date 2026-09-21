import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Marca uma rota/controller como restrita a papéis específicos.
 * Usado em conjunto com `RolesGuard` (a ser implementado no AuthModule — fase 0.1).
 *
 * @example
 * @Roles('ADMIN')
 * @Get('users')
 * findAll() {}
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
