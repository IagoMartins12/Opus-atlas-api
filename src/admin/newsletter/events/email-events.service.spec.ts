import { EmailEventType, Prisma, SubscriptionStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailEventsService } from './email-events.service';
import { DeliveryEvent } from './delivery-event';

const duplicado = new Prisma.PrismaClientKnownRequestError('duplicado', {
  code: 'P2002',
  clientVersion: '6',
});

const evento = (overrides: Partial<DeliveryEvent> = {}): DeliveryEvent => ({
  providerEventId: 'svix-1',
  type: EmailEventType.DELIVERED,
  messageId: 'msg-1',
  email: 'pessoa@exemplo.com',
  timestamp: new Date('2026-09-10T12:00:00Z'),
  ...overrides,
});

describe('EmailEventsService', () => {
  let service: EmailEventsService;
  let prisma: {
    processedWebhookEvent: { create: jest.Mock; deleteMany: jest.Mock };
    newsletterCampaignSend: { findFirst: jest.Mock };
    newsletterSubscriber: { findUnique: jest.Mock; update: jest.Mock };
    newsletterEmailEvent: { create: jest.Mock };
    newsletterCampaign: { update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      processedWebhookEvent: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      newsletterCampaignSend: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ subscriberId: 'sub-1', campaignId: 'camp-1' }),
      },
      newsletterSubscriber: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sub-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      newsletterEmailEvent: { create: jest.fn().mockResolvedValue({}) },
      newsletterCampaign: {
        update: jest.fn().mockResolvedValue({
          emailsSent: 100,
          emailsDelivered: 90,
          emailsOpened: 30,
          emailsClicked: 10,
          emailsBounced: 5,
          emailsUnsubscribed: 2,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailEventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EmailEventsService);
  });

  const ingerir = (events: DeliveryEvent[]) => service.ingest('resend', events);

  it('registra o evento no histórico do assinante', async () => {
    const result = await ingerir([evento()]);

    expect(result.applied).toBe(1);
    expect(
      prisma.newsletterEmailEvent.create.mock.calls[0][0].data,
    ).toMatchObject({
      eventType: 'DELIVERED',
      subscriberId: 'sub-1',
      campaignId: 'camp-1',
    });
  });

  describe('idempotência', () => {
    // O provedor reentrega quando não recebe 200 a tempo.
    it('evento já processado é ignorado', async () => {
      prisma.processedWebhookEvent.create.mockRejectedValue(duplicado);

      const result = await ingerir([evento()]);

      expect(result.duplicates).toBe(1);
      expect(prisma.newsletterEmailEvent.create).not.toHaveBeenCalled();
    });

    it('a reserva é por provedor mais id do evento', async () => {
      await ingerir([evento()]);

      expect(
        prisma.processedWebhookEvent.create.mock.calls[0][0].data.eventId,
      ).toBe('resend:svix-1');
    });

    // Sem devolver a trava, uma falha momentânea faria o evento sumir para
    // sempre — a reentrega bateria na trava e seria descartada.
    it('falha ao aplicar devolve a trava', async () => {
      prisma.newsletterEmailEvent.create.mockRejectedValue(new Error('banco'));

      await expect(ingerir([evento()])).rejects.toThrow();
      expect(prisma.processedWebhookEvent.deleteMany).toHaveBeenCalled();
    });
  });

  describe('a quem o evento pertence', () => {
    it('casa pelo id da mensagem', async () => {
      await ingerir([evento()]);

      expect(
        prisma.newsletterCampaignSend.findFirst.mock.calls[0][0].where,
      ).toEqual({ emailId: 'msg-1' });
    });

    // Um retorno num e-mail transacional não pertence a campanha nenhuma, mas
    // importa tanto quanto na newsletter.
    it('sem par de campanha, casa pelo endereço', async () => {
      prisma.newsletterCampaignSend.findFirst.mockResolvedValue(null);

      const result = await ingerir([evento()]);

      expect(result.applied).toBe(1);
      expect(
        prisma.newsletterEmailEvent.create.mock.calls[0][0].data.campaignId,
      ).toBeNull();
    });

    it('evento sem par nenhum é contado e não quebra', async () => {
      prisma.newsletterCampaignSend.findFirst.mockResolvedValue(null);
      prisma.newsletterSubscriber.findUnique.mockResolvedValue(null);

      const result = await ingerir([evento()]);

      expect(result.unmatched).toBe(1);
      expect(result.applied).toBe(0);
    });
  });

  describe('contadores da campanha', () => {
    it('soma o contador do tipo do evento', async () => {
      await ingerir([evento()]);

      expect(prisma.newsletterCampaign.update.mock.calls[0][0].data).toEqual({
        emailsDelivered: { increment: 1 },
      });
    });

    // `emailsSent` é escrito pelo disparo; contá-lo de novo somaria duas vezes.
    it('o evento de envio não mexe em contador', async () => {
      await ingerir([evento({ type: EmailEventType.SENT })]);

      expect(prisma.newsletterCampaign.update).not.toHaveBeenCalled();
    });

    // Taxa que se acumula sozinha diverge dos números que a explicam.
    it('recalcula as taxas a partir dos contadores', async () => {
      await ingerir([evento()]);

      expect(
        prisma.newsletterCampaign.update.mock.calls[1][0].data,
      ).toMatchObject({
        deliveryRate: 90,
        openRate: 33.3,
        bounceRate: 5,
      });
    });
  });

  describe('o que acontece com o assinante', () => {
    // Continuar mandando para endereço inexistente destrói a reputação do
    // domínio, e aí a newsletter cai no spam de quem quer recebê-la.
    it('retorno permanente tira da lista', async () => {
      await ingerir([
        evento({
          type: EmailEventType.BOUNCED,
          data: { bounceType: 'Permanent' },
        }),
      ]);

      expect(
        prisma.newsletterSubscriber.update.mock.calls[0][0].data.status,
      ).toBe(SubscriptionStatus.BOUNCED);
    });

    // Caixa cheia ou servidor fora do ar por uma hora: o endereço é válido.
    it('retorno temporário não tira ninguém', async () => {
      await ingerir([
        evento({
          type: EmailEventType.BOUNCED,
          data: { bounceType: 'Transient' },
        }),
      ]);

      expect(prisma.newsletterSubscriber.update).not.toHaveBeenCalled();
    });

    it('retorno sem classificação não tira ninguém', async () => {
      await ingerir([evento({ type: EmailEventType.BOUNCED })]);

      expect(prisma.newsletterSubscriber.update).not.toHaveBeenCalled();
    });

    it('denúncia de spam bloqueia', async () => {
      await ingerir([evento({ type: EmailEventType.COMPLAINED })]);

      expect(
        prisma.newsletterSubscriber.update.mock.calls[0][0].data,
      ).toMatchObject({ status: SubscriptionStatus.BLOCKED });
    });

    it('abertura conta e marca a data', async () => {
      await ingerir([evento({ type: EmailEventType.OPENED })]);

      expect(
        prisma.newsletterSubscriber.update.mock.calls[0][0].data,
      ).toMatchObject({ emailOpenCount: { increment: 1 } });
    });

    it('entrega não mexe no assinante', async () => {
      await ingerir([evento()]);

      expect(prisma.newsletterSubscriber.update).not.toHaveBeenCalled();
    });
  });
});
