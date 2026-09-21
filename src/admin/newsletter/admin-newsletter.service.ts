import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { NewsletterDispatchService } from './newsletter-dispatch.service';
import { toCsv } from '../../common/utils/csv.util';
import { toJsonInput } from '../../common/utils/json.util';
import { audienceWhere, readSegments } from './newsletter-audience';
import { deliveryRate } from './newsletter-rates';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  ListSubscribersQueryDto,
  RemoveSubscriberQueryDto,
  SendTestCampaignDto,
  UpdateCampaignDto,
  UpdateSubscriberDto,
} from './dto/admin-newsletter.dto';

const MAX_EXPORT_ROWS = 20_000;

/** Estados a partir dos quais ainda dá para editar ou disparar a campanha. */
const EDITABLE_STATUSES: CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.SCHEDULED,
];

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  subject: true,
  status: true,
  templateId: true,
  customHtmlContent: true,
  customTextContent: true,
  targetAll: true,
  targetSegments: true,
  targetSubscriberIds: true,
  senderName: true,
  senderEmail: true,
  replyToEmail: true,
  scheduledAt: true,
  sentAt: true,
  testEmailSent: true,
  totalSubscribers: true,
  emailsSent: true,
  emailsDelivered: true,
  emailsOpened: true,
  emailsClicked: true,
  emailsBounced: true,
  createdAt: true,
} as const;

const SUBSCRIBER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  frequency: true,
  language: true,
  interests: true,
  experienceLevel: true,
  favoriteInstruments: true,
  emailOpenCount: true,
  emailClickCount: true,
  avgEngagementScore: true,
  lastEmailOpenedAt: true,
  subscribedAt: true,
  unsubscribedAt: true,
} as const;

