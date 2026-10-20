import { work } from '../catalog/jobs/fix-composer-epochs.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FixComposerEpochs', work);
