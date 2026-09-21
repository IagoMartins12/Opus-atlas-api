import { NotFoundException } from '@nestjs/common';
import { AppCacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminReportsService } from './admin-reports.service';
import { ReportDataService } from './report-data.service';

const ADMIN = '64b000000000000000000001';
const REPORT = '64b0000000000000000000aa';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: REPORT,
  name: 'Resumo de Usuários',
  type: 'users-overview',
  format: 'csv',
  period: '30d',
  status: 'ready',
  error: null,
  fileSize: '1.0 KB',
  generatedAt: new Date('2026-09-12T00:00:00Z'),
  downloadCount: 0,
  filename: 'users-overview_30d_2026-09-12.csv',
  reportData: { summary: [['Usuários', 3]], sections: [] },
  ...overrides,
});

describe('AdminReportsService', () => {
  let prisma: {
    generatedReport: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    user: { count: jest.Mock };
    work: { count: jest.Mock };
    composer: { count: jest.Mock };
    workAnnotation: { count: jest.Mock };
    uploadHistory: { count: jest.Mock };
    workScore: { count: jest.Mock };
  };
  let data: { build: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: AdminReportsService;

  beforeEach(() => {
    const count = () => ({ count: jest.fn().mockResolvedValue(1) });
    prisma = {
      generatedReport: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findFirst: jest.fn().mockResolvedValue(row()),
        create: jest.fn(({ data }) => Promise.resolve(row({ ...data }))),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      user: count(),
      work: count(),
      composer: count(),
      workAnnotation: count(),
      uploadHistory: count(),
      workScore: count(),
    };
    data = {
      build: jest
        .fn()
        .mockResolvedValue({ summary: [['Usuários', 3]], sections: [] }),
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminReportsService(
      prisma as unknown as PrismaService,
      data as unknown as ReportDataService,
      cache as unknown as AppCacheService,
    );
  });

  it('lista os números e só os relatórios do próprio administrador', async () => {
    const result = await service.list(ADMIN);

    expect(prisma.generatedReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { generatedBy: ADMIN }, take: 50 }),
    );
    expect(result.stats).toMatchObject({ totalUsers: 1, totalScores: 1 });
    expect(result.results[0]).toMatchObject({
      id: REPORT,
      downloadUrl: `/api/admin/reports/${REPORT}/download`,
    });
    expect(cache.set).toHaveBeenCalledWith(
      'admin-reports:stats',
      expect.any(Object),
      5 * 60 * 1000,
    );
  });

  it('números em cache não vão ao banco', async () => {
    cache.get.mockResolvedValue({ totalUsers: 99 });

    const result = await service.list(ADMIN);

    expect(result.stats).toEqual({ totalUsers: 99 });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('gera: grava o retrato, o tamanho do CSV e devolve pronto', async () => {
    const result = await service.generate(ADMIN, 'users-overview', '30d');

    const [{ data: created }] = prisma.generatedReport.create.mock.calls[0];
    expect(created).toMatchObject({
      format: 'csv',
      status: 'ready',
      generatedBy: ADMIN,
      reportData: { summary: [['Usuários', 3]], sections: [] },
    });
    expect(created.fileSizeBytes).toBeGreaterThan(0);
    expect(result.status).toBe('ready');
  });

  it('falha na geração vira relatório "failed" com o motivo, sem link', async () => {
    data.build.mockRejectedValue(new Error('timeout do Mongo'));

    const result = await service.generate(ADMIN, 'content-analysis', '7d');

    expect(result).toMatchObject({
      status: 'failed',
      error: 'timeout do Mongo',
      downloadUrl: null,
    });
  });

  it('download monta o CSV do retrato e conta o download', async () => {
    const file = await service.download(ADMIN, REPORT);

    expect(file.filename).toBe('users-overview_30d_2026-09-12.csv');
    expect(file.csv).toContain('"Usuários","3"');
    expect(prisma.generatedReport.update).toHaveBeenCalledWith({
      where: { id: REPORT },
      data: { downloadCount: { increment: 1 } },
    });
  });

  it('relatório antigo em Excel baixa como .csv, com período fora da lista tratado', async () => {
    prisma.generatedReport.findFirst.mockResolvedValue(
      row({ filename: 'x_2y_1.xlsx', period: '2y' }),
    );

    const file = await service.download(ADMIN, REPORT);

    expect(file.filename).toBe('x_2y_1.csv');
    expect(file.csv).toContain('"Período","2y');
  });

  it('retrato do legado, sem seções, é 404 com instrução', async () => {
    prisma.generatedReport.findFirst.mockResolvedValue(
      row({ reportData: { summary: { totalUsers: 3 }, newUsers: [] } }),
    );

    await expect(service.download(ADMIN, REPORT)).rejects.toThrow(
      /gere de novo/,
    );
  });

  it('relatório que falhou não baixa', async () => {
    prisma.generatedReport.findFirst.mockResolvedValue(
      row({ status: 'failed', reportData: null }),
    );

    await expect(service.download(ADMIN, REPORT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('relatório de outro administrador responde como inexistente', async () => {
    prisma.generatedReport.findFirst.mockResolvedValue(null);

    await expect(service.remove(ADMIN, REPORT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.generatedReport.findFirst).toHaveBeenCalledWith({
      where: { id: REPORT, generatedBy: ADMIN },
    });
    expect(prisma.generatedReport.delete).not.toHaveBeenCalled();
  });

  it('apaga o próprio; id inválido nem vai ao banco', async () => {
    await service.remove(ADMIN, REPORT);
    expect(prisma.generatedReport.delete).toHaveBeenCalledWith({
      where: { id: REPORT },
    });

    prisma.generatedReport.findFirst.mockClear();
    await expect(service.remove(ADMIN, 'abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.generatedReport.findFirst).not.toHaveBeenCalled();
  });
});
