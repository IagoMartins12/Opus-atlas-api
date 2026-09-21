import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lista quem tem papel administrativo — **só lê, não altera nada**.
 *
 * **Por que existe.** No legado, `role = 1` era professor e `role = 2`,
 * administrador. Na API, `1` é `ADMIN` e `2` é `SUPER_ADMIN`; professor é o
 * campo `isTeacher`. Toda conta que o painel antigo promoveu a professor ficou
 * com `role = 1` — e, na API, isso é acesso de administrador (anúncios,
 * métricas, moderação).
 *
 * Ser professor e administrador ao mesmo tempo é permitido: são campos
 * independentes. O que este script mostra é **quem tem o papel sem que se
 * saiba se foi dado de propósito**, para alguém decidir conta a conta.
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
        papel: user.role === 2 ? 'SUPER_ADMIN' : 'ADMIN',
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
