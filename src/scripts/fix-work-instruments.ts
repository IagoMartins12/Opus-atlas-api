import { work } from '../catalog/jobs/fix-work-instruments.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FixWorkInstruments', work);
