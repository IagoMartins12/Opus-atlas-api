import { work } from '../catalog/jobs/recheck-imslp-scores.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('RecheckImslpScores', work);
