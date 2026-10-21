import { work } from '../catalog/jobs/sync-teacher-counters.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('SyncTeacherCounters', work);
