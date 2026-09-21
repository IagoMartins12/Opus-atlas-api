import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reconcilia `Work.annotationsCount` com a contagem real de `WorkAnnotation`.
 *
 * **Por que existe.** A ordenação padrão do catálogo (`GET /works`) deixou de
 * contar anotações em tempo de consulta — isso custava um `$lookup` sobre as
 * 207 mil obras a cada chamada — e passou a ler o contador já gravado na obra.
 * O contador é mantido a cada anotação criada ou apagada pela API, mas dado
 * que nasceu antes disso, ou que foi mexido fora dela, pode ter divergido: na
 * base de desenvolvimento havia 5 obras com contador positivo e nenhuma
 * anotação. Com a ordenação nova, uma obra assim aparece no topo de "mais
 * anotadas" sem ter nenhuma.
 *
 * **O que faz.** Agrupa `WorkAnnotation` por obra (uma passada, pelo índice),
 * compara com o contador gravado e corrige a diferença. Também zera o contador
 * das obras que o têm positivo sem nenhuma anotação.
 *
 * Simulação por padrão, como os demais scripts de manutenção — nada é escrito
 * sem `--apply`.
 *
 * Uso:  node dist/scripts/sync-annotation-counts.js [--apply]
 */

/** Quantas obras corrigir por lote. */
const BATCH_SIZE = 500;

interface Divergence {
  workId: string;
  gravado: number;
  real: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const logger = new Logger('SyncAnnotationCounts');
  const prisma = app.get(PrismaService);

  try {
    const grouped = await prisma.workAnnotation.groupBy({
      by: ['workId'],
      _count: { _all: true },
    });

    const realCountByWork = new Map(
      grouped.map((row) => [row.workId, row._count._all]),
    );

    // As obras que podem divergir são as que têm anotação e as que têm
    // contador positivo — o resto já está em zero e zero.
    const suspects = await prisma.work.findMany({
      where: {
        OR: [
          { id: { in: [...realCountByWork.keys()] } },
          { annotationsCount: { gt: 0 } },
        ],
      },
      select: { id: true, annotationsCount: true },
    });

    const divergences: Divergence[] = suspects
      .map((work) => ({
        workId: work.id,
        gravado: work.annotationsCount,
        real: realCountByWork.get(work.id) ?? 0,
      }))
      .filter((row) => row.gravado !== row.real);

    if (divergences.length === 0) {
      logger.log(
        `Nada a corrigir: ${suspects.length} obra(s) conferida(s), contador e anotações batem.`,
      );
      return;
    }

    console.table(
      divergences.slice(0, 50).map((row) => ({
        obra: row.workId,
        gravado: row.gravado,
        real: row.real,
        diferenca: row.real - row.gravado,
      })),
    );

    if (!apply) {
      logger.warn(
        `${divergences.length} obra(s) com contador divergente. ` +
          'Simulação — nada foi alterado. Para corrigir: --apply',
      );
      return;
    }

    let corrigidas = 0;

    for (let start = 0; start < divergences.length; start += BATCH_SIZE) {
      const batch = divergences.slice(start, start + BATCH_SIZE);

      await Promise.all(
        batch.map((row) =>
          prisma.work.update({
            where: { id: row.workId },
            data: { annotationsCount: row.real },
          }),
        ),
      );

      corrigidas += batch.length;
      logger.log(`${corrigidas}/${divergences.length} obra(s) corrigida(s)`);
    }

    logger.log(
      `Pronto: ${corrigidas} contador(es) alinhado(s) com a contagem real.`,
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
    new Logger('SyncAnnotationCounts').error(
      `Erro fatal: ${errorMessage(error)}`,
    );
    process.exit(1);
  });
