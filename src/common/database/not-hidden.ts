/**
 * "Not held by moderation", for models with an optional `isHidden` flag.
 *
 * On MongoDB, Prisma's `{ isHidden: { not: true } }` (and `NOT`) skips
 * documents where the field was never written, which is almost all of them:
 * the flag only appears once a serious report holds something. `isSet`
 * covers the missing field.
 */
export const NOT_HIDDEN = {
  OR: [{ isHidden: { isSet: false } }, { isHidden: false }],
};
