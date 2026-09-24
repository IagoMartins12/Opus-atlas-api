import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lista quem tem papel administrativo — **só lê, não altera nada**.
 *
 * **Por que existe.** No legado, `role = 1` era professor e `role = 2`,
 * administrador. Na migração o `1` virou o nível de `ADMIN` na checagem de
 * permissão — e, como o guard compara `role >= exigido`, **toda conta que o
 * painel antigo promoveu a professor passou a abrir rotas administrativas**
 * (anúncios, métricas, moderação). Corrigido em 23/09: `1` é professor de
 * novo e só `2` abre o painel (`common/auth/roles.ts`).
 *
 * O script continua útil para revisar quem ficou com papel: ser professor é
 * `isTeacher`, campo à parte, e uma conta em `role: 1` hoje não tem acesso
 * administrativo nenhum — mas também não deveria ter papel, se a intenção era
 * só dar aula.
 *
 * Uso:  node dist/scripts/audit-admin-roles.js
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const logger = new Logger('AuditAdminRoles');
  const prisma = app.get(PrismaService);

  try {
    const users = await prisma.user.findMany({
      where: { role: { gte: 1 } },
      select: {
        id: true,
        email: true,
        role: true,
        isTeacher: true,
        createdAt: true,
        lastSeen: true,
        teacherProfile: { select: { status: true } },
      },
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    });

    const suspicious = users.filter(
      (user) => user.role === 1 && user.isTeacher,
    );

    console.table(
      users.map((user) => ({
        id: user.id,
        email: user.email,
        papel: user.role === 2 ? 'ADMIN' : 'TEACHER (sem acesso ao painel)',
        professor: user.isTeacher
          ? `sim (${user.teacherProfile?.status ?? 'sem perfil'})`
          : 'não',
        criadoEm: user.createdAt.toISOString().slice(0, 10),
        ultimoAcesso: user.lastSeen?.toISOString().slice(0, 10) ?? '-',
        revisar: user.role === 1 && user.isTeacher ? 'SIM' : '',
      })),
    );

    logger.warn(
      `${users.length} conta(s) com papel administrativo; ${suspicious.length} ` +
        `são ADMIN e professor ao mesmo tempo — provável promoção pelo painel antigo. ` +
        `Para tirar o acesso de administrador de uma delas: PATCH /admin/users/:id { "role": 0 } ` +
        `(o vínculo de professor continua).`,
    );
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    new Logger('AuditAdminRoles').error(`Erro fatal: ${errorMessage(error)}`);
    process.exit(1);
  });
