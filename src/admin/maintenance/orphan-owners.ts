import { PrismaService } from '../../prisma/prisma.service';

/**
 * Entidades donas de arquivo.
 *
 * Espelha o `entityTypeFor` de `UploadsService`. É lista fechada de
 * propósito: um `entityType` novo sem par no `switch` seria um arquivo cuja
 * orfandade ninguém consegue verificar — e o silêncio pareceria "não há
 * órfãos". Usada pela varredura agendada e pela tela de arquivos órfãos.
 */
export const OWNER_TYPES = [
  'user',
  'composer',
  'work',
  'workScore',
  'assignment',
  'blogArticle',
  'blogCategory',
  'advertisement',
] as const;

export type OwnerType = (typeof OWNER_TYPES)[number];

export const isOwnerType = (value: string): value is OwnerType =>
  (OWNER_TYPES as readonly string[]).includes(value);

const toSet = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));

/** Ids que ainda existem, por tipo de dono. `switch` fechado, sem model dinâmico. */
export async function idsQueExistem(
  prisma: PrismaService,
  ownerType: OwnerType,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }

  const where = { id: { in: ids } };
  const select = { id: true };

  switch (ownerType) {
    case 'user':
      return toSet(await prisma.user.findMany({ where, select }));
    case 'composer':
      return toSet(await prisma.composer.findMany({ where, select }));
    case 'work':
      return toSet(await prisma.work.findMany({ where, select }));
    case 'workScore':
      return toSet(await prisma.workScore.findMany({ where, select }));
    case 'assignment':
      return toSet(await prisma.assignment.findMany({ where, select }));
    case 'blogArticle':
      return toSet(await prisma.blogArticle.findMany({ where, select }));
    case 'blogCategory':
      return toSet(await prisma.blogCategory.findMany({ where, select }));
    case 'advertisement':
      return toSet(await prisma.advertisement.findMany({ where, select }));
  }
}
