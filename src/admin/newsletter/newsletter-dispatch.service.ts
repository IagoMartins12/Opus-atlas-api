import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignStatus, TokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { UserTokenService } from '../../auth/user-token.service';
import { QueueService } from '../../common/queue/queue.service';
import {
  JOB_NEWSLETTER_BATCH,
  JOB_NEWSLETTER_PLAN,
  QUEUE_NEWSLETTER,
} from '../../common/queue/queue.constants';
import { buildIdempotencyKey } from '../../common/queue/job-contract';
import { audienceWhere } from './newsletter-audience';
import {
  CampaignVariables,
  ensureUnsubscribe,
  KNOWN_VARIABLES,
  render,
  resolveContent,
  unknownVariables,
} from './campaign-content';

/**
 * Destinatários por job de lote.
 *
 * Cinquenta é o mesmo número do legado, mas por outro motivo. Lá o lote era
 * uma pausa artificial dentro da requisição HTTP; aqui é a **unidade de nova
 * tentativa**: se o SMTP recusar no meio, só estes cinquenta voltam para a
 * fila, e o livro-razão garante que os já enviados não saiam de novo.
 */
const BATCH_SIZE = 50;

/**
 * Teto de lotes por campanha (500 mil destinatários).
 *
 * Não é limite de produto, é freio de segurança: uma segmentação escrita
 * errado que case com a base inteira não pode gerar um número indefinido de
 * jobs antes de alguém perceber.
 */
const MAX_BATCHES = 10_000;

const SEND_PENDING = 'pending';
const SEND_SENT = 'sent';
const SEND_FAILED = 'failed';

/** Carga do job de planejamento. */
export interface NewsletterPlanPayload {
  campaignId: string;
}

/** Carga do job de lote — os ids vão no job, não são recalculados. */
export interface NewsletterBatchPayload {
  campaignId: string;
  subscriberIds: string[];
}

export interface PlanResult {
  campaignId: string;
  audienceSize: number;
  batches: number;
  /** De onde saiu o corpo do e-mail: conteúdo próprio ou template do banco. */
  contentSource: 'custom' | 'template';
  /** Variáveis citadas no template que a plataforma não sabe preencher. */
  unknownVariables: string[];
}

export interface BatchResult {
  campaignId: string;
  attempted: number;
  sent: number;
  failed: number;
  /** Já tinham sido enviados numa passagem anterior — reentrega da fila. */
  skipped: number;
}

/**
 * Disparo de campanha de newsletter.
 *
 * Separado de `AdminNewsletterService` porque as duas coisas têm ciclos de
 * vida diferentes: o serviço administrativo atende requisição HTTP e responde
 * em milissegundos; este roda no worker e pode levar meia hora.
 *
 * **Toda a reentrância mora aqui.** A fila garante que o job chegue pelo menos
 * uma vez, o que significa que ele pode chegar duas — o worker morre depois do
 * `SMTP OK` e antes de gravar, e o BullMQ devolve o job. Sem um registro por
 * destinatário, retomar o envio significa mandar tudo de novo para quem já
 * recebeu. O legado não tinha esse registro: o modelo `NewsletterCampaignSend`
 * existe no schema, com `@@unique([campaignId, subscriberId])`, e **nenhuma
 * linha do código legado escrevia nele**. Não havia como saber quem recebeu o
 * quê, nem como retomar coisa alguma.
 */
