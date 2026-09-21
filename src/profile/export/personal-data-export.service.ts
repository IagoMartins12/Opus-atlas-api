import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EXPORT_FORMAT_VERSION } from './personal-data-scope';

/**
 * Teto por seção.
 *
 * Nenhum usuário tem 50 mil favoritos, mas um arquivo de exportação sem teto é
 * um caminho para derrubar a própria API pedindo a exportação de uma conta
 * artificialmente inflada. Quando o teto é atingido, a resposta **diz** que
 * está truncada — a alternativa, cortar em silêncio, entregaria um arquivo
 * incompleto que se apresenta como completo.
 */
const MAX_PER_SECTION = 50_000;

export interface PersonalDataExport {
  formatVersion: string;
  generatedAt: Date;
  subject: { userId: string; email: string };
  sections: Record<string, unknown>;
  /** Seções que bateram no teto — o arquivo não está completo nelas. */
  truncatedSections: string[];
  /** O que ficou de fora por decisão, e por quê. */
  excluded: { what: string; why: string }[];
}

/**
 * Exportação de dados pessoais (**RN-2** — LGPD, Art. 18, V).
 *
 * O documento é montado por seções, cada uma com um recorte explícito de
 * campos. Não há varredura genérica do schema aqui de propósito: um model novo
 * deve entrar na exportação por decisão de quem o criou, não por acidente de
 * ele ter uma coluna chamada `userId`. O caminho contrário — exportar tudo que
 * casa com um padrão — é como um campo de credencial acaba num arquivo que a
 * pessoa manda por e-mail.
 */
