import { escapeRegex } from '../../common/utils/regex.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toCsv } from '../../common/utils/csv.util';
import {
  BulkDeleteTemplatesDto,
  CreateTemplateDto,
  CreateTestListDto,
  ListTemplatesQueryDto,
  NewsletterAnalyticsQueryDto,
  UpdateTemplateDto,
  UpdateTestListDto,
} from './dto/admin-templates.dto';
import { analyzeTemplate } from './template-analysis';
import { deliveryRate } from './newsletter-rates';

const DAY_MS = 24 * 60 * 60 * 1000;

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  type: true,
  subject: true,
  variables: true,
  senderName: true,
  senderEmail: true,
  replyToEmail: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const TEST_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  emails: true,
  color: true,
  isActive: true,
  totalEmails: true,
  timesUsed: true,
  lastUsed: true,
  createdAt: true,
} as const;

@Injectable()
export class AdminTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------

  /**
   * Lista os templates.
   *
   * A projeção **não traz `htmlContent` nem `textContent`**: um template pode
   * ter duzentos mil caracteres, e uma página de vinte devolveria megabytes de
   * marcação que a listagem não usa. O conteúdo vem no detalhe.
   */
  async listTemplates(query: ListTemplatesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const where: Prisma.NewsletterTemplateWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
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

    const [templates, total] = await Promise.all([
      this.prisma.newsletterTemplate.findMany({
        where,
        select: TEMPLATE_SELECT,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.newsletterTemplate.count({ where }),
    ]);

    const usage = await this.campaignUsage(
      templates.map((template) => template.id),
    );

    return {
      templates: templates.map((template) => ({
        ...template,
        campaigns: usage.get(template.id) ?? 0,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Quantas campanhas usam cada template, numa agregação só. */
  private async campaignUsage(templateIds: string[]) {
    if (templateIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.prisma.newsletterCampaign.groupBy({
      by: ['templateId'],
      where: { templateId: { in: templateIds } },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter((row): row is typeof row & { templateId: string } =>
          Boolean(row.templateId),
        )
        .map((row) => [row.templateId, row._count._all]),
    );
  }

  async findTemplate(templateId: string) {
    const template = await this.prisma.newsletterTemplate.findUnique({
      where: { id: templateId },
      select: {
        ...TEMPLATE_SELECT,
        htmlContent: true,
        textContent: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Template não encontrado');
    }

    return template;
  }

  async createTemplate(dto: CreateTemplateDto) {
    return this.prisma.newsletterTemplate.create({
      data: {
        name: dto.name,
        type: dto.type,
        subject: dto.subject,
        htmlContent: dto.htmlContent,
        textContent: dto.textContent,
        variables: dto.variables ?? [],
        senderName: dto.senderName,
        replyToEmail: dto.replyToEmail,
        isActive: dto.isActive ?? true,
      },
      select: TEMPLATE_SELECT,
    });
  }

  async updateTemplate(templateId: string, dto: UpdateTemplateDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    await this.findTemplate(templateId);

    return this.prisma.newsletterTemplate.update({
      where: { id: templateId },
      data: {
        name: dto.name,
        type: dto.type,
        subject: dto.subject,
        htmlContent: dto.htmlContent,
        textContent: dto.textContent,
        variables: dto.variables,
        senderName: dto.senderName,
        replyToEmail: dto.replyToEmail,
        isActive: dto.isActive,
      },
      select: TEMPLATE_SELECT,
    });
  }

  /**
   * Remove templates em lote.
   *
   * Três correções sobre o legado:
   *
   * 1. **Ids repetidos não viram "não encontrado".** A verificação era
   *    `encontrados.length !== pedidos.length`, então `['a', 'a']` retornava um
   *    registro para dois ids e a operação falhava com 404.
   * 2. **A verificação de uso conta, não carrega.** Antes vinha
   *    `include: { campaigns: ... }` com todas as campanhas de cada template.
   * 3. **A remoção acontece na mesma transação da verificação**, para não
   *    apagar um template que passou a ser usado no intervalo.
   */
  async bulkDeleteTemplates(dto: BulkDeleteTemplatesDto) {
    const ids = [...new Set(dto.templateIds)];

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.newsletterTemplate.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });

      if (existing.length !== ids.length) {
        const found = new Set(existing.map((template) => template.id));

        throw new NotFoundException(
          `Template(s) não encontrado(s): ${ids.filter((id) => !found.has(id)).join(', ')}`,
        );
      }

      const inUse = await tx.newsletterCampaign.groupBy({
        by: ['templateId'],
        where: { templateId: { in: ids } },
        _count: { _all: true },
      });

      if (inUse.length > 0) {
        const byId = new Map(existing.map((t) => [t.id, t.name]));

        throw new ConflictException(
          `Templates em uso por campanhas: ${inUse
            .map((row) => byId.get(row.templateId ?? '') ?? row.templateId)
            .join(', ')}`,
        );
      }

      const result = await tx.newsletterTemplate.deleteMany({
        where: { id: { in: ids } },
      });

      return { deleted: result.count };
    });
  }

  /**
   * Diagnóstico estático do template.
   *
   * A análise é função pura (`template-analysis.ts`), o que a torna testável
   * sem banco — no legado eram 465 linhas dentro da rota, entre a consulta e a
   * gravação do resultado.
   */
  async analyzeTemplate(templateId: string) {
    const template = await this.findTemplate(templateId);

    const [analysis, campaigns] = await Promise.all([
      Promise.resolve(analyzeTemplate(template)),
      this.prisma.newsletterCampaign.aggregate({
        where: { templateId, status: CampaignStatus.SENT },
        _count: { _all: true },
        _sum: {
          emailsSent: true,
          emailsDelivered: true,
          emailsOpened: true,
          emailsClicked: true,
          // Entra na conta da taxa de entrega: é ele que distingue "não medido"
          // de "tudo voltou". Ver `newsletter-rates`.
          emailsBounced: true,
        },
      }),
    ]);

    const sent = campaigns._sum.emailsSent ?? 0;
    const delivered = campaigns._sum.emailsDelivered ?? 0;
    const bounced = campaigns._sum.emailsBounced ?? 0;
    const opened = campaigns._sum.emailsOpened ?? 0;

    return {
      template: { id: template.id, name: template.name, type: template.type },
      ...analysis,
      performance: {
        campaignsSent: campaigns._count._all,
        emailsSent: sent,
        // `null` sem base: um template nunca enviado não tem 0% de abertura.
        deliveryRate: deliveryRate(delivered, sent, bounced),
        openRate: this.rate(opened, delivered),
        clickRate: this.rate(campaigns._sum.emailsClicked ?? 0, opened),
      },
    };
  }

  // -------------------------------------------------------------------
  // Listas de teste
  // -------------------------------------------------------------------

  async listTestLists() {
    return this.prisma.testEmailList.findMany({
      select: TEST_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createTestList(dto: CreateTestListDto) {
    const emails = this.normalizeEmails(dto.emails);

    return this.prisma.testEmailList.create({
      data: {
        name: dto.name,
        description: dto.description,
        emails,
        color: dto.color,
        isActive: dto.isActive ?? true,
        // O contador acompanha a lista na mesma escrita; deixá-lo para uma
        // atualização posterior é como ele passa a divergir.
        totalEmails: emails.length,
      },
      select: TEST_LIST_SELECT,
    });
  }

  async updateTestList(listId: string, dto: UpdateTestListDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Nada para atualizar');
    }

    const current = await this.prisma.testEmailList.findUnique({
      where: { id: listId },
      select: { id: true },
    });

    if (!current) {
      throw new NotFoundException('Lista de teste não encontrada');
    }

    const emails = dto.emails ? this.normalizeEmails(dto.emails) : undefined;

    return this.prisma.testEmailList.update({
      where: { id: listId },
      data: {
        name: dto.name,
        description: dto.description,
        color: dto.color,
        isActive: dto.isActive,
        emails,
        totalEmails: emails?.length,
      },
      select: TEST_LIST_SELECT,
    });
  }

  async deleteTestList(listId: string): Promise<void> {
    const list = await this.prisma.testEmailList.findUnique({
      where: { id: listId },
      select: { id: true },
    });

    if (!list) {
      throw new NotFoundException('Lista de teste não encontrada');
    }

    await this.prisma.testEmailList.delete({ where: { id: listId } });
  }

  /** Minúsculas, sem espaços e sem repetição. */
  private normalizeEmails(emails: string[]): string[] {
    return [...new Set(emails.map((email) => email.trim().toLowerCase()))];
  }

  // -------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------

  /**
   * Números do período.
   *
   * As consultas são paralelas. O legado encadeava seis funções auxiliares com
   * `await` uma após a outra, somando as latências sem necessidade.
   */
  async analytics(query: NewsletterAnalyticsQueryDto) {
    const period = query.period ?? '30d';
    const since = new Date(Date.now() - PERIOD_DAYS[period] * DAY_MS);

    const [novos, cancelados, campanhas, totais, topCampanhas] =
      await Promise.all([
        this.prisma.newsletterSubscriber.count({
          where: { subscribedAt: { gte: since } },
        }),
        this.prisma.newsletterSubscriber.count({
          where: { unsubscribedAt: { gte: since } },
        }),
        this.prisma.newsletterCampaign.count({
          where: { sentAt: { gte: since } },
        }),
        this.prisma.newsletterCampaign.aggregate({
          where: { sentAt: { gte: since } },
          _sum: {
            emailsSent: true,
            emailsDelivered: true,
            emailsOpened: true,
            emailsClicked: true,
            emailsBounced: true,
          },
        }),
        this.prisma.newsletterCampaign.findMany({
          where: { sentAt: { gte: since }, emailsDelivered: { gt: 0 } },
          select: {
            id: true,
            name: true,
            sentAt: true,
            emailsSent: true,
            emailsDelivered: true,
            emailsOpened: true,
            emailsClicked: true,
          },
          orderBy: { emailsOpened: 'desc' },
          take: 10,
        }),
      ]);

    const sent = totais._sum.emailsSent ?? 0;
    const delivered = totais._sum.emailsDelivered ?? 0;
    const bounced = totais._sum.emailsBounced ?? 0;
    const opened = totais._sum.emailsOpened ?? 0;

    return {
      period,
      subscribers: {
        gained: novos,
        lost: cancelados,
        net: novos - cancelados,
      },
      campaigns: { sent: campanhas },
      emails: {
        sent,
        delivered,
        opened,
        clicked: totais._sum.emailsClicked ?? 0,
        bounced: totais._sum.emailsBounced ?? 0,
        deliveryRate: deliveryRate(delivered, sent, bounced),
        openRate: this.rate(opened, delivered),
        clickRate: this.rate(totais._sum.emailsClicked ?? 0, opened),
      },
      topCampaigns: topCampanhas.map((campaign) => ({
        ...campaign,
        openRate: this.rate(campaign.emailsOpened, campaign.emailsDelivered),
      })),
    };
  }

  async exportAnalytics(query: NewsletterAnalyticsQueryDto) {
    const data = await this.analytics(query);

    if (query.format !== 'csv') {
      return data;
    }

    const csv = toCsv(
      [
        'Campanha',
        'Enviada em',
        'Enviados',
        'Entregues',
        'Aberturas',
        'Cliques',
        'Abertura %',
      ],
      data.topCampaigns.map((campaign) => [
        campaign.name,
        campaign.sentAt,
        campaign.emailsSent,
        campaign.emailsDelivered,
        campaign.emailsOpened,
        campaign.emailsClicked,
        campaign.openRate,
      ]),
    );

    return { csv, count: data.topCampaigns.length };
  }

  private rate(part: number, total: number): number | null {
    return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
  }
}
