import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { OsespScraperService } from './osesp-scraper.service';
import { ScraperJobsService } from '../jobs/scraper-jobs.service';
import {
  JobResponse,
  JobStatusResponse,
} from '../../common/interfaces/scraper-job.interface';
import { ImportService } from '../import/import.service';
import { ScrapedEvent } from 'src/common/interfaces/scraped-event.interface';

@Controller('scrapers/osesp')
// @UseGuards(ApiKeyGuard)
export class OsespScraperController {
  constructor(
    private readonly scraperService: OsespScraperService,
    private readonly jobsService: ScraperJobsService,
    private readonly importService: ImportService,
  ) {}

  /**
   * 🚀 Iniciar scraper (assíncrono)
   */
  @Post('scrape')
  async startScrape(): Promise<JobResponse> {
    // Criar job
    const job = this.jobsService.createJob('osesp');

    // Executar scraper em background
    setImmediate(async () => {
      try {
        this.jobsService.startJob(job.id);

        // Callback de progresso
        const onProgress = (
          current: number,
          total: number,
          message: string,
        ) => {
          this.jobsService.updateProgress(job.id, current, total, message);
        };

        const result =
          await this.scraperService.scrapeAndCheckDuplicates(onProgress);

        this.jobsService.completeJob(job.id, result);
      } catch (error) {
        this.jobsService.failJob(
          job.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    return {
      success: true,
      jobId: job.id,
      message: `Scraper OSESP iniciado. Use /api/scrapers/osesp/status/${job.id} para acompanhar.`,
    };
  }

  /**
   * 📊 Verificar status do job
   */
  @Get('status/:jobId')
  getJobStatus(@Param('jobId') jobId: string): JobStatusResponse {
    const job = this.jobsService.getJob(jobId);

    if (!job) {
      return {
        success: false,
        job: null as any,
      };
    }

    return {
      success: true,
      job,
    };
  }

  /**
   * 📋 Listar todos os jobs do OSESP
   */
  @Get('jobs')
  getAllJobs() {
    return {
      success: true,
      jobs: this.jobsService.getJobsByScraperId('osesp'),
    };
  }

  /**
   * 🔄 Scrape síncrono (manter para compatibilidade/testes)
   */
  @Get('scrape/sync')
  async scrapeSync() {
    return this.scraperService.scrapeAndCheckDuplicates();
  }

  @Post('import')
  async importEvents(@Body() body: { events: ScrapedEvent[] }) {
    return this.importService.importEvents('osesp', body.events); // ✅ USAR
  }
}
