import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PLAN_LABEL } from '../../billing/constants/plan-features.constants';
import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { assertEmailVerified } from './verified-email';

/**
 * O limite de envios ao acervo do plano (`uploadLimit`, RN-1): **compositores,
 * obras e partituras somados**, como a página de planos anuncia ("até 20
 * envios ao acervo").
 *
 * Antes o limite só contava arquivos de partitura (`UploadsService`): cadastrar
 * compositor ou obra não tinha teto em plano nenhum.
 *
 * Conta o que **continua no acervo** e foi criado pela pessoa — apagar um
 * envio devolve a vaga. Downgrade não apaga nada: quem já passou do teto só
 * não cria mais (a mesma regra dos alunos).
 */
@Injectable()
export class ContributionLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Can this person add a composer, work or score? A confirmed e-mail first,
   * then the plan's limit.
   */
  async assertWithinLimit(userId: string): Promise<void> {
    await assertEmailVerified(this.prisma, userId);

    const access = await this.subscriptions.checkFeatureAccess(
      userId,
      'uploadLimit',
    );

    // `-1` é ilimitado; sem número, também.
    if (access.limit === undefined || access.limit < 0) {
      return;
    }

    const used = await this.countContributions(userId);

    if (used >= access.limit) {
      throw new ForbiddenException(
        limitMessage('envios', access.plan, used, access.limit),
      );
    }
  }

  countContributions(userId: string): Promise<number> {
    return Promise.all([
      this.prisma.composer.count({ where: { createdBy: userId } }),
      this.prisma.work.count({ where: { createdBy: userId } }),
      this.prisma.workScore.count({ where: { uploadedBy: userId } }),
    ]).then(([composers, works, scores]) => composers + works + scores);
  }
}

/**
 * A mensagem de teto, igual para envios e vídeos (7.9.15-B): o plano, o
 * número, e o caminho. As telas mostram o texto que vem daqui.
 */
export function limitMessage(
  what: 'envios' | 'videos',
  plan: keyof typeof PLAN_LABEL,
  used: number,
  limit: number,
): string {
  const label =
    what === 'envios'
      ? 'envios ao acervo (compositores, obras e partituras somados)'
      : 'vídeos de performance';
  return (
    `O plano ${PLAN_LABEL[plan]} permite ${limit} ${label}, e você já tem ${used}. ` +
    'Assine o Plus para enviar sem limite, ou apague um envio para liberar a vaga.'
  );
}
