import { work } from '../catalog/jobs/fix-composer-nationalities.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FixComposerNationalities', work);
