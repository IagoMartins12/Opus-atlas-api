import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { AppCacheService } from '../../common/cache/cache.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { reportToCsv } from './report-csv';
import { ReportDataService } from './report-data.service';
import {
  periodRange,
  REPORT_PERIODS,
  REPORT_TYPES,
  ReportData,
  ReportPeriod,
  ReportType,
} from './report-types';

const STATS_KEY = 'admin-reports:stats';
const STATS_TTL_MS = 5 * 60 * 1000;
const HISTORY_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const REPORT_LIST_SELECT = {
  id: true,
  name: true,
  type: true,
  format: true,
  period: true,
  status: true,
  error: true,
  fileSize: true,
  generatedAt: true,
  downloadCount: true,
} satisfies Prisma.GeneratedReportSelect;

type ReportRow = Prisma.GeneratedReportGetPayload<{
  select: typeof REPORT_LIST_SELECT;
}>;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Relatórios do painel, em CSV.
 *
 * **O que muda em relação ao legado (`admin/reports`):**
 *
 * - **O arquivo ia para `public/reports/`**, servido pelo próprio site: quem
 *   adivinhasse o nome (tipo, período e um `Date.now()`) baixava a lista de
 *   usuários sem login. Aqui não há arquivo: o retrato dos números fica no
 *   banco e o CSV é montado a cada download, atrás do papel de administrador.
 * - **Só CSV.** O Excel do legado usava a biblioteca `xlsx` (com falhas de
 *   segurança conhecidas e sem correção no npm), e o "PDF" era um HTML
 *   renomeado. CSV abre em qualquer planilha.
 * - O status `generating` ficava para sempre quando o processo caía no meio.
 *   A geração leva poucos segundos e acontece dentro da requisição: o registro
 *   só é criado com o resultado, pronto ou com o erro.
 */
@Injectable()
export class AdminReportsService {
  private readonly logger = new Logger(AdminReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: ReportDataService,
    private readonly cache: AppCacheService,
  ) {}

  async list(userId: string) {
    const [stats, results] = await Promise.all([
      this.stats(),
      this.prisma.generatedReport.findMany({
        where: { generatedBy: userId },
        select: REPORT_LIST_SELECT,
        orderBy: { generatedAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
    ]);

    return { stats, results: results.map((row) => this.toResult(row)) };
  }

  async generate(userId: string, type: ReportType, period: ReportPeriod) {
    const { start, end } = periodRange(period);
    const name = REPORT_TYPES[type];
    const filename = `${type}_${period}_${end.toISOString().slice(0, 10)}.csv`;

    let data: ReportData;
    try {
      data = await this.data.build(type, start, end);
    } catch (error: unknown) {
      const failed = await this.prisma.generatedReport.create({
        data: {
          name,
          type,
          format: 'csv',
          period,
          filename,
          status: 'failed',
          error: errorMessage(error).slice(0, 500),
          generatedBy: userId,
        },
        select: REPORT_LIST_SELECT,
      });
      this.logger.error(`Relatório ${type} falhou: ${errorMessage(error)}`);
      return this.toResult(failed);
    }

    const bytes = Buffer.byteLength(
      reportToCsv({ name, period, start, end, generatedAt: end }, data),
    );
    const created = await this.prisma.generatedReport.create({
      data: {
        name,
        type,
        format: 'csv',
        period,
        filename,
        status: 'ready',
        fileSize: formatSize(bytes),
        fileSizeBytes: bytes,
        reportData: data as unknown as Prisma.InputJsonValue,
        generatedBy: userId,
      },
      select: REPORT_LIST_SELECT,
    });

    return this.toResult(created);
  }

  async download(userId: string, reportId: string) {
    const report = await this.findOwn(userId, reportId);

    const data = report.reportData as unknown as Partial<ReportData> | null;

    if (report.status !== 'ready' || !data) {
      throw new NotFoundException('Relatório sem dados para baixar');
    }

    // Relatório gerado pelo legado guarda os números noutro formato.
    if (!Array.isArray(data.summary) || !Array.isArray(data.sections)) {
      throw new NotFoundException(
        'Relatório do sistema antigo, sem retrato neste formato — gere de novo',
      );
    }

    // Registro antigo do legado pode trazer um período fora da lista.
    const period = (
      report.period in REPORT_PERIODS ? report.period : '30d'
    ) as ReportPeriod;
    const { start, end } = periodRange(period, report.generatedAt);

    await this.prisma.generatedReport.update({
      where: { id: report.id },
      data: { downloadCount: { increment: 1 } },
    });

    return {
      filename: report.filename.replace(/\.(xlsx|excel|pdf|html)$/i, '.csv'),
      csv: reportToCsv(
        {
          name: report.name,
          period: report.period,
          start,
          end,
          generatedAt: end,
        },
        data as ReportData,
      ),
    };
  }

  async remove(userId: string, reportId: string): Promise<void> {
    const report = await this.findOwn(userId, reportId);
    await this.prisma.generatedReport.delete({ where: { id: report.id } });
  }

  // -------------------------------------------------------------------

  /** Os números do topo da tela — cinco minutos de cache, como o legado. */
  private async stats() {
    const cached = await this.cache.get<Record<string, number>>(STATS_KEY);
    if (cached) return cached;

    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * DAY_MS);
    const sevenDaysAgo = new Date(now - 7 * DAY_MS);

    const [
      totalUsers,
      totalWorks,
      totalComposers,
      totalAnnotations,
      activeUsers,
      newUsers,
      uploads,
      totalScores,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.work.count(),
      this.prisma.composer.count(),
      this.prisma.workAnnotation.count({ where: { isPublic: true } }),
      this.prisma.user.count({ where: { lastSeen: { gte: thirtyDaysAgo } } }),
      this.prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.uploadHistory.count({
        where: { createdAt: { gte: thirtyDaysAgo }, action: 'create' },
      }),
      this.prisma.workScore.count({ where: { isActive: true } }),
    ]);

    const stats = {
      totalUsers,
      totalWorks,
      totalComposers,
      totalAnnotations,
      activeUsers,
      newUsers,
      uploads,
      totalScores,
    };
    await this.cache.set(STATS_KEY, stats, STATS_TTL_MS);
    return stats;
  }

  private async findOwn(userId: string, reportId: string) {
    // Relatório de outro administrador responde como inexistente.
    const report = isMongoId(reportId)
      ? await this.prisma.generatedReport.findFirst({
          where: { id: reportId, generatedBy: userId },
        })
      : null;

    if (!report) {
      throw new NotFoundException('Relatório não encontrado');
    }

    return report;
  }

  private toResult(row: ReportRow) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      format: row.format,
      period: row.period,
      generatedAt: row.generatedAt,
      status: row.status,
      error: row.error,
      size: row.fileSize,
      downloadCount: row.downloadCount,
      downloadUrl:
        row.status === 'ready' ? `/api/admin/reports/${row.id}/download` : null,
    };
  }
}
