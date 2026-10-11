/**
 * Filters on optional fields that most documents never had written.
 *
 * On MongoDB, Prisma's `{ field: null }` matches only an explicit null, and
 * `{ field: { not: true } }` (or `NOT`) skips documents where the field is
 * missing, which is almost all of them: these flags only appear once
 * something happens. `isSet: false` covers the missing field.
 */

/** Not held by moderation (`isHidden` absent or false). */
export const NOT_HIDDEN = {
  OR: [{ isHidden: { isSet: false } }, { isHidden: false }],
};

/** Not taken back (`revertedAt` absent or null). */
export const NOT_REVERTED = {
  OR: [{ revertedAt: { isSet: false } }, { revertedAt: null }],
};
