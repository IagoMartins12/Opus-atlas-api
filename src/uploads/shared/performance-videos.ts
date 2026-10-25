import { PrismaService } from '../../prisma/prisma.service';

/**
 * How many performance videos count toward the plan: the works in "já
 * aprendi" that have one, which is what the person sees.
 *
 * Not the active files in storage: a file left behind (a work moved to
 * "quero aprender" kept its video's file until 25/10/2026) counted as a
 * video nobody could see or remove, and blocked the next upload. Files
 * without a work are the orphan sweep's (`audit-limits`), not the plan's.
 */
export function countPerformanceVideos(
  prisma: Pick<PrismaService, 'learned'>,
  userId: string,
): Promise<number> {
  return prisma.learned.count({
    where: { userId, videoUrl: { not: null } },
  });
}
