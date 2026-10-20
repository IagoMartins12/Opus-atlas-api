import { work } from '../catalog/jobs/fix-imslp-thumbnails.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('FixImslpThumbnails', work);
