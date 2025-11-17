import { Injectable } from '@nestjs/common';
import {
  ScraperJob,
  JobStatus,
} from '../../common/interfaces/scraper-job.interface';

@Injectable()
export class ScraperJobsService {
  private jobs = new Map<string, ScraperJob>();

  /**
   * Criar novo job
   */
  createJob(scraperId: string): ScraperJob {
    const jobId = `${scraperId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const job: ScraperJob = {
      id: jobId,
      scraperId,
      status: JobStatus.PENDING,
      progress: {
        current: 0,
        total: 0,
        percentage: 0,
        message: 'Iniciando scraper...',
      },
      startTime: Date.now(),
    };

    this.jobs.set(jobId, job);
    console.log(`✅ Job created: ${jobId}`);

    return job;
  }

  /**
   * Atualizar progresso do job
   */
  updateProgress(
    jobId: string,
    current: number,
    total: number,
    message: string,
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = {
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
      message,
    };

    this.jobs.set(jobId, job);
  }

  /**
   * Marcar job como running
   */
  startJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = JobStatus.RUNNING;
    job.progress.message = 'Executando scraper...';
    this.jobs.set(jobId, job);
    console.log(`▶️  Job started: ${jobId}`);
  }

  /**
   * Marcar job como completo
   */
  completeJob(jobId: string, result: any): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = JobStatus.COMPLETED;
    job.endTime = Date.now();
    job.duration = job.endTime - job.startTime;
    job.result = result;
    job.progress.message = 'Scraper concluído com sucesso!';
    job.progress.percentage = 100;

    this.jobs.set(jobId, job);
    console.log(`✅ Job completed: ${jobId} (${job.duration}ms)`);

    // Limpar job após 5 minutos
    setTimeout(() => {
      this.jobs.delete(jobId);
      console.log(`🗑️  Job deleted: ${jobId}`);
    }, 300000);
  }

  /**
   * Marcar job como falho
   */
  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = JobStatus.FAILED;
    job.endTime = Date.now();
    job.duration = job.endTime - job.startTime;
    job.error = error;
    job.progress.message = `Erro: ${error}`;

    this.jobs.set(jobId, job);
    console.error(`❌ Job failed: ${jobId} - ${error}`);

    // Limpar job após 5 minutos
    setTimeout(() => {
      this.jobs.delete(jobId);
    }, 300000);
  }

  /**
   * Obter status do job
   */
  getJob(jobId: string): ScraperJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Listar todos os jobs
   */
  getAllJobs(): ScraperJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Listar jobs por scraper
   */
  getJobsByScraperId(scraperId: string): ScraperJob[] {
    return Array.from(this.jobs.values()).filter(
      (job) => job.scraperId === scraperId,
    );
  }
}
