import { work } from '../catalog/jobs/import-imslp-difficulty.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('ImportImslpDifficulty', work);