@Injectable()
export class PersonalDataExportService {
  private readonly logger = new Logger(PersonalDataExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(userId: string): Promise<PersonalDataExport> {
    const startedAt = Date.now();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        bio: true,
        image: true,
        city: true,
        state: true,
        country: true,
        phone: true,
        phoneCountryCode: true,
        phoneNumber: true,
        experienceLevel: true,
        practiceTimePerWeek: true,
        profilePublic: true,
        showLocation: true,
        userType: true,
        currentPlan: true,
        planExpiresAt: true,
        totalXP: true,
        totalUploads: true,
        uploadScore: true,
        isTeacher: true,
        isStudent: true,
        emailVerified: true,
        onboardingCompleted: true,
        createdAt: true,
        updatedAt: true,
        lastSeen: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Conta não encontrada');
    }

    const truncated: string[] = [];

    const take = <T>(section: string, rows: T[]): T[] => {
      if (rows.length >= MAX_PER_SECTION) {
        truncated.push(section);
      }
      return rows;
    };

    const [teacher, student] = await Promise.all([
      this.prisma.teacher.findUnique({
        where: { userId },
        select: { id: true, bio: true, createdAt: true },
      }),
      this.prisma.student.findUnique({
        where: { userId },
        select: { id: true, createdAt: true },
      }),
    ]);

    const [
      instruments,
      privateAnnotations,
      publicAnnotations,
      favoriteWorks,
      favoriteComposers,
      favoriteScores,
      wantToLearn,
      learned,
      composers,
      works,
      scores,
      uploadHistory,
      achievements,
      achievementProgress,
      notifications,
      schoolActivities,
      newsletter,
      subscriptions,
      payments,
      assets,
      blogComments,
    ] = await Promise.all([
      this.prisma.userInstrument.findMany({
        where: { userId },
        select: { instrumentId: true, level: true, isPrimary: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.annotation.findMany({
        where: { userId },
        select: { id: true, workId: true, content: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.workAnnotation.findMany({
        where: { userId },
        select: {
          id: true,
          workId: true,
          title: true,
          content: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      }),
      this.prisma.favoriteWork.findMany({
        where: { userId },
        select: { workId: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.favoriteComposer.findMany({
        where: { userId },
        select: { composerId: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.favoriteScore.findMany({
        where: { userId },
        select: { scoreId: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.wantToLearn.findMany({
        where: { userId },
        select: { workId: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.learned.findMany({
        where: { userId },
        select: { workId: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.composer.findMany({
        where: { createdBy: userId },
        select: { id: true, name: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.work.findMany({
        where: { createdBy: userId },
        select: { id: true, title: true, composerId: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.workScore.findMany({
        where: { uploadedBy: userId },
        select: { id: true, workId: true, title: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.uploadHistory.findMany({
        where: { userId },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      }),
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { badgeId: true, unlockedAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.achievementProgress.findMany({
        where: { userId },
        select: {
          badgeId: true,
          currentValue: true,
          lastProgressUpdate: true,
        },
        take: MAX_PER_SECTION,
      }),
      this.prisma.notification.findMany({
        where: { userId },
        select: {
          type: true,
          title: true,
          message: true,
          status: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      }),
      this.prisma.schoolActivity.findMany({
        where: { userId },
        select: { action: true, description: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
      this.prisma.newsletterSubscriber.findUnique({
        where: { userId },
        select: {
          email: true,
          status: true,
          frequency: true,
          interests: true,
          subscribedAt: true,
          unsubscribedAt: true,
        },
      }),
      this.prisma.subscription.findMany({
        where: { userId },
        select: {
          planType: true,
          status: true,
          billingPeriod: true,
          startDate: true,
          endDate: true,
          cancelledAt: true,
        },
        take: MAX_PER_SECTION,
      }),
      // `Payment` não tem `userId`: ele pende da assinatura. Filtrar por
      // `subscription.userId` é o que liga o pagamento à pessoa — e é também o
      // motivo de a exportação não poder ser uma varredura por nome de campo.
      this.prisma.payment.findMany({
        where: { subscription: { userId } },
        select: {
          amount: true,
          finalAmount: true,
          discountAmount: true,
          currency: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      }),
      this.prisma.storedAsset.findMany({
        where: { ownerId: userId },
        select: {
          kind: true,
          secureUrl: true,
          bytes: true,
          status: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      }),
      this.prisma.blogComment.findMany({
        where: { userId },
        select: { id: true, articleId: true, content: true, createdAt: true },
        take: MAX_PER_SECTION,
      }),
    ]);

    const portal = await this.collectPortal(teacher?.id, student?.id);

    const document: PersonalDataExport = {
      formatVersion: EXPORT_FORMAT_VERSION,
      generatedAt: new Date(),
      subject: { userId: user.id, email: user.email ?? '' },
      sections: {
        perfil: user,
        instrumentos: take('instrumentos', instruments),
        anotacoesPrivadas: take('anotacoesPrivadas', privateAnnotations),
        anotacoesPublicas: take('anotacoesPublicas', publicAnnotations),
        obrasFavoritas: take('obrasFavoritas', favoriteWorks),
        compositoresFavoritos: take('compositoresFavoritos', favoriteComposers),
        partiturasFavoritas: take('partiturasFavoritas', favoriteScores),
        queroAprender: take('queroAprender', wantToLearn),
        aprendidas: take('aprendidas', learned),
        compositoresEnviados: take('compositoresEnviados', composers),
        obrasEnviadas: take('obrasEnviadas', works),
        partiturasEnviadas: take('partiturasEnviadas', scores),
        historicoDeEnvios: take('historicoDeEnvios', uploadHistory),
        conquistas: take('conquistas', achievements),
        progressoDeConquistas: take(
          'progressoDeConquistas',
          achievementProgress,
        ),
        notificacoes: take('notificacoes', notifications),
        atividadeEscolar: take('atividadeEscolar', schoolActivities),
        newsletter,
        assinaturas: take('assinaturas', subscriptions),
        pagamentos: take('pagamentos', payments),
        arquivos: take('arquivos', assets),
        comentariosDoBlog: take('comentariosDoBlog', blogComments),
        ...portal,
      },
      truncatedSections: truncated,
      excluded: [
        {
          what: 'Credenciais (tokens de sessão, de OAuth e de uso único, hash de senha)',
          why: 'Portabilidade é levar os seus dados, não as chaves da sua conta. Um arquivo de exportação circula por e-mail e fica em pasta de download.',
        },
        {
          what: 'Trilha de auditoria administrativa e atos de moderação sobre conteúdo de terceiros',
          why: 'Registram o que foi feito com o dado de outra pessoa, não dado pessoal de quem exporta.',
        },
        {
          what: 'Notas privadas do professor sobre a aula (`teacherNotes`), na exportação do aluno',
          why: 'Aula pertence a duas pessoas: o que foi anotado sobre o aluno vai; a avaliação que o professor escreveu para si, não.',
        },
      ],
    };

    this.logger.log(
      `Exportação de dados pessoais de ${userId} montada em ${Date.now() - startedAt}ms` +
        (truncated.length > 0 ? ` (truncada em: ${truncated.join(', ')})` : ''),
    );

    return document;
  }

  /**
   * Aulas e tarefas, resolvidas pelos perfis.
   *
   * `Lesson.teacherId` e `Lesson.studentId` referenciam `Teacher.id` e
   * `Student.id`, não `User.id` — é o mesmo detalhe que fazia a notificação
   * automática do professor não casar com nada. Aqui os perfis são resolvidos
   * antes, e quem não tem perfil simplesmente não recebe a seção.
   */
  private async collectPortal(
    teacherId: string | undefined,
    studentId: string | undefined,
  ): Promise<Record<string, unknown>> {
    const sections: Record<string, unknown> = {};

    if (teacherId) {
      sections.aulasComoProfessor = await this.prisma.lesson.findMany({
        where: { teacherId },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          duration: true,
          status: true,
          // A exportação do professor inclui as próprias notas: elas são dele.
          teacherNotes: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      });
    }

    if (studentId) {
      sections.aulasComoAluno = await this.prisma.lesson.findMany({
        where: { studentId },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          duration: true,
          status: true,
          // `teacherNotes` fica de fora: é avaliação privada do professor.
          studentFeedback: true,
          studentPresent: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      });

      sections.tarefas = await this.prisma.assignment.findMany({
        where: { studentId },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          dueDate: true,
          createdAt: true,
        },
        take: MAX_PER_SECTION,
      });
    }

    return sections;
  }
}
