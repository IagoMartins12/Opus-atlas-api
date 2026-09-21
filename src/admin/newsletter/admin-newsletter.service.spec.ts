import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignStatus, SubscriptionStatus } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminNewsletterService } from './admin-newsletter.service';
import { NewsletterDispatchService } from './newsletter-dispatch.service';

describe('AdminNewsletterService', () => {
  let service: AdminNewsletterService;
  let prisma: {
    newsletterCampaign: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    newsletterSubscriber: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mail: { send: jest.Mock };
  let dispatch: { enqueuePlan: jest.Mock };

  const campanha = (over: Record<string, unknown> = {}) => ({
    id: 'campaign-1',
    name: 'Novidades',
    subject: 'Cinco obras novas',
    status: CampaignStatus.DRAFT,
    templateId: 'template-1',
    customHtmlContent: null,
    customTextContent: null,
    targetAll: true,
    targetSegments: null,
    targetSubscriberIds: [],
    emailsSent: 0,
    ...over,
  });

  const criar = {
    name: 'Novidades',
    subject: 'Cinco obras novas',
    templateId: '685d591c1e3db0c5aaa893e4',
  };

  beforeEach(async () => {
    prisma = {
      newsletterCampaign: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(campanha()),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(campanha(args.data)),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(campanha(args.data)),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      newsletterSubscriber: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1',
          status: SubscriptionStatus.ACTIVE,
        }),
        count: jest.fn().mockResolvedValue(120),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    mail = { send: jest.fn().mockResolvedValue(undefined) };
    dispatch = {
      enqueuePlan: jest
        .fn()
        .mockResolvedValue({ jobId: 'newsletter.plan.camp-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminNewsletterService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: NewsletterDispatchService, useValue: dispatch },
      ],
    }).compile();

    service = module.get(AdminNewsletterService);
  });

  // -----------------------------------------------------------------
  describe('criação de campanha', () => {
    it('exige template ou conteúdo próprio', async () => {
      await expect(
        service.createCampaign({ name: 'X', subject: 'Y' }),
      ).rejects.toThrow(BadRequestException);
    });

    // E-mail em HTML sem alternativa em texto é sinal clássico de spam.
    it('conteúdo próprio exige versão em texto', async () => {
      await expect(
        service.createCampaign({
          name: 'X',
          subject: 'Y',
          customHtmlContent: '<p>oi</p>',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa agendamento no passado', async () => {
      await expect(
        service.createCampaign({
          ...criar,
          scheduledAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('agendar já nasce agendada', async () => {
      const futuro = new Date(Date.now() + 86_400_000).toISOString();

      await service.createCampaign({ ...criar, scheduledAt: futuro });

      expect(
        prisma.newsletterCampaign.create.mock.calls[0][0].data.status,
      ).toBe(CampaignStatus.SCHEDULED);
    });
  });

  // -----------------------------------------------------------------
  describe('disparo', () => {
    // O legado dava `await startCampaignSending(id)` dentro da requisição:
    // lotes de 50 com 2s de intervalo, mais de seis minutos para dez mil.
    it('enfileira e devolve o tamanho do público, sem enviar em linha', async () => {
      const result = await service.queueCampaign('campaign-1');

      expect(result.queued).toBe(true);
      expect(result.audienceSize).toBe(120);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('marca como enviando, o que impede segundo disparo', async () => {
      await service.queueCampaign('campaign-1');

      const { data } = prisma.newsletterCampaign.update.mock.calls[0][0];

      expect(data.status).toBe(CampaignStatus.SENDING);
      expect(data.totalSubscribers).toBe(120);
    });

    it('campanha já disparada não dispara de novo', async () => {
      prisma.newsletterCampaign.findUnique.mockResolvedValue(
        campanha({ status: CampaignStatus.SENT }),
      );

      await expect(service.queueCampaign('campaign-1')).rejects.toThrow(
        ConflictException,
      );
    });

    // Disparar para ninguém consome a campanha sem efeito.
    it('recusa disparo sem público', async () => {
      prisma.newsletterSubscriber.count.mockResolvedValue(0);

      await expect(service.queueCampaign('campaign-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recusa disparo sem conteúdo', async () => {
      prisma.newsletterCampaign.findUnique.mockResolvedValue(
        campanha({ templateId: null, customHtmlContent: null }),
      );

      await expect(service.queueCampaign('campaign-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    // O público é medido com uma contagem, não carregando os assinantes.
    it('mede o público por contagem', async () => {
      await service.queueCampaign('campaign-1');

      expect(prisma.newsletterSubscriber.count).toHaveBeenCalled();
      expect(prisma.newsletterSubscriber.findMany).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('prévia', () => {
    it('envia para um endereço só', async () => {
      prisma.newsletterCampaign.findUnique.mockResolvedValue({
        id: 'campaign-1',
        subject: 'Cinco obras novas',
        customHtmlContent: '<p>oi</p>',
        customTextContent: 'oi',
        template: null,
      });

      const result = await service.sendTest('campaign-1', {
        to: 'admin@opusatlas.com',
      });

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(mail.send.mock.calls[0][0].to).toBe('admin@opusatlas.com');
      expect(mail.send.mock.calls[0][0].subject).toContain('[TESTE]');
      expect(result.sentTo).toBe('admin@opusatlas.com');
    });

    it('sem conteúdo, não envia', async () => {
      prisma.newsletterCampaign.findUnique.mockResolvedValue({
        id: 'campaign-1',
        subject: 'X',
        customHtmlContent: null,
        customTextContent: null,
        template: null,
      });

      await expect(
        service.sendTest('campaign-1', { to: 'a@b.c' }),
      ).rejects.toThrow(BadRequestException);
      expect(mail.send).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('remoção de campanha', () => {
    // Campanha enviada é a única prova de qual conteúdo chegou a quem.
    it('campanha enviada não é removida', async () => {
      prisma.newsletterCampaign.findUnique.mockResolvedValue(
        campanha({ status: CampaignStatus.SENT, emailsSent: 500 }),
      );

      await expect(service.deleteCampaign('campaign-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rascunho é removido', async () => {
      await expect(
        service.deleteCampaign('campaign-1'),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  describe('assinantes', () => {
    // O legado fazia `data: { ...body }`.
    it('a edição grava só a lista fechada', async () => {
      await service.updateSubscriber('sub-1', { firstName: 'Ana' });

      const { data } = prisma.newsletterSubscriber.update.mock.calls[0][0];

      expect(data).not.toHaveProperty('email');
      expect(data).not.toHaveProperty('unsubscribeToken');
      expect(data).not.toHaveProperty('userId');
      expect(data).not.toHaveProperty('emailOpenCount');
      expect(data.firstName).toBe('Ana');
    });

    it('descadastrar marca a data junto', async () => {
      await service.updateSubscriber('sub-1', {
        status: SubscriptionStatus.UNSUBSCRIBED,
      });

      expect(
        prisma.newsletterSubscriber.update.mock.calls[0][0].data.unsubscribedAt,
      ).toBeInstanceOf(Date);
    });

    it('quem já estava descadastrado não tem a data reescrita', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.UNSUBSCRIBED,
      });

      await service.updateSubscriber('sub-1', {
        status: SubscriptionStatus.UNSUBSCRIBED,
      });

      expect(
        prisma.newsletterSubscriber.update.mock.calls[0][0].data,
      ).not.toHaveProperty('unsubscribedAt');
    });

    // Apagar quem cancelou destrói a prova do opt-out: numa importação
    // seguinte a mesma pessoa volta a receber.
    it('remover marca como descadastrado por padrão', async () => {
      const result = await service.removeSubscriber('sub-1', {});

      expect(result.removed).toBe(false);
      expect(prisma.newsletterSubscriber.delete).not.toHaveBeenCalled();
      expect(
        prisma.newsletterSubscriber.update.mock.calls[0][0].data.status,
      ).toBe(SubscriptionStatus.UNSUBSCRIBED);
    });

    it('exclusão definitiva é escolha explícita', async () => {
      const result = await service.removeSubscriber('sub-1', {
        hardDelete: true,
      });

      expect(result.removed).toBe(true);
      expect(prisma.newsletterSubscriber.delete).toHaveBeenCalled();
    });

    it('assinante inexistente responde 404', async () => {
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(null);

      await expect(service.removeSubscriber('sub-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('números', () => {
    // Nunca ter enviado não é 0% de abertura.
    it('taxas são nulas sem base', async () => {
      const result = await service.stats();

      expect(result.emails.openRate).toBeNull();
      expect(result.emails.deliveryRate).toBeNull();
    });

    it('calcula as taxas sobre a base certa', async () => {
      prisma.newsletterCampaign.aggregate.mockResolvedValue({
        _sum: {
          emailsSent: 1000,
          emailsDelivered: 900,
          emailsOpened: 450,
          emailsClicked: 90,
          emailsBounced: 100,
        },
      });

      const result = await service.stats();

      expect(result.emails.deliveryRate).toBe(90);
      // Abertura sobre entregues, não sobre enviados.
      expect(result.emails.openRate).toBe(50);
      // Clique sobre abertos.
      expect(result.emails.clickRate).toBe(20);
    });
  });
});