@Injectable()
export class NewsletterDispatchService {
  private readonly logger = new Logger(NewsletterDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly tokens: UserTokenService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Coloca a campanha na fila.
   *
   * A chave de idempotência é a própria campanha: dois cliques no botão de
   * disparar produzem **um** job, e o segundo recebe o mesmo id de volta.
   */
  async enqueuePlan(campaignId: string, requestedBy: string | null) {
    return this.queue.enqueue({
      queue: QUEUE_NEWSLETTER,
      job: JOB_NEWSLETTER_PLAN,
      idempotencyKey: buildIdempotencyKey('newsletter.plan', campaignId),
      payload: { campaignId },
      requestedBy,
    });
  }

  /**
   * Resolve o público e enfileira os lotes.
   *
   * Pagina por `id` crescente em vez de `skip`/`take`: a base de assinantes
   * muda enquanto a campanha é planejada, e com deslocamento numérico uma
   * inscrição nova no meio da varredura desloca a janela e faz um assinante
   * ser pulado ou lido duas vezes.
   */
  async plan(
    campaignId: string,
    requestedBy: string | null,
  ): Promise<PlanResult> {
    const campaign = await this.loadForSending(campaignId);
    const content = resolveContent(campaign);

    const where = audienceWhere(campaign);

    // O total é gravado **antes** de qualquer lote entrar na fila. É ele que o
    // fechamento usa para saber que acabou; se um lote terminasse enquanto o
    // planejamento ainda enfileira, um total desatualizado fecharia a campanha
    // no meio do envio.
    await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: {
        totalSubscribers: await this.prisma.newsletterSubscriber.count({
          where,
        }),
      },
    });

    let cursor: string | undefined;
    let batches = 0;
    let audienceSize = 0;

    for (;;) {
      const page = await this.prisma.newsletterSubscriber.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (page.length === 0) {
        break;
      }

      if (batches >= MAX_BATCHES) {
        throw new Error(
          `Campanha ${campaignId} passou de ${MAX_BATCHES} lotes — segmentação provavelmente errada`,
        );
      }

      const subscriberIds = page.map((subscriber) => subscriber.id);

      await this.queue.enqueue({
        queue: QUEUE_NEWSLETTER,
        job: JOB_NEWSLETTER_BATCH,
        idempotencyKey: buildIdempotencyKey(
          'newsletter.batch',
          campaignId,
          batches,
        ),
        payload: { campaignId, subscriberIds },
        requestedBy,
      });

      cursor = subscriberIds[subscriberIds.length - 1];
      audienceSize += subscriberIds.length;
      batches += 1;
    }

