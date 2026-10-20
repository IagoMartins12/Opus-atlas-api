import { work } from '../catalog/jobs/merge-duplicate-composers.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('MergeDuplicateComposers', work);
