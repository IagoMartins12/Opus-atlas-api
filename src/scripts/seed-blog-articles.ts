import { work } from '../catalog/jobs/seed-blog-articles.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('SeedBlogArticles', work);
