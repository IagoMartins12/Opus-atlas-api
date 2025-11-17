// scrapers.controller.ts
import { Controller, Get, Post, Param } from '@nestjs/common';
import { OsespScraperService } from './osesp/osesp-scraper.service';
import { TheatroMunicipalScraperService } from './theatro-municipal/theatro-municipal-scraper.service';
import { SalaCeciliaMeirelesScraperService } from './sala-cecilia-meireles/sala-cecilia-meireles-scraper.service';
import { TeatroAmazonasScraperService } from './teatro-amazonas/teatro-amazonas-scraper.service';
import { TheatroDaPazScraperService } from './theatro-da-paz/theatro-da-paz-scraper.service';
import { AuditorioIbirapueraScraperService } from './auditorio-ibirapuera/auditorio-ibirapuera-scraper.service';
import { CidadeDasArtesScraperService } from './cidade-das-artes/cidade-das-artes-scraper.service';
import { ScraperJobsService } from './jobs/scraper-jobs.service';
import { BaseScraper } from './base/base-scraper';

@Controller('scrapers')
export class ScrapersController {
  private scrapers: Map<string, BaseScraper>;

  constructor(
    private osesp: OsespScraperService,
    private theatroMunicipal: TheatroMunicipalScraperService,
    private salaCecilia: SalaCeciliaMeirelesScraperService,
    private teatroAmazonas: TeatroAmazonasScraperService,
    private theatroDaPaz: TheatroDaPazScraperService,
    private auditorioIbirapuera: AuditorioIbirapueraScraperService,
    private cidadeDasArtes: CidadeDasArtesScraperService,
    private jobsService: ScraperJobsService,
  ) {
    this.scrapers = new Map<string, BaseScraper>([
      ['osesp', osesp],
      ['theatro-municipal', theatroMunicipal],
      ['sala-cecilia-meireles', salaCecilia],
      ['teatro-amazonas', teatroAmazonas],
      ['theatro-da-paz', theatroDaPaz],
      ['auditorio-ibirapuera', auditorioIbirapuera],
      ['cidade-das-artes', cidadeDasArtes],
    ]);
  }

  @Get('/list')
  listScrapers() {
    return {
      success: true,
      scrapers: Array.from(this.scrapers.keys()).map((key) => {
        const scraper = this.scrapers.get(key)!;
        const config = scraper.getConfig(); // ✅ Usando getter público
        return {
          id: key,
          name: config.venueName,
          slug: config.venueSlug,
        };
      }),
    };
  }

  @Post(':scraperId/scrape')
  async startScrape(@Param('scraperId') scraperId: string) {
    const scraper = this.scrapers.get(scraperId);

    if (!scraper) {
      return {
        success: false,
        message: `Scraper '${scraperId}' não encontrado`,
      };
    }

    const job = this.jobsService.createJob(scraperId);

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

        const result = await scraper.scrapeAndCheckDuplicates(onProgress); // ✅ Método existe agora
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
      message: `Scraper ${scraperId} iniciado. Use /api/scrapers/status/${job.id} para acompanhar.`,
    };
  }

  @Post('scrape-all')
  async scrapeAll() {
    const jobs = [];

    for (const [scraperId, scraper] of this.scrapers.entries()) {
      const job = this.jobsService.createJob(scraperId);
      jobs.push({ scraperId, jobId: job.id });

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

          const result = await scraper.scrapeAndCheckDuplicates(onProgress); // ✅ Método existe agora
          this.jobsService.completeJob(job.id, result);
        } catch (error) {
          this.jobsService.failJob(
            job.id,
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    }

    return {
      success: true,
      message: `${jobs.length} scrapers iniciados`,
      jobs,
    };
  }

  @Get('status/:jobId')
  getJobStatus(@Param('jobId') jobId: string) {
    const job = this.jobsService.getJob(jobId);

    if (!job) {
      return {
        success: false,
        message: 'Job não encontrado',
        job: null,
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
      jobs: this.jobsService.getAllJobs(),
    };
  }
}
