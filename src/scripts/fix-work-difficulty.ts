import { work } from '../catalog/jobs/fix-work-difficulty.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FixWorkDifficulty', work);
