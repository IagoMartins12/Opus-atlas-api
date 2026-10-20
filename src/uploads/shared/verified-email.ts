import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Contributing to the library takes a confirmed e-mail: composers, works,
 * scores and performance videos, like completing a record or telling a
 * curiosity (`ContributionsService`). The e-mail is what lets the team answer
 * the person when a contribution is reported.
 *
 * The same sentence as the other contribution paths, so the site translates
 * it once and the front can recognize it.
 */
export const VERIFY_EMAIL_MESSAGE =
  'Confirme seu e-mail para contribuir com o acervo.';

export async function assertEmailVerified(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });

  if (!user?.emailVerified) {
    throw new ForbiddenException(VERIFY_EMAIL_MESSAGE);
  }
}
