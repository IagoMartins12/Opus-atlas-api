import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { TheatroMunicipalScraperService } from './theatro-municipal-scraper.service';
import { ScraperJobsService } from '../jobs/scraper-jobs.service';
// import { ApiKeyGuard } from '../../guards/api-key.guard';
import {
  JobResponse,
  JobStatusResponse,
} from '../../common/interfaces/scraper-job.interface';
import { ScrapedEvent } from 'src/common/interfaces/scraped-event.interface';
import { ImportService } from '../import/import.service';

@Controller('scrapers/theatro-municipal')
// @UseGuards(ApiKeyGuard)
export class TheatroMunicipalScraperController {
  constructor(
    private readonly scraperService: TheatroMunicipalScraperService,
    private readonly jobsService: ScraperJobsService,
    private readonly importService: ImportService,
  ) {}

  @Post('scrape')
  async startScrape(): Promise<JobResponse> {
    console.log('helloo');
    const job = this.jobsService.createJob('theatro-municipal');

    setImmediate(async () => {
      try {
        this.jobsService.startJob(job.id);

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
      message: `Scraper Theatro Municipal iniciado. Use /api/scrapers/theatro-municipal/status/${job.id} para acompanhar.`,
    };
  }

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

  @Get('jobs')
  getAllJobs() {
    return {
      success: true,
      jobs: this.jobsService.getJobsByScraperId('theatro-municipal'),
    };
  }

  @Get('scrape/sync')
  async scrapeSync() {
    return this.scraperService.scrapeAndCheckDuplicates();
  }

  @Post('import')
  async importEvents(@Body() body: { events: ScrapedEvent[] }) {
    return this.importService.importEvents('theatro-municipal', body.events); // ✅ USAR
  }
}
