import { PrismaService } from '../../prisma/prisma.service';
import { BackupHistoryService } from './backup-history.service';

function prismaCom(updateMany = jest.fn().mockResolvedValue({ count: 0 })) {
  const create = jest.fn().mockResolvedValue({ id: 'run-1' });

  return {
    prisma: {
      backupRun: { create, updateMany, update: jest.fn(), findMany: jest.fn() },
    } as unknown as PrismaService,
    create,
    updateMany,
  };
}

/**
 * O histórico responde "o último backup funcionou?". Uma execução que ficou
 * `running` para sempre responde "está rodando" — e é mentira.
 */
describe('BackupHistoryService', () => {
  it('registra o início da execução', async () => {
    const { prisma, create } = prismaCom();

    await expect(new BackupHistoryService(prisma).iniciar()).resolves.toBe(
      'run-1',
    );
    expect(create).toHaveBeenCalledWith({ data: { status: 'running' } });
  });

  /**
   * Quando o contêiner reinicia no meio do backup — falta de memória, deploy —
   * o `catch` que marcaria a falha nunca roda. Aconteceu em homologação: a
   * execução ficou "em andamento" indefinidamente.
   */
  it('fecha execuções velhas presas em "running" antes de começar outra', async () => {
    const { prisma, updateMany } = prismaCom();

    await new BackupHistoryService(prisma).iniciar();

    const [{ where, data }] = updateMany.mock.calls[0];
    expect(where.status).toBe('running');
    expect(data.status).toBe('failed');
    expect(data.error).toMatch(/interrompida/i);
  });

  it('só fecha o que já passou de duas horas', async () => {
    // Errar para menos marcaria como morta uma execução viva.
    const { prisma, updateMany } = prismaCom();
    const antes = Date.now();

    await new BackupHistoryService(prisma).iniciar();

    const [{ where }] = updateMany.mock.calls[0];
    const limite = (where.startedAt.lt as Date).getTime();

    expect(antes - limite).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    expect(antes - limite).toBeLessThan(2 * 60 * 60 * 1000 + 5000);
  });

  it('limpa antes de criar, para a execução nova não se marcar sozinha', async () => {
    const ordem: string[] = [];
    const updateMany = jest.fn(() => {
      ordem.push('limpeza');
      return Promise.resolve({ count: 1 });
    });
    const { prisma, create } = prismaCom(updateMany);
    create.mockImplementation(() => {
      ordem.push('criação');
      return Promise.resolve({ id: 'run-1' });
    });

    await new BackupHistoryService(prisma).iniciar();

    expect(ordem).toEqual(['limpeza', 'criação']);
  });
});
