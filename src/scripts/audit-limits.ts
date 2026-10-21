import { work } from '../catalog/jobs/audit-limits.job';
import { runCatalogScript } from './catalog-script';

void runCatalogScript('AuditLimits', work);
