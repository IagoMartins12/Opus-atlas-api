import { work } from '../catalog/jobs/feature-blog-events.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FeatureBlogEvents', work);
