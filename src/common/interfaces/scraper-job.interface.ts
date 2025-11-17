export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface ScraperJob {
  id: string;
  scraperId: string;
  status: JobStatus;
  progress: {
    current: number;
    total: number;
    percentage: number;
    message: string;
  };
  startTime: number;
  endTime?: number;
  duration?: number;
  result?: any;
  error?: string;
}

export interface JobResponse {
  success: boolean;
  jobId: string;
  message: string;
}

export interface JobStatusResponse {
  success: boolean;
  job: ScraperJob;
}
