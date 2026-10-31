import { work } from '../catalog/jobs/rank-works.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('RankWorks', work);
