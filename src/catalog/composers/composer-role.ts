import type { Prisma } from '@prisma/client';

/** The `Role` id of "composer" (people stored as performers, editors… are not). */
export const COMPOSER_ROLE_ID = '685d591c1e3db0c5aaa893e4';

/** Matches people whose primary or secondary role is composer. */
export const IS_COMPOSER: Prisma.ComposerWhereInput = {
  OR: [
    { primaryRoleId: COMPOSER_ROLE_ID },
    { roles: { contains: COMPOSER_ROLE_ID } },
  ],
};
