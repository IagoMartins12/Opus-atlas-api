import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { UserTokenService } from '../../auth/user-token.service';
import { QueueService } from '../../common/queue/queue.service';
import { NewsletterDispatchService } from './newsletter-dispatch.service';

const campaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'campanha-1',
  name: 'Digest de setembro',
  status: 'SENDING',
  subject: 'Novidades',
  customSubject: null,
  customHtmlContent: '<p>Olá, {{firstName}}</p>',
  customTextContent: 'Olá, {{firstName}}',
  senderName: 'Opus Atlas',
  replyToEmail: null,
  targetAll: true,
  targetSegments: null,
  targetSubscriberIds: [],
  template: null,
  ...overrides,
});

const subscriber = (overrides: Record<string, unknown> = {}) => ({
  id: 'assinante-1',
  email: 'ana@exemplo.com',
  firstName: 'Ana',
  lastName: 'Souza',
  userId: null,
  ...overrides,
});

describe('NewsletterDispatchService', () => {
  let service: NewsletterDispatchService;
  let prisma: {
    newsletterCampaign: { findUnique: jest.Mock; update: jest.Mock };
    newsletterSubscriber: { findMany: jest.Mock; count: jest.Mock };
    newsletterCampaignSend: {
      findMany: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    userToken: { findMany: jest.Mock };
  };
  let mail: { trySend: jest.Mock };
  let queue: { enqueue: jest.Mock };
  let tokens: { createToken: jest.Mock };

  beforeEach(async () => {
    prisma = {
      newsletterCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign()),
        update: jest.fn().mockResolvedValue({}),
      },
      newsletterSubscriber: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      newsletterCampaignSend: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      userToken: { findMany: jest.fn().mockResolvedValue([]) },
    };

    mail = { trySend: jest.fn().mockResolvedValue({ delivered: true }) };
    queue = { enqueue: jest.fn().mockResolvedValue({ jobId: 'job-1' }) };
    tokens = { createToken: jest.fn().mockResolvedValue('token-novo') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NewsletterDispatchService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: UserTokenService, useValue: tokens },
        { provide: QueueService, useValue: queue },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://opusatlas.com' },
        },
      ],
    }).compile();

    service = module.get(NewsletterDispatchService);
  });

  describe('enqueuePlan', () => {
    // Dois cliques no botão de disparar precisam produzir um envio só.
    it('usa a campanha como chave de idempotência', async () => {
      await service.enqueuePlan('campanha-1', 'admin-1');

      expect(queue.enqueue.mock.calls[0][0].idempotencyKey).toBe(
        'newsletter.plan.campanha-1',
      );
      expect(queue.enqueue.mock.calls[0][0].requestedBy).toBe('admin-1');
    });
  });

  describe('plan', () => {
    const pages = (...batches: string[][]) => {
      let call = 0;
      prisma.newsletterSubscriber.findMany.mockImplementation(() => {
        const page = batches[call] ?? [];
        call += 1;
        return Promise.resolve(page.map((id) => ({ id })));
      });
    };

    it('enfileira um job por lote', async () => {
      pages(['a', 'b'], ['c']);
      prisma.newsletterSubscriber.count.mockResolvedValue(3);

      const result = await service.plan('campanha-1', 'admin-1');

      expect(result.batches).toBe(2);
      expect(result.audienceSize).toBe(3);
      expect(queue.enqueue).toHaveBeenCalledTimes(2);
    });

    it('numera os lotes na chave, para o segundo planejamento não duplicar', async () => {
      pages(['a'], ['b']);

      await service.plan('campanha-1', null);

      expect(queue.enqueue.mock.calls[0][0].idempotencyKey).toBe(
        'newsletter.batch.campanha-1.0',
      );
      expect(queue.enqueue.mock.calls[1][0].idempotencyKey).toBe(
        'newsletter.batch.campanha-1.1',
      );
    });

    // Com `skip`/`take`, uma inscrição nova no meio da varredura desloca a
    // janela e faz um assinante ser pulado.
    it('pagina por cursor, não por deslocamento', async () => {
      pages(['a', 'b'], []);

      await service.plan('campanha-1', null);

      const segunda = prisma.newsletterSubscriber.findMany.mock.calls[1][0];

      expect(segunda.cursor).toEqual({ id: 'b' });
      expect(segunda.skip).toBe(1);
      expect(segunda.orderBy).toEqual({ id: 'asc' });
    });

    // O fechamento usa este número para saber que acabou.
    it('grava o total antes de enfileirar e corrige depois da varredura', async () => {
      pages(['a', 'b'], []);
      prisma.newsletterSubscriber.count.mockResolvedValue(5);

      await service.plan('campanha-1', null);

      const totais = prisma.newsletterCampaign.update.mock.calls.map(
        (call) => call[0].data.totalSubscribers,
      );

      expect(totais[0]).toBe(5);
      expect(totais[1]).toBe(2);
    });

    it('fecha a campanha quando ninguém corresponde à segmentação', async () => {
      pages([]);
      prisma.newsletterCampaignSend.count.mockResolvedValue(0);

      await service.plan('campanha-1', null);

      const status = prisma.newsletterCampaign.update.mock.calls
        .map((call) => call[0].data.status)
        .filter(Boolean);

      expect(status).toContain('FAILED');
    });

    it('reporta a origem do conteúdo e as variáveis desconhecidas', async () => {
      pages([]);
      prisma.newsletterCampaign.findUnique.mockResolvedValue(
        campaign({ customHtmlContent: '<p>{{firstName}} {{newWorks}}</p>' }),
      );

      const result = await service.plan('campanha-1', null);

      expect(result.contentSource).toBe('custom');
      expect(result.unknownVariables).toEqual(['newWorks']);
    });
  });

  describe('sendBatch', () => {
    it('envia para quem ainda não recebeu', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      const result = await service.sendBatch('campanha-1', ['assinante-1']);

      expect(mail.trySend).toHaveBeenCalledTimes(1);
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);
    });

    // A fila reentrega por definição; sem o livro-razão, retomar um envio
    // significa mandar tudo de novo para quem já recebeu.
    it('pula quem já está marcado como enviado', async () => {
      prisma.newsletterCampaignSend.findMany.mockResolvedValue([
        { subscriberId: 'assinante-1', status: 'sent' },
      ]);
      prisma.newsletterSubscriber.findMany.mockResolvedValue([]);

      const result = await service.sendBatch('campanha-1', ['assinante-1']);

      expect(mail.trySend).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    // `pending` é tentativa de resultado desconhecido: tenta de novo.
    it('reenvia para quem ficou em `pending`', async () => {
      prisma.newsletterCampaignSend.findMany.mockResolvedValue([
        { subscriberId: 'assinante-1', status: 'pending' },
      ]);
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(mail.trySend).toHaveBeenCalledTimes(1);
    });

    it('reserva a linha antes de enviar', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
      const order: string[] = [];
      prisma.newsletterCampaignSend.upsert.mockImplementation(() => {
        order.push('reserva');
        return Promise.resolve({});
      });
      mail.trySend.mockImplementation(() => {
        order.push('envio');
        return Promise.resolve({ delivered: true });
      });

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(order).toEqual(['reserva', 'envio']);
    });

    it('marca como falha quando o SMTP recusa', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
      mail.trySend.mockResolvedValue({
        delivered: false,
        error: 'caixa cheia',
      });

      const result = await service.sendBatch('campanha-1', ['assinante-1']);

      expect(result.failed).toBe(1);
      expect(
        prisma.newsletterCampaignSend.update.mock.calls[0][0].data,
      ).toEqual({ status: 'failed', sentAt: null, emailId: null });
    });

    // Sem o id da mensagem, nenhum webhook de provedor consegue dizer a que
    // campanha e a que assinante um `delivered` ou um `bounce` se refere.
    it('guarda o id da mensagem devolvido pelo servidor de saída', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
      mail.trySend.mockResolvedValue({
        delivered: true,
        messageId: 'abc@opusatlas.com',
      });

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(
        prisma.newsletterCampaignSend.update.mock.calls[0][0].data.emailId,
      ).toBe('abc@opusatlas.com');
    });

    it('personaliza o corpo com o nome de quem recebe', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(mail.trySend.mock.calls[0][0].html).toContain('Olá, Ana');
    });

    // Sair da lista não pode depender de o autor do template ter lembrado.
    it('garante o link de descadastro e o cabeçalho de um clique', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      const enviado = mail.trySend.mock.calls[0][0];

      expect(enviado.html).toContain('/newsletter/unsubscribe/token-novo');
      expect(enviado.headers['List-Unsubscribe']).toBe(
        '<https://opusatlas.com/newsletter/unsubscribe/token-novo>',
      );
    });

    // Emitir um token novo por campanha mataria o link do e-mail anterior.
    it('reaproveita o token de descadastro que já existe', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
      prisma.userToken.findMany.mockResolvedValue([
        {
          token: 'token-antigo',
          userId: null,
          anonymousEmail: 'ana@exemplo.com',
        },
      ]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(tokens.createToken).not.toHaveBeenCalled();
      expect(mail.trySend.mock.calls[0][0].html).toContain('token-antigo');
    });

    it('só cria token novo sem revogar o anterior', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(tokens.createToken.mock.calls[0][0].revokePrevious).toBe(false);
    });

    // O legado copiava um no outro e chamava de taxa de entrega.
    it('incrementa só `emailsSent`, nunca `emailsDelivered`', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      const contadores = prisma.newsletterCampaign.update.mock.calls[0][0].data;

      expect(contadores).toEqual({ emailsSent: { increment: 1 } });
    });

    it('usa o nome do remetente da campanha, não o endereço', async () => {
      prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);

      await service.sendBatch('campanha-1', ['assinante-1']);

      expect(mail.trySend.mock.calls[0][0].fromName).toBe('Opus Atlas');
    });

    // Reentrega tardia não pode disparar e-mail de campanha já encerrada.
    it('não envia nada quando a campanha saiu de SENDING', async () => {
      prisma.newsletterCampaign.findUnique.mockResolvedValue(
        campaign({ status: 'CANCELLED' }),
      );

      const result = await service.sendBatch('campanha-1', ['assinante-1']);

      expect(mail.trySend).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    describe('fechamento', () => {
      it('fecha como SENT quando o último lote termina', async () => {
        prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
        prisma.newsletterCampaign.findUnique
          .mockResolvedValueOnce(campaign())
          .mockResolvedValueOnce({ totalSubscribers: 1, status: 'SENDING' });
        prisma.newsletterCampaignSend.count.mockResolvedValue(1);

        await service.sendBatch('campanha-1', ['assinante-1']);

        const status = prisma.newsletterCampaign.update.mock.calls
          .map((call) => call[0].data.status)
          .filter(Boolean);

        expect(status).toEqual(['SENT']);
      });

      it('não fecha enquanto faltam lotes', async () => {
        prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
        prisma.newsletterCampaign.findUnique
          .mockResolvedValueOnce(campaign())
          .mockResolvedValueOnce({ totalSubscribers: 500, status: 'SENDING' });
        prisma.newsletterCampaignSend.count.mockResolvedValue(50);

        await service.sendBatch('campanha-1', ['assinante-1']);

        const status = prisma.newsletterCampaign.update.mock.calls
          .map((call) => call[0].data.status)
          .filter(Boolean);

        expect(status).toEqual([]);
      });

      // Um assinante com caixa cheia bastava para o legado marcar como
      // fracasso a campanha que chegou a nove mil pessoas.
      it('uma recusa isolada não reprova a campanha inteira', async () => {
        prisma.newsletterSubscriber.findMany.mockResolvedValue([subscriber()]);
        mail.trySend.mockResolvedValue({ delivered: false, error: 'recusado' });
        prisma.newsletterCampaign.findUnique
          .mockResolvedValueOnce(campaign())
          .mockResolvedValueOnce({ totalSubscribers: 1, status: 'SENDING' });
        prisma.newsletterCampaignSend.count
          .mockResolvedValueOnce(1) // liquidados
          .mockResolvedValueOnce(900); // enviados com sucesso na campanha

        await service.sendBatch('campanha-1', ['assinante-1']);

        const status = prisma.newsletterCampaign.update.mock.calls
          .map((call) => call[0].data.status)
          .filter(Boolean);

        expect(status).toEqual(['SENT']);
      });
    });
  });
});
