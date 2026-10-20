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

/**
 * "Preenchido" e o seu contrário para um campo de texto: o legado gravou o
 * vazio de três jeitos (campo ausente, nulo e texto em branco), e cada um
 * precisa de um filtro. A tela de qualidade e as listas do painel usam esta
 * mesma regra, para o número e a lista que ele abre nunca discordarem.
 */
export const fieldIs = <W>(field: string, filled: boolean): W =>
  (filled
    ? {
        AND: [
          { [field]: { isSet: true } },
          { [field]: { not: null } },
          { [field]: { not: '' } },
        ],
      }
    : {
        OR: [{ [field]: { isSet: false } }, { [field]: null }, { [field]: '' }],
      }) as W;

/** Campo numérico presente (`true`) ou ausente (`false`). */
export const numberIs = <W>(field: string, present: boolean): W =>
  (present
    ? { AND: [{ [field]: { isSet: true } }, { [field]: { not: null } }] }
    : { OR: [{ [field]: { isSet: false } }, { [field]: null }] }) as W;