@Injectable()
export class AdminNewsletterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly dispatch: NewsletterDispatchService,
  ) {}

  // -------------------------------------------------------------------
  // Campanhas
  // -------------------------------------------------------------------

  async listCampaigns(query: ListCampaignsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.NewsletterCampaignWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: escapeRegex(search), mode: 'insensitive' } },
              {
                subject: { contains: escapeRegex(search), mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };

    const [campaigns, total] = await Promise.all([
      this.prisma.newsletterCampaign.findMany({
        where,
        select: CAMPAIGN_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.newsletterCampaign.count({ where }),
    ]);

    return {
      campaigns: campaigns.map((campaign) => this.toCampaignView(campaign)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findCampaign(campaignId: string) {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
      select: CAMPAIGN_SELECT,
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    return {
      ...this.toCampaignView(campaign),
      audienceSize: await this.audienceSize(campaign),
    };
  }

  /**
   * Quantos assinantes a campanha alcançaria agora.
   *
   * É uma contagem, não uma listagem: o legado carregava **todos** os
   * assinantes segmentados para depois usar `subscribers.length`.
   */
  async audienceSize(campaign: {
    targetAll: boolean;
    targetSubscriberIds: string[];
    targetSegments: unknown;
  }): Promise<number> {
    return this.prisma.newsletterSubscriber.count({
      where: audienceWhere(campaign),
    });
  }

  async createCampaign(dto: CreateCampaignDto) {
    this.assertContent(dto);
    this.assertSchedule(dto.scheduledAt);

    const campaign = await this.prisma.newsletterCampaign.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        templateId: dto.templateId,
        customHtmlContent: dto.customHtmlContent,
        customTextContent: dto.customTextContent,
        targetAll: dto.targetAll ?? false,
        targetSegments: toJsonInput(
          dto.targetSegments as Record<string, unknown> | undefined,
        ),
        targetSubscriberIds: dto.targetSubscriberIds ?? [],
        senderName: dto.senderName,
        replyToEmail: dto.replyToEmail,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt
          ? CampaignStatus.SCHEDULED
          : CampaignStatus.DRAFT,
      },
      select: CAMPAIGN_SELECT,
    });

    return this.toCampaignView(campaign);
  }

  async updateCampaign(campaignId: string, dto: UpdateCampaignDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const current = await this.requireEditable(campaignId);

    this.assertSchedule(dto.scheduledAt ?? undefined);

    const campaign = await this.prisma.newsletterCampaign.update({
      where: { id: current.id },
      data: {
        name: dto.name,
        subject: dto.subject,
        templateId: dto.templateId,
        customHtmlContent: dto.customHtmlContent,
        customTextContent: dto.customTextContent,
        targetAll: dto.targetAll,
        targetSegments:
          dto.targetSegments === undefined
            ? undefined
            : toJsonInput(dto.targetSegments as Record<string, unknown>),
        targetSubscriberIds: dto.targetSubscriberIds,
        senderName: dto.senderName,
        replyToEmail: dto.replyToEmail,
        scheduledAt:
          dto.scheduledAt === undefined
            ? undefined
            : dto.scheduledAt === null
              ? null
              : new Date(dto.scheduledAt),
      },
      select: CAMPAIGN_SELECT,
    });

    return this.toCampaignView(campaign);
  }

  /**
   * Enfileira a campanha para envio.
   *
   * **Responde 202 e devolve o tamanho do público; não envia nada em linha.**
   * O legado dava `await startCampaignSending(id)` dentro da requisição, com
   * lotes de 50 e dois segundos de espera entre eles: dez mil assinantes são
   * mais de seis minutos com a conexão HTTP aberta. Na prática a requisição
   * estourava o tempo limite enquanto o envio continuava — ou o processo era
   * derrubado no meio, deixando parte da base sem receber e a campanha travada
   * em `SENDING`.
   *
   * **A fila existe desde a Etapa 1.6**, e é ela que envia. Aqui a campanha é
   * validada, o público é medido, o estado passa a `SENDING` — que é o que
   * impede um segundo disparo — e o job entra na fila. O id devolvido é
   * consultável em `GET /admin/jobs/newsletter/:jobId`.
   *
   * A ordem importa: `SENDING` é gravado **antes** de enfileirar. Se o Redis
   * estiver fora, a campanha fica travada em `SENDING` sem ter enviado nada, o
   * que é visível e corrigível. O inverso — enfileirar e falhar ao gravar —
   * deixaria um job disparando uma campanha que o painel ainda mostra como
   * rascunho.
   */
  async queueCampaign(campaignId: string, requestedBy: string | null = null) {
    const campaign = await this.requireEditable(campaignId);

    if (!campaign.templateId && !campaign.customHtmlContent) {
      throw new BadRequestException(
        'A campanha não tem template nem conteúdo próprio para enviar',
      );
    }

    const audienceSize = await this.audienceSize(campaign);

    if (audienceSize === 0) {
      throw new BadRequestException(
        'Nenhum assinante ativo corresponde à segmentação desta campanha',
      );
    }

    const updated = await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: {
        status: CampaignStatus.SENDING,
        totalSubscribers: audienceSize,
        sentAt: new Date(),
      },
      select: CAMPAIGN_SELECT,
    });

    const job = await this.dispatch.enqueuePlan(campaignId, requestedBy);

    return {
      campaign: this.toCampaignView(updated),
      audienceSize,
      queued: true,
      job,
    };
  }

  /**
   * Envia uma prévia para um endereço.
   *
   * Um destinatário só, informado na chamada — sem tocar na base de assinantes.
   */
  async sendTest(campaignId: string, dto: SendTestCampaignDto) {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        subject: true,
        customHtmlContent: true,
        customTextContent: true,
        template: { select: { htmlContent: true, textContent: true } },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    const html = campaign.customHtmlContent ?? campaign.template?.htmlContent;

    if (!html) {
      throw new BadRequestException(
        'A campanha não tem template nem conteúdo próprio para enviar',
      );
    }

    await this.mail.send({
      to: dto.to,
      subject: `[TESTE] ${campaign.subject}`,
      html,
      text: campaign.customTextContent ?? campaign.template?.textContent ?? '',
    });

    await this.prisma.newsletterCampaign.update({
      where: { id: campaignId },
      data: { testEmailSent: true },
    });

    return { sentTo: dto.to };
  }

  /** Cancela uma campanha ainda não disparada. */
  async cancelCampaign(campaignId: string) {
    const campaign = await this.requireEditable(campaignId);

    return this.prisma.newsletterCampaign.update({
      where: { id: campaign.id },
      data: { status: CampaignStatus.CANCELLED },
      select: CAMPAIGN_SELECT,
    });
  }

  /**
   * Remove uma campanha.
   *
   * Só o que nunca saiu. Campanha enviada é registro do que a base recebeu, e
   * apagá-la desfaz a única prova de qual conteúdo chegou a quem.
   */
  async deleteCampaign(campaignId: string): Promise<void> {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, emailsSent: true },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (
      !EDITABLE_STATUSES.includes(campaign.status) ||
      campaign.emailsSent > 0
    ) {
      throw new ConflictException(
        'Campanha já enviada não pode ser removida — é o registro do que a base recebeu. Cancele ou arquive.',
      );
    }

    await this.prisma.newsletterCampaign.delete({ where: { id: campaignId } });
  }

  // -------------------------------------------------------------------
  // Assinantes
  // -------------------------------------------------------------------

  async listSubscribers(query: ListSubscribersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.subscriberWhere(query);

    const [subscribers, total] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({
        where,
        select: SUBSCRIBER_SELECT,
        orderBy: {
          [query.sortBy ?? 'subscribedAt']: query.sortOrder ?? 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.newsletterSubscriber.count({ where }),
    ]);

    return {
      subscribers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async exportSubscribers(query: ListSubscribersQueryDto) {
    const subscribers = await this.prisma.newsletterSubscriber.findMany({
      where: this.subscriberWhere(query),
      select: SUBSCRIBER_SELECT,
      orderBy: {
        [query.sortBy ?? 'subscribedAt']: query.sortOrder ?? 'desc',
      },
      take: MAX_EXPORT_ROWS,
    });

    if (query.format === 'json') {
      return {
        subscribers,
        count: subscribers.length,
        truncated: subscribers.length >= MAX_EXPORT_ROWS,
        exportedAt: new Date(),
      };
    }

    const csv = toCsv(
      [
        'E-mail',
        'Nome',
        'Sobrenome',
        'Situação',
        'Frequência',
        'Aberturas',
        'Cliques',
        'Inscrição',
        'Cancelamento',
      ],
      subscribers.map((subscriber) => [
        subscriber.email,
        subscriber.firstName,
        subscriber.lastName,
        subscriber.status,
        subscriber.frequency,
        subscriber.emailOpenCount,
        subscriber.emailClickCount,
        subscriber.subscribedAt,
        subscriber.unsubscribedAt,
      ]),
    );

    return { csv, count: subscribers.length };
  }

  async updateSubscriber(subscriberId: string, dto: UpdateSubscriberDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const current = await this.prisma.newsletterSubscriber.findUnique({
      where: { id: subscriberId },
      select: { id: true, status: true },
    });

    if (!current) {
      throw new NotFoundException('Assinante não encontrado');
    }

    const unsubscribing =
      dto.status === SubscriptionStatus.UNSUBSCRIBED &&
      current.status !== SubscriptionStatus.UNSUBSCRIBED;

    return this.prisma.newsletterSubscriber.update({
      where: { id: subscriberId },
      data: {
        status: dto.status,
        firstName: dto.firstName,
        lastName: dto.lastName,
        frequency: dto.frequency,
        interests: dto.interests,
        experienceLevel: dto.experienceLevel,
        // A data do cancelamento acompanha a mudança de situação, em vez de
        // depender de quem chama lembrar de mandá-la.
        ...(unsubscribing ? { unsubscribedAt: new Date() } : {}),
      },
      select: SUBSCRIBER_SELECT,
    });
  }

  /**
   * Descadastra um assinante.
   *
   * **O padrão é marcar, não apagar.** O legado sempre apagava o registro — e
   * apagar quem cancelou destrói a prova do opt-out: numa importação seguinte a
   * mesma pessoa volta para a base e recebe e-mail de novo. A remoção definitiva
   * continua disponível para pedido de exclusão de dados, mas passa a ser
   * escolha explícita.
   */
  async removeSubscriber(
    subscriberId: string,
    query: RemoveSubscriberQueryDto,
  ): Promise<{ removed: boolean }> {
    const subscriber = await this.prisma.newsletterSubscriber.findUnique({
      where: { id: subscriberId },
      select: { id: true },
    });

    if (!subscriber) {
      throw new NotFoundException('Assinante não encontrado');
    }

    if (query.hardDelete) {
      await this.prisma.newsletterSubscriber.delete({
        where: { id: subscriberId },
      });

      return { removed: true };
    }

    await this.prisma.newsletterSubscriber.update({
      where: { id: subscriberId },
      data: {
        status: SubscriptionStatus.UNSUBSCRIBED,
        unsubscribedAt: new Date(),
      },
    });

    return { removed: false };
  }

  // -------------------------------------------------------------------
  // Números
  // -------------------------------------------------------------------

  async stats() {
    const [byStatus, campaigns, engagement] = await Promise.all([
      this.prisma.newsletterSubscriber.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.newsletterCampaign.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.newsletterCampaign.aggregate({
        _sum: {
          emailsSent: true,
          emailsDelivered: true,
          emailsOpened: true,
          emailsClicked: true,
          emailsBounced: true,
        },
      }),
    ]);

    const sent = engagement._sum.emailsSent ?? 0;
    const delivered = engagement._sum.emailsDelivered ?? 0;
    const bounced = engagement._sum.emailsBounced ?? 0;
    const opened = engagement._sum.emailsOpened ?? 0;
    const clicked = engagement._sum.emailsClicked ?? 0;

    return {
      subscribersByStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ),
      campaignsByStatus: Object.fromEntries(
        campaigns.map((row) => [row.status, row._count._all]),
      ),
      emails: {
        sent,
        delivered,
        opened,
        clicked,
        bounced,
        // Taxas nulas sem base: nunca ter enviado não é 0% de abertura.
        deliveryRate: deliveryRate(delivered, sent, bounced),
        openRate: this.rate(opened, delivered),
        clickRate: this.rate(clicked, opened),
      },
    };
  }

  // -------------------------------------------------------------------

  private rate(part: number, total: number): number | null {
    return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
  }

  private subscriberWhere(
    query: ListSubscribersQueryDto,
  ): Prisma.NewsletterSubscriberWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: escapeRegex(search), mode: 'insensitive' } },
              {
                firstName: {
                  contains: escapeRegex(search),
                  mode: 'insensitive',
                },
              },
              {
                lastName: {
                  contains: escapeRegex(search),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };
  }

  private toCampaignView<T extends { targetSegments: unknown }>(campaign: T) {
    return {
      ...campaign,
      targetSegments: readSegments(campaign.targetSegments),
    };
  }

  private async requireEditable(campaignId: string) {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        templateId: true,
        customHtmlContent: true,
        targetAll: true,
        targetSegments: true,
        targetSubscriberIds: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    if (!EDITABLE_STATUSES.includes(campaign.status)) {
      throw new ConflictException(
        `Campanha em "${campaign.status}" não pode mais ser alterada ou disparada`,
      );
    }

    return campaign;
  }

  /**
   * Conteúdo próprio exige versão em texto.
   *
   * E-mail em HTML sem alternativa em texto é sinal clássico de spam para os
   * filtros dos provedores. O legado não conferia.
   */
  private assertContent(dto: CreateCampaignDto): void {
    if (!dto.templateId && !dto.customHtmlContent) {
      throw new BadRequestException(
        'Informe um template ou o conteúdo próprio da campanha',
      );
    }

    if (dto.customHtmlContent && !dto.customTextContent) {
      throw new BadRequestException(
        'Conteúdo próprio precisa de uma versão em texto (`customTextContent`)',
      );
    }
  }

  private assertSchedule(scheduledAt?: string): void {
    if (!scheduledAt) {
      return;
    }

    if (new Date(scheduledAt).getTime() <= Date.now()) {
      throw new BadRequestException('O agendamento precisa estar no futuro');
    }
  }
}