    // Corrige o total com o que a varredura realmente encontrou — a base muda
    // entre a contagem e o fim do laço. Se ela encolheu e os lotes já
    // terminaram, ninguém mais fecharia a campanha: por isso a verificação de
    // fechamento também roda aqui, e não só ao fim de cada lote.
    await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: { totalSubscribers: audienceSize },
    });

    await this.closeIfFinished(campaignId);

    return {
      campaignId,
      audienceSize,
      batches,
      contentSource: content.source,
      unknownVariables: unknownVariables(
        [content.subject, content.html, content.text],
        KNOWN_VARIABLES,
      ),
    };
  }

  /**
   * Envia um lote.
   *
   * A ordem — reservar, enviar, confirmar — é o que torna a reentrega
   * suportável, e ela tem um custo assumido: se o processo morrer entre o
   * `SMTP OK` e a confirmação, a linha fica em `pending` e o destinatário
   * recebe **duas vezes** na retomada. A alternativa (confirmar antes de
   * enviar) troca isso por não receber nenhuma vez, o que é pior e invisível:
   * ninguém reclama do e-mail que não chegou.
   */
  async sendBatch(
    campaignId: string,
    subscriberIds: string[],
  ): Promise<BatchResult> {
    const campaign = await this.loadForSending(campaignId);

    // Campanha que saiu de `SENDING` não recebe mais lote. Cobre a reentrega
    // tardia: um job que estava preso na fila não pode voltar a disparar
    // e-mails de uma campanha já encerrada.
    if (campaign.status !== CampaignStatus.SENDING) {
      return {
        campaignId,
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: subscriberIds.length,
      };
    }

    const content = resolveContent(campaign);

    const already = await this.prisma.newsletterCampaignSend.findMany({
      where: { campaignId, subscriberId: { in: subscriberIds } },
      select: { subscriberId: true, status: true },
    });

    const finished = new Set(
      already
        .filter((send) => send.status === SEND_SENT)
        .map((send) => send.subscriberId),
    );

    const pendingIds = subscriberIds.filter((id) => !finished.has(id));

    const subscribers = await this.prisma.newsletterSubscriber.findMany({
      where: { id: { in: pendingIds } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        userId: true,
      },
    });

    const unsubscribeUrls = await this.unsubscribeUrls(subscribers);

    let sent = 0;
    let failed = 0;

    for (const subscriber of subscribers) {
      await this.claim(campaignId, subscriber.id);

      const variables: CampaignVariables = {
        firstName: subscriber.firstName ?? 'Assinante',
        lastName: subscriber.lastName ?? '',
        email: subscriber.email,
        unsubscribeUrl: unsubscribeUrls.get(subscriber.id) ?? '',
        siteUrl: this.siteUrl(),
        campaignName: campaign.name,
        year: String(new Date().getFullYear()),
      };

      const body = ensureUnsubscribe(
        render(content.html, variables, 'html'),
        render(content.text, variables, 'text'),
        variables.unsubscribeUrl,
      );

      const result = await this.mail.trySend({
        to: subscriber.email,
        subject: render(content.subject, variables, 'text'),
        html: body.html,
        text: body.text,
        fromName: campaign.senderName,
        replyTo: campaign.replyToEmail ?? undefined,
        // Descadastro em um clique, direto pelo cliente de e-mail. É o que os
        // provedores grandes usam para decidir entre "cancelou a inscrição" e
        // "marcou como spam" — e a segunda leitura afunda a reputação do
        // domínio inteiro.
        headers: variables.unsubscribeUrl
          ? { 'List-Unsubscribe': `<${variables.unsubscribeUrl}>` }
          : undefined,
      });

      if (result.delivered) {
        sent += 1;
      } else {
        failed += 1;
        this.logger.warn(
          `Envio recusado para ${subscriber.email} na campanha ${campaignId}: ${result.error}`,
        );
      }

      await this.settle(
        campaignId,
        subscriber.id,
        result.delivered,
        result.messageId,
      );
    }

    if (sent > 0) {
      await this.prisma.newsletterCampaign.update({
        where: { id: campaignId },
        // `emailsSent` é o que o SMTP aceitou. `emailsDelivered` continua
        // intocado: entrega de verdade só se sabe por retorno do provedor, e
        // não existe canal de retorno ainda. O legado copiava um no outro e
        // chamava de taxa de entrega.
        data: { emailsSent: { increment: sent } },
      });
    }

    await this.closeIfFinished(campaignId);

    return {
      campaignId,
      attempted: subscribers.length,
      sent,
      failed,
      skipped: subscriberIds.length - subscribers.length,
    };
  }

  // -------------------------------------------------------------------

  /** Marca a tentativa antes de enviar. */
  private async claim(campaignId: string, subscriberId: string): Promise<void> {
    await this.prisma.newsletterCampaignSend.upsert({
      where: { campaignId_subscriberId: { campaignId, subscriberId } },
      create: { campaignId, subscriberId, status: SEND_PENDING },
      update: { status: SEND_PENDING },
    });
  }

  /**
   * Fecha a tentativa.
   *
   * Não grava `NewsletterEmailEvent` de tipo `SENT`: o livro-razão já é esse
   * registro, com `sentAt` e destinatário. `NewsletterEmailEvent` guarda o que
   * vem **de fora** — abertura, clique, bounce, denúncia de spam — e duplicar
   * o envio ali dobraria a escrita para não responder nenhuma pergunta nova.
   */
  private async settle(
    campaignId: string,
    subscriberId: string,
    delivered: boolean,
    messageId?: string,
  ): Promise<void> {
    await this.prisma.newsletterCampaignSend.update({
      where: { campaignId_subscriberId: { campaignId, subscriberId } },
      data: {
        status: delivered ? SEND_SENT : SEND_FAILED,
        sentAt: delivered ? new Date() : null,
        // **É por aqui que o webbook do provedor volta a encontrar a campanha.**
        // O campo existia no schema e nunca era escrito: um evento de entrega
        // ou de retorno chegaria com o id da mensagem e não teria par.
        emailId: messageId ?? null,
      },
    });
  }

  /**
   * Fecha a campanha quando não sobra ninguém.
   *
   * A verificação é a mesma em todo lote, e o último a rodar é quem fecha. Se
   * dois lotes terminarem juntos, os dois escrevem o mesmo estado — a operação
   * é idempotente de propósito, porque coordenar isso valeria menos do que
   * custa.
   */
  private async closeIfFinished(campaignId: string): Promise<void> {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
      select: { totalSubscribers: true, status: true },
    });

    if (!campaign || campaign.status !== CampaignStatus.SENDING) {
      return;
    }

    const settled = await this.prisma.newsletterCampaignSend.count({
      where: { campaignId, status: { in: [SEND_SENT, SEND_FAILED] } },
    });

    if (settled < campaign.totalSubscribers) {
      return;
    }

    await this.close(campaignId);
  }

  /**
   * Estado final da campanha.
   *
   * `FAILED` só quando **nada** saiu. O legado marcava a campanha inteira como
   * falha se um único endereço fosse recusado — um assinante com caixa cheia
   * bastava para a campanha que chegou a nove mil pessoas aparecer no painel
   * como fracasso.
   */
  private async close(campaignId: string): Promise<void> {
    const sent = await this.prisma.newsletterCampaignSend.count({
      where: { campaignId, status: SEND_SENT },
    });

    await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: {
        status: sent > 0 ? CampaignStatus.SENT : CampaignStatus.FAILED,
      },
    });
  }

  /**
   * Link de descadastro por assinante.
   *
   * **Reaproveita o token que já existe.** Emitir um novo a cada campanha
   * invalidaria o link da campanha anterior (o `createToken` revoga os
   * anteriores do mesmo tipo por padrão), quer dizer: o e-mail do mês passado
   * pararia de ter saída no dia em que o do mês seguinte fosse enviado.
   */
  private async unsubscribeUrls(
    subscribers: { id: string; email: string; userId: string | null }[],
  ): Promise<Map<string, string>> {
    const userIds = subscribers
      .map((subscriber) => subscriber.userId)
      .filter((id): id is string => id !== null);

    const emails = subscribers
      .filter((subscriber) => subscriber.userId === null)
      .map((subscriber) => subscriber.email);

    const existing = await this.prisma.userToken.findMany({
      where: {
        type: TokenType.NEWSLETTER_UNSUBSCRIBE,
        used: false,
        expiresAt: { gt: new Date() },
        OR: [{ userId: { in: userIds } }, { anonymousEmail: { in: emails } }],
      },
      select: { token: true, userId: true, anonymousEmail: true },
      orderBy: { createdAt: 'desc' },
    });

    const byUser = new Map<string, string>();
    const byEmail = new Map<string, string>();

    for (const token of existing) {
      if (token.userId && !byUser.has(token.userId)) {
        byUser.set(token.userId, token.token);
      }

      if (token.anonymousEmail && !byEmail.has(token.anonymousEmail)) {
        byEmail.set(token.anonymousEmail, token.token);
      }
    }

    const urls = new Map<string, string>();

    for (const subscriber of subscribers) {
      const found = subscriber.userId
        ? byUser.get(subscriber.userId)
        : byEmail.get(subscriber.email);

      const token =
        found ??
        (await this.tokens.createToken({
          userId: subscriber.userId ?? undefined,
          anonymousEmail: subscriber.userId ? undefined : subscriber.email,
          type: TokenType.NEWSLETTER_UNSUBSCRIBE,
          // Não revoga o anterior: o link do e-mail antigo continua valendo.
          revokePrevious: false,
        }));

      urls.set(
        subscriber.id,
        `${this.siteUrl()}/newsletter/unsubscribe/${token}`,
      );
    }

    return urls;
  }

  private siteUrl(): string {
    return this.config.get<string>(
      'mediaSearch.frontendBaseUrl',
      'http://localhost:3000',
    );
  }

  private async loadForSending(campaignId: string) {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        status: true,
        subject: true,
        customSubject: true,
        customHtmlContent: true,
        customTextContent: true,
        senderName: true,
        replyToEmail: true,
        targetAll: true,
        targetSegments: true,
        targetSubscriberIds: true,
        template: { select: { htmlContent: true, textContent: true } },
      },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha ${campaignId} não encontrada`);
    }

    return campaign;
  }
}
