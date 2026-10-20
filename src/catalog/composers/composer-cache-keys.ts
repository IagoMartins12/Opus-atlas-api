import { CacheNamespace } from '../../common/cache/cache-keys';

/**
 * The composer detail cache key, in one place: the service that fills it and
 * everything that invalidates it. Bump the version when the DTO shape changes.
 */
export const composerDetailCacheKey = (id: string) =>
  `${CacheNamespace.COMPOSERS}:detail:v2:${id}`;
