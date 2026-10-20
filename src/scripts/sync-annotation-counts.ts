import { work } from '../catalog/jobs/sync-annotation-counts.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('SyncAnnotationCounts', work);
