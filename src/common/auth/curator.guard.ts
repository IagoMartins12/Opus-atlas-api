import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TeacherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { isAdmin } from './roles';

export const CURATOR_KEY = 'curator';

/**
 * Libera a rota para **curadores do catálogo**: administradores e professores
 * já aprovados.
 *
 * **Por que não dá para resolver com `@Roles(...)`.** Papel e função são
 * campos separados desde a migração: quem dá aula é `isTeacher`, e o `role`
 * continua 0. Nenhum nível numérico descreve "professor aprovado" — e tentar
 * descrever com número foi o que, no legado, fez `role: 1` significar
 * professor e, na API, virar acesso de administrador.
 *
 * **Por que "aprovado" e não só `isTeacher`.** Ser promovido a professor cria
 * o perfil como `PENDING`: a aprovação é de um administrador, depois de olhar
 * quem é a pessoa. Aceitar `isTeacher` sozinho daria escrita no catálogo a
 * quem ainda está na fila de análise.
 *
 * **Custa uma consulta por requisição** — o token carrega `isTeacher`, não a
 * aprovação. Só as rotas marcadas pagam isso, e são de escrita, onde uma ida
 * ao banco não muda nada. Pôr a aprovação no token sairia mais barato e seria
 * pior: o token vive 15 minutos, então revogar um professor demoraria até
 * quinze minutos para valer.
 */
@Injectable()
export class CuratorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const exige = this.reflector.getAllAndOverride<boolean>(CURATOR_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!exige) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AccessTokenPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    if (isAdmin(user.role)) {
      return true;
    }

    if (!user.isTeacher) {
      throw new ForbiddenException(
        'Só administradores e professores editam o catálogo',
      );
    }

    const perfil = await this.prisma.teacher.findUnique({
      where: { userId: user.sub },
      select: { status: true, isVerified: true },
    });

    // `ACTIVE` é o perfil que aceitou o convite; `isVerified` é a aprovação
    // manual das credenciais. Os dois, porque um professor ativo mas ainda
    // não conferido é justamente quem a análise não olhou.
    if (perfil?.status !== TeacherStatus.ACTIVE || !perfil.isVerified) {
      throw new ForbiddenException(
        'Seu cadastro de professor ainda está em análise',
      );
    }

    return true;
  }
}

/**
 * Marca a rota como de curadoria: administrador **ou** professor aprovado.
 *
 * Vem acompanhada de `@Roles('USER')` quando o controller inteiro exige
 * `SUPER_ADMIN` — o papel do método sobrescreve o da classe, e quem de fato
 * decide passa a ser este guard. Sem o `@Roles` no método, o professor
 * esbarraria no papel do controller antes de chegar aqui.
 */
export const Curator = () => SetMetadata(CURATOR_KEY, true);
