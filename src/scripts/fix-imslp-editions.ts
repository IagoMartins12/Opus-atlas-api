import { work } from '../catalog/jobs/fix-imslp-editions.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FixImslpEditions', work);
