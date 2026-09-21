import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { errorMessage } from '../common/utils/error.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSIGNMENT_NORMALIZATION,
  NormalizedField,
  normalizeValue,
} from '../portal/assignments/assignment-normalization';

/**
 * Normaliza `type` e `priority` das tarefas antes de virarem enum do Prisma.
 *
 * **Precisa rodar antes da versão com enum em toda base que já tenha tarefas.**
 * No MongoDB o enum é conferido pelo cliente, na leitura: um documento com
 * valor fora da lista não "fica errado" — ele faz a listagem de tarefas cair
 * com erro. Por isso este script lê e grava com comandos crus do Mongo, que
 * funcionam com qualquer versão do cliente.
 *
 * A regra de mapeamento vive em `portal/assignments/assignment-normalization`;
 * o que não tiver correspondência vai para o padrão e aparece no relatório.
 *
 * Uso (com `QUEUE_ROLE=api`, para nenhum worker de fila subir junto):
 *   node dist/scripts/normalize-assignments.js            # simulação
 *   node dist/scripts/normalize-assignments.js --apply    # aplica
 */

const COLLECTION = 'assignments';

interface DistinctRow {
  _id: unknown;
  count: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const logger = new Logger('NormalizeAssignments');
  const prisma = app.get(PrismaService);
  let changes = 0;

  try {
    logger.log(apply ? 'Modo: APLICAR' : 'Modo: SIMULAÇÃO (use --apply)');

    for (const field of Object.keys(
      ASSIGNMENT_NORMALIZATION,
    ) as NormalizedField[]) {
      const result = (await prisma.$runCommandRaw({
        aggregate: COLLECTION,
        pipeline: [{ $group: { _id: `$${field}`, count: { $sum: 1 } } }],
        cursor: {},
      })) as unknown as { cursor: { firstBatch: DistinctRow[] } };

      for (const row of result.cursor.firstBatch) {
        const { value, matched } = normalizeValue(field, row._id);

        if (row._id === value) {
          continue;
        }

        changes += row.count;
        const label = `${field}: ${JSON.stringify(row._id)} → "${value}" (${row.count} tarefa(s))`;

        if (matched) {
          logger.log(`${apply ? 'Normalizado' : '[simulação]'} ${label}`);
        } else {
          logger.warn(
            `${apply ? 'Sem correspondência, virou o padrão' : '[simulação] sem correspondência, viraria o padrão'} — ${label}`,
          );
        }

        if (apply) {
          await prisma.$runCommandRaw({
            update: COLLECTION,
            updates: [
              {
                // `null` também casa com campo ausente, que é o que se quer.
                q: { [field]: row._id ?? null },
                u: { $set: { [field]: value } },
                multi: true,
              },
            ],
          });
        }
      }
    }
  } catch (error: unknown) {
    logger.error(`Falha: ${errorMessage(error)}`);
    process.exitCode = 1;
  } finally {
    logger.log(`Resumo — tarefas com valor a normalizar: ${changes}`);
    await app.close();
  }
}

void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    new Logger('NormalizeAssignments').error(
      `Erro fatal: ${errorMessage(error)}`,
    );
    process.exit(1);
  });
