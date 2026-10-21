import { StudentInviteStatus } from '@prisma/client';
import type { CatalogJobWork } from './job-types';

/**
 * Alinha `Teacher.totalStudents` com os vínculos aceitos e ativos. O contador
 * sobe e desce a cada aceite, saída e encerramento; qualquer caminho que o
 * esqueça (dado antigo, correção à mão) o deixa diferente da realidade, e o
 * painel de usuários mostra esse número. O limite do plano nunca lê o
 * contador — conta os vínculos —, então a divergência não libera nem barra
 * ninguém; só mostra errado.
 */
export const work: CatalogJobWork = async ({ prisma, apply, logger }) => {
  const [teachers, links] = await Promise.all([
    prisma.teacher.findMany({ select: { id: true, totalStudents: true } }),
    prisma.teacherStudent.groupBy({
      by: ['teacherId'],
      where: { isActive: true, inviteStatus: StudentInviteStatus.ACCEPTED },
      _count: { _all: true },
    }),
  ]);
  const real = new Map(links.map((l) => [l.teacherId, l._count._all]));
  const wrong = teachers.filter(
    (t) => (t.totalStudents ?? 0) !== (real.get(t.id) ?? 0),
  );
  logger.log(
    `${teachers.length} professor(es); ${wrong.length} com o contador errado`,
  );
  if (apply)
    for (const t of wrong)
      await prisma.teacher.update({
        where: { id: t.id },
        data: { totalStudents: real.get(t.id) ?? 0 },
      });
  return {
    summary: { professores: teachers.length, corrigidos: wrong.length },
    sample: wrong
      .slice(0, 10)
      .map((t) => `${t.id}: ${t.totalStudents} → ${real.get(t.id) ?? 0}`),
  };
};
