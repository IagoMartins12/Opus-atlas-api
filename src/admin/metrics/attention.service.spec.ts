import { PrismaService } from '../../prisma/prisma.service';
import { JobStatusService } from '../../common/queue/job-status.service';
import { AttentionService } from './attention.service';

function montar() {
  const prisma = {
    $runCommandRaw: jest.fn().mockResolvedValue({ cursor: { firstBatch: [] } }),
    uploadModeration: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    blogComment: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    blogArticle: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
    },
    backupRun: { findFirst: jest.fn().mockResolvedValue(null) },
    subscription: { count: jest.fn().mockResolvedValue(0) },
    newsletterCampaign: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const jobs = {
    health: jest.fn().mockResolvedValue([]),
    failures: jest.fn().mockResolvedValue([]),
  };
  const service = new AttentionService(
    prisma as unknown as PrismaService,
    jobs as unknown as JobStatusService,
  );
  return { prisma, jobs, service };
}

describe('AttentionService', () => {
  it('fila fora do ar vira erro no bloco dela, e o resto responde', async () => {
    const { jobs, prisma, service } = montar();
    jobs.health.mockRejectedValue(new Error('redis caiu'));
    prisma.uploadModeration.count.mockResolvedValue(3);

    const r = await service.attention();

    expect(r.filas).toEqual({ erro: 'Não foi possível ler agora.' });
    expect(r.denuncias).toMatchObject({ abertas: 3 });
  });

  it('conta só as falhas das últimas 24 h e aponta fila sem worker', async () => {
    const { jobs, service } = montar();
    const agora = Date.now();
    jobs.health.mockResolvedValue([
      {
        queue: 'email',
        paused: false,
        workers: 1,
        counts: { waiting: 0, failed: 3 },
        oldestWaitingSeconds: null,
      },
      {
        queue: 'maintenance',
        paused: false,
        workers: 0,
        counts: { waiting: 4, failed: 0 },
        oldestWaitingSeconds: 600,
      },
    ]);
    jobs.failures.mockResolvedValue([
      { job: 'send', failedReason: 'SMTP', failedAt: new Date(agora - 60_000) },
      {
        job: 'send',
        failedReason: 'SMTP',
        failedAt: new Date(agora - 2 * 60_000),
      },
      {
        job: 'send',
        failedReason: 'velha',
        failedAt: new Date(agora - 3 * 86_400_000),
      },
    ]);

    const r = (await service.attention()).filas as {
      falhas24h: number;
      paradas: { fila: string }[];
    };

    expect(r.falhas24h).toBe(2);
    expect(r.paradas).toEqual([
      { fila: 'maintenance', esperando: 4, maisAntigoSegundos: 600 },
    ]);
  });

  it('backup sem verificação recente fica "velho"', async () => {
    const { prisma, service } = montar();
    prisma.backupRun.findFirst.mockResolvedValue({
      verifiedAt: new Date(Date.now() - 72 * 3_600_000),
    });

    const r = (await service.attention()).backup as { velho: boolean };
    expect(r.velho).toBe(true);
  });

  it('nomeia o artigo com mais comentários esperando', async () => {
    const { prisma, service } = montar();
    prisma.$runCommandRaw.mockResolvedValue({
      cursor: { firstBatch: [{ _id: { $oid: 'a1' }, n: 6 }] },
    });
    prisma.blogArticle.findUnique.mockResolvedValue({
      title: 'Chopin e o rubato',
    });

    const r = (await service.attention()).blog as {
      artigoComMaisPendentes: unknown;
    };
    expect(r.artigoComMaisPendentes).toEqual({
      titulo: 'Chopin e o rubato',
      pendentes: 6,
    });
  });
});
