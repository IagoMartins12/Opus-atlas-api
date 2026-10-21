import {
  StorageAssetKind,
  StorageAssetStatus,
  StudentInviteStatus,
} from '@prisma/client';
import { PLAN_FEATURES } from '../../billing/constants/plan-features.constants';
import { chunks, type CatalogJobWork } from './job-types';

/**
 * Auditoria de limites e contagens (só leitura — "Gravar" não muda nada).
 *
 * Confere, no banco, se os números que o produto promete e aplica batem entre
 * si: o que a pessoa vê em "quero aprender" e "já aprendi", os vídeos de
 * performance contra o teto do plano, os envios ao acervo contra o teto, os
 * alunos do professor contra o plano (Mentor: 7) e o plano guardado no usuário
 * contra a assinatura que vale. Cada divergência vira um aviso com exemplo.
 */
export const work: CatalogJobWork = async ({ prisma, logger, progress }) => {
  const summary: Record<string, number> = {};
  const warnings: string[] = [];
  const sample: string[] = [];
  const flag = (key: string, n: number, text: string, example?: string) => {
    summary[key] = n;
    if (n > 0) {
      warnings.push(`${text}: ${n}`);
      if (example && sample.length < 40) sample.push(`${text} — ${example}`);
    }
  };

  // --- Quero aprender / Já aprendi ------------------------------------
  progress(1, 6, 'Quero aprender e já aprendi');
  const want = await prisma.wantToLearn.findMany({
    select: { userId: true, workId: true },
  });
  const learned = await prisma.learned.findMany({
    select: { userId: true, workId: true, videoUrl: true },
  });
  const key = (x: { userId: string; workId: string }) =>
    `${x.userId}:${x.workId}`;

  const seen = new Set<string>();
  let dupWant = 0;
  let dupWantExample: string | undefined;
  for (const x of want) {
    if (seen.has(key(x))) {
      dupWant++;
      dupWantExample ??= key(x);
    }
    seen.add(key(x));
  }
  const seenLearned = new Set<string>();
  let dupLearned = 0;
  let dupLearnedExample: string | undefined;
  for (const x of learned) {
    if (seenLearned.has(key(x))) {
      dupLearned++;
      dupLearnedExample ??= key(x);
    }
    seenLearned.add(key(x));
  }
  const both = [...seen].filter((k) => seenLearned.has(k));

  const workIds = [...new Set([...want, ...learned].map((x) => x.workId))];
  const existing = new Set<string>();
  for (const part of chunks(workIds, 1000)) {
    (
      await prisma.work.findMany({
        where: { id: { in: part } },
        select: { id: true },
      })
    ).forEach((w) => existing.add(w.id));
  }
  const orphanWant = want.filter((x) => !existing.has(x.workId));
  const orphanLearned = learned.filter((x) => !existing.has(x.workId));

  summary.quero_aprender = want.length;
  summary.ja_aprendi = learned.length;
  flag(
    'quero_aprender_duplicados',
    dupWant,
    'Obra repetida em "quero aprender" para a mesma pessoa',
    dupWantExample,
  );
  flag(
    'ja_aprendi_duplicados',
    dupLearned,
    'Obra repetida em "já aprendi" para a mesma pessoa',
    dupLearnedExample,
  );
  flag(
    'nas_duas_listas',
    both.length,
    'Mesma obra nas duas listas (as listas são exclusivas)',
    both[0],
  );
  flag(
    'quero_aprender_sem_obra',
    orphanWant.length,
    'Item de "quero aprender" cuja obra não existe mais',
    orphanWant[0] && key(orphanWant[0]),
  );
  flag(
    'ja_aprendi_sem_obra',
    orphanLearned.length,
    'Item de "já aprendi" cuja obra não existe mais',
    orphanLearned[0] && key(orphanLearned[0]),
  );

  // --- Vídeos de performance ------------------------------------------
  progress(2, 6, 'Vídeos de performance');
  const assets = await prisma.storedAsset.groupBy({
    by: ['ownerId'],
    where: {
      kind: StorageAssetKind.PERFORMANCE_VIDEO,
      status: StorageAssetStatus.ACTIVE,
    },
    _count: { _all: true },
  });
  const videoAssets = new Map(
    assets
      .filter((a) => a.ownerId)
      .map((a) => [a.ownerId as string, a._count._all]),
  );
  const videoItems = new Map<string, number>();
  for (const l of learned)
    if (l.videoUrl)
      videoItems.set(l.userId, (videoItems.get(l.userId) ?? 0) + 1);

  const users = await prisma.user.findMany({
    select: { id: true, email: true, currentPlan: true },
  });
  const planOf = new Map(users.map((u) => [u.id, u.currentPlan ?? 'FREE']));
  const emailOf = new Map(users.map((u) => [u.id, u.email]));

  let overVideos = 0;
  let overVideosExample: string | undefined;
  for (const [owner, n] of videoAssets) {
    const limit =
      PLAN_FEATURES[planOf.get(owner) ?? 'FREE'].maxPerformanceVideos;
    if (limit >= 0 && n > limit) {
      overVideos++;
      overVideosExample ??= `${emailOf.get(owner)} tem ${n} de ${limit}`;
    }
  }
  let mismatch = 0;
  let mismatchExample: string | undefined;
  for (const owner of new Set([...videoAssets.keys(), ...videoItems.keys()])) {
    const a = videoAssets.get(owner) ?? 0;
    const i = videoItems.get(owner) ?? 0;
    if (a !== i) {
      mismatch++;
      mismatchExample ??= `${emailOf.get(owner)}: ${a} arquivo(s) no armazenamento, ${i} em "já aprendi"`;
    }
  }
  summary.videos_arquivos = [...videoAssets.values()].reduce(
    (a, b) => a + b,
    0,
  );
  summary.videos_em_ja_aprendi = [...videoItems.values()].reduce(
    (a, b) => a + b,
    0,
  );
  flag(
    'videos_acima_do_plano',
    overVideos,
    'Pessoas com mais vídeos de performance que o plano permite',
    overVideosExample,
  );
  flag(
    'videos_contagem_diverge',
    mismatch,
    'Pessoas em que arquivos de vídeo e itens com vídeo não batem (legado no disco do servidor ou arquivo sem item)',
    mismatchExample,
  );

  // --- Envios ao acervo -----------------------------------------------
  progress(3, 6, 'Envios ao acervo');
  const [byComposer, byWork, byScore, scoreFiles] = await Promise.all([
    prisma.composer.groupBy({
      by: ['createdBy'],
      where: { createdBy: { not: null } },
      _count: { _all: true },
    }),
    prisma.work.groupBy({
      by: ['createdBy'],
      where: { createdBy: { not: null } },
      _count: { _all: true },
    }),
    prisma.workScore.groupBy({
      by: ['uploadedBy'],
      where: { uploadedBy: { not: null } },
      _count: { _all: true },
    }),
    prisma.storedAsset.groupBy({
      by: ['ownerId'],
      where: {
        kind: StorageAssetKind.SCORE_FILE,
        status: StorageAssetStatus.ACTIVE,
      },
      _count: { _all: true },
    }),
  ]);
  const sent = new Map<string, number>();
  const add = (id: string | null, n: number) =>
    id && sent.set(id, (sent.get(id) ?? 0) + n);
  byComposer.forEach((x) => add(x.createdBy, x._count._all));
  byWork.forEach((x) => add(x.createdBy, x._count._all));
  byScore.forEach((x) => add(x.uploadedBy, x._count._all));

  let overSent = 0;
  let overSentExample: string | undefined;
  for (const [owner, n] of sent) {
    const limit = PLAN_FEATURES[planOf.get(owner) ?? 'FREE'].uploadLimit;
    if (limit >= 0 && n > limit) {
      overSent++;
      overSentExample ??= `${emailOf.get(owner)} tem ${n} de ${limit}`;
    }
  }
  let ruleSplit = 0;
  let ruleSplitExample: string | undefined;
  for (const f of scoreFiles) {
    if (!f.ownerId) continue;
    const scores =
      byScore.find((s) => s.uploadedBy === f.ownerId)?._count._all ?? 0;
    if (f._count._all > scores) {
      ruleSplit++;
      ruleSplitExample ??= `${emailOf.get(f.ownerId)}: ${f._count._all} arquivo(s) de partitura, ${scores} partitura(s) registrada(s)`;
    }
  }
  summary.pessoas_com_envios = sent.size;
  flag(
    'envios_acima_do_plano',
    overSent,
    'Pessoas com mais envios ao acervo (compositores + obras + partituras) que o plano permite',
    overSentExample,
  );
  flag(
    'partitura_arquivo_sem_registro',
    ruleSplit,
    'Arquivos de partitura enviados sem partitura registrada (contam num limite e não no outro)',
    ruleSplitExample,
  );

  // --- Alunos do professor --------------------------------------------
  progress(4, 6, 'Alunos dos professores');
  const links = await prisma.teacherStudent.groupBy({
    by: ['teacherId'],
    where: { isActive: true, inviteStatus: StudentInviteStatus.ACCEPTED },
    _count: { _all: true },
  });
  const teachers = await prisma.teacher.findMany({
    select: { id: true, userId: true, totalStudents: true },
  });
  const activeOf = new Map(links.map((l) => [l.teacherId, l._count._all]));
  let overStudents = 0;
  let overStudentsExample: string | undefined;
  let counterDrift = 0;
  let counterDriftExample: string | undefined;
  for (const t of teachers) {
    const n = activeOf.get(t.id) ?? 0;
    const limit = PLAN_FEATURES[planOf.get(t.userId) ?? 'FREE'].maxStudents;
    if (limit >= 0 && n > limit) {
      overStudents++;
      overStudentsExample ??= `${emailOf.get(t.userId)} (${planOf.get(t.userId)}) tem ${n} aluno(s) de ${limit}`;
    }
    if ((t.totalStudents ?? 0) !== n) {
      counterDrift++;
      counterDriftExample ??= `${emailOf.get(t.userId)}: contador ${t.totalStudents}, vínculos ativos ${n}`;
    }
  }
  summary.professores = teachers.length;
  flag(
    'alunos_acima_do_plano',
    overStudents,
    'Professores com mais alunos ativos que o plano permite',
    overStudentsExample,
  );
  flag(
    'contador_de_alunos_diverge',
    counterDrift,
    'Professores em que `totalStudents` não bate com os vínculos ativos e aceitos',
    counterDriftExample,
  );

  // --- Plano guardado no usuário vs assinatura ------------------------
  progress(5, 6, 'Plano do usuário');
  const now = new Date();
  const valid = await prisma.subscription.findMany({
    where: {
      OR: [
        {
          status: { in: ['TRIAL', 'ACTIVE'] },
          AND: [
            {
              OR: [
                { endDate: null },
                { endDate: { isSet: false } },
                { endDate: { gte: now } },
              ],
            },
          ],
        },
        { status: { in: ['CANCELLED', 'PAST_DUE'] }, endDate: { gte: now } },
      ],
    },
    select: { userId: true, planType: true },
    orderBy: { createdAt: 'desc' },
  });
  const shouldBe = new Map<string, string>();
  for (const s of valid)
    if (!shouldBe.has(s.userId)) shouldBe.set(s.userId, s.planType);
  let drift = 0;
  let driftExample: string | undefined;
  for (const u of users) {
    const expected = shouldBe.get(u.id) ?? 'FREE';
    if ((u.currentPlan ?? 'FREE') !== expected) {
      drift++;
      driftExample ??= `${u.email}: usuário diz ${u.currentPlan ?? 'FREE'}, assinatura vale ${expected}`;
    }
  }
  flag(
    'plano_do_usuario_diverge',
    drift,
    'Usuários com o plano em cache diferente da assinatura que vale',
    driftExample,
  );

  progress(6, 6, 'Pronto');
  const total = warnings.length;
  logger.log(
    total
      ? `${total} tipo(s) de divergência encontrados`
      : 'Nenhuma divergência: limites e contagens batem.',
  );
  return { summary, sample, warnings };
};
