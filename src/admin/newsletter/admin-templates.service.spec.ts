import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailTemplateType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminTemplatesService } from './admin-templates.service';

describe('AdminTemplatesService', () => {
  let service: AdminTemplatesService;
  let prisma: {
    newsletterTemplate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    newsletterCampaign: {
      groupBy: jest.Mock;
      aggregate: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
    newsletterSubscriber: { count: jest.Mock };
    testEmailList: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tx: {
    newsletterTemplate: { findMany: jest.Mock; deleteMany: jest.Mock };
    newsletterCampaign: { groupBy: jest.Mock };
  };

  const modelo = (over: Record<string, unknown> = {}) => ({
    id: 'template-1',
    name: 'Boas-vindas',
    type: EmailTemplateType.WELCOME,
    subject: 'Bem-vindo ao Opus Atlas, {{firstName}}',
    htmlContent: '<p>Olá {{firstName}}</p><a href="#">Descadastrar</a>',
    textContent: 'Olá {{firstName}}. Descadastrar.',
    variables: ['firstName'],
    ...over,
  });

  beforeEach(async () => {
    tx = {
      newsletterTemplate: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'template-1', name: 'Boas-vindas' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      newsletterCampaign: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    prisma = {
      newsletterTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(modelo()),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(modelo()),
        update: jest.fn().mockResolvedValue(modelo()),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      newsletterCampaign: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _count: { _all: 0 }, _sum: {} }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      newsletterSubscriber: { count: jest.fn().mockResolvedValue(0) },
      testEmailList: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'list-1' }),
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(args.data),
        ),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(args.data),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminTemplatesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminTemplatesService);
  });

  // -----------------------------------------------------------------
  describe('listagem', () => {
    // Um template pode ter duzentos mil caracteres.
    it('não devolve o conteúdo na listagem', async () => {
      await service.listTemplates({});

      const { select } = prisma.newsletterTemplate.findMany.mock.calls[0][0];

      expect(select).not.toHaveProperty('htmlContent');
      expect(select).not.toHaveProperty('textContent');
    });

    it('resolve o uso em campanhas numa agregação', async () => {
      prisma.newsletterTemplate.findMany.mockResolvedValue([
        modelo({ id: 't1' }),
        modelo({ id: 't2' }),
      ]);
      prisma.newsletterCampaign.groupBy.mockResolvedValue([
        { templateId: 't1', _count: { _all: 4 } },
      ]);

      const result = await service.listTemplates({});

      expect(prisma.newsletterCampaign.groupBy).toHaveBeenCalledTimes(1);
      expect(result.templates[0].campaigns).toBe(4);
      expect(result.templates[1].campaigns).toBe(0);
    });

    it('sem templates, não agrega', async () => {
      await service.listTemplates({});

      expect(prisma.newsletterCampaign.groupBy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('remoção em lote', () => {
    // A verificação era `encontrados.length !== pedidos.length`, então ids
    // repetidos derrubavam a operação com 404.
    it('ids repetidos não contam duas vezes', async () => {
      const result = await service.bulkDeleteTemplates({
        templateIds: ['template-1', 'template-1'],
      });

      expect(result.deleted).toBe(1);
    });

    it('id inexistente é apontado pelo nome', async () => {
      tx.newsletterTemplate.findMany.mockResolvedValue([]);

      await expect(
        service.bulkDeleteTemplates({ templateIds: ['sumiu'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('template em uso não é removido', async () => {
      tx.newsletterCampaign.groupBy.mockResolvedValue([
        { templateId: 'template-1', _count: { _all: 2 } },
      ]);

      await expect(
        service.bulkDeleteTemplates({ templateIds: ['template-1'] }),
      ).rejects.toThrow(ConflictException);
      expect(tx.newsletterTemplate.deleteMany).not.toHaveBeenCalled();
    });

    // Para não apagar um template que passou a ser usado no intervalo.
    it('verificação e remoção acontecem na mesma transação', async () => {
      await service.bulkDeleteTemplates({ templateIds: ['template-1'] });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.newsletterTemplate.deleteMany).toHaveBeenCalled();
      expect(prisma.newsletterTemplate.deleteMany).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  describe('diagnóstico', () => {
    it('junta apontamentos e desempenho', async () => {
      prisma.newsletterCampaign.aggregate.mockResolvedValue({
        _count: { _all: 3 },
        _sum: {
          emailsSent: 1000,
          emailsDelivered: 900,
          emailsOpened: 450,
          emailsClicked: 45,
        },
      });

      const result = await service.analyzeTemplate('template-1');

      expect(result.score).toBeGreaterThan(0);
      expect(result.performance.openRate).toBe(50);
      expect(result.performance.campaignsSent).toBe(3);
    });

    // Template nunca enviado não tem 0% de abertura.
    it('taxas nulas sem envio', async () => {
      const result = await service.analyzeTemplate('template-1');

      expect(result.performance.openRate).toBeNull();
      expect(result.performance.deliveryRate).toBeNull();
    });

    it('template inexistente responde 404', async () => {
      prisma.newsletterTemplate.findUnique.mockResolvedValue(null);

      await expect(service.analyzeTemplate('template-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('listas de teste', () => {
    it('normaliza e deduplica os endereços', async () => {
      const result = (await service.createTestList({
        name: 'Equipe',
        emails: ['  Ana@Opus.com ', 'ana@opus.com', 'bruno@opus.com'],
      })) as { emails: string[]; totalEmails: number };

      expect(result.emails).toEqual(['ana@opus.com', 'bruno@opus.com']);
    });

    // Deixar o contador para depois é como ele passa a divergir.
    it('grava o contador junto com a lista', async () => {
      const result = (await service.createTestList({
        name: 'Equipe',
        emails: ['a@b.c', 'd@e.f'],
      })) as { totalEmails: number };

      expect(result.totalEmails).toBe(2);
    });

    it('editar os endereços atualiza o contador', async () => {
      const result = (await service.updateTestList('list-1', {
        emails: ['a@b.c'],
      })) as { totalEmails: number };

      expect(result.totalEmails).toBe(1);
    });

    it('editar só o nome não mexe no contador', async () => {
      const result = (await service.updateTestList('list-1', {
        name: 'Outro',
      })) as { totalEmails?: number };

      expect(result.totalEmails).toBeUndefined();
    });

    it('recusa corpo vazio', async () => {
      await expect(service.updateTestList('list-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lista inexistente responde 404', async () => {
      prisma.testEmailList.findUnique.mockResolvedValue(null);

      await expect(service.deleteTestList('list-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('analytics', () => {
    // O legado encadeava seis auxiliares com `await` em sequência.
    it('calcula o saldo de assinantes do período', async () => {
      prisma.newsletterSubscriber.count
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(12);

      const result = await service.analytics({ period: '30d' });

      expect(result.subscribers).toEqual({ gained: 50, lost: 12, net: 38 });
    });

    it('abertura é medida sobre entregues, não sobre enviados', async () => {
      prisma.newsletterCampaign.aggregate.mockResolvedValue({
        _sum: {
          emailsSent: 1000,
          emailsDelivered: 800,
          emailsOpened: 400,
          emailsClicked: 40,
          emailsBounced: 200,
        },
      });

      const result = await service.analytics({});

      expect(result.emails.openRate).toBe(50);
      expect(result.emails.deliveryRate).toBe(80);
    });
  });
});
