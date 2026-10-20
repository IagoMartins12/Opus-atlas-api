import { work } from '../catalog/jobs/seed-collections.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('SeedCollections', work);
