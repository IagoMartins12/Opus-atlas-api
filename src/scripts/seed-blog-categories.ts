import { work } from '../catalog/jobs/seed-blog-categories.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('SeedBlogCategories', work);
