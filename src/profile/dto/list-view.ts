/** How lists render on the site (composers, works, personal pages). */
export const LIST_VIEWS = ['cards', 'list'] as const;
export type ListView = (typeof LIST_VIEWS)[number];
