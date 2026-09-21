import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminDatabaseService } from './admin-database.service';
import { ModelRegistry } from './model-registry';

const actor = { actorId: 'admin-1', actorRole: '2' };

describe('AdminDatabaseService', () => {
  let service: AdminDatabaseService;
  let registry: ModelRegistry;
  let audit: { record: jest.Mock };
  let delegate: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };

  beforeEach(async () => {
    delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'novo-1' }),
      update: jest.fn().mockResolvedValue({ id: 'u1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDatabaseService,
        ModelRegistry,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(AdminDatabaseService);
    registry = module.get(ModelRegistry);
    jest.spyOn(registry, 'delegate').mockReturnValue(delegate);
  });

  describe('describeModel', () => {
    it('marca campo protegido e não escrevível', () => {
      const described = service.describeModel('User');
      const senha = described.fields.find(
        (field) => field.name === 'hashedPassword',
      );

      expect(senha?.isProtected).toBe(true);
      expect(senha?.isWritable).toBe(false);
    });

    it('não deixa escrever id nem datas mantidas pelo banco', () => {
      const described = service.describeModel('Work');
      const porNome = new Map(
        described.fields.map((field) => [field.name, field]),
      );

      expect(porNome.get('id')?.isWritable).toBe(false);
      expect(porNome.get('createdAt')?.isWritable).toBe(false);
      expect(porNome.get('updatedAt')?.isWritable).toBe(false);
    });

    it('recusa model desconhecido', () => {
      expect(() => service.describeModel('Inexistente')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('listRecords', () => {
    const base = {
      model: 'User',
      page: 1,
      pageSize: 25,
      sortDirection: 'desc' as const,
    };

    // Sem `fields`, o `select` do legado ficava `undefined` e o Prisma devolvia
    // o documento inteiro — com `hashedPassword` de toda a base.
    it('nunca seleciona campo protegido, mesmo sem `fields`', async () => {
      await service.listRecords(base);

      const select = delegate.findMany.mock.calls[0][0].select;

      expect(select).toBeDefined();
      expect(select).not.toHaveProperty('hashedPassword');
    });

    it('limita a página ao teto', async () => {
      const result = await service.listRecords({
        ...base,
        pageSize: 1_000_000,
      });

      expect(delegate.findMany.mock.calls[0][0].take).toBe(200);
      expect(result.pagination.pageSize).toBe(200);
    });

    it('diz na resposta quais campos ficaram de fora', async () => {
      const result = await service.listRecords(base);

      expect(result.protectedFields).toContain('hashedPassword');
    });

    it('a mesma condição vai para a contagem e para a busca', async () => {
      await service.listRecords({ ...base, search: 'ana' });

      expect(delegate.count.mock.calls[0][0].where).toEqual(
        delegate.findMany.mock.calls[0][0].where,
      );
    });
  });

  describe('exportRecords', () => {
    it('em CSV, neutraliza fórmula', async () => {
      delegate.findMany.mockResolvedValue([
        { id: '1', firstName: '=1+1', email: 'a@b.com' },
      ]);

      const csv = (await service.exportRecords({
        model: 'User',
        format: 'csv',
        fields: ['id', 'firstName', 'email'],
        sortDirection: 'desc',
      })) as string;

      expect(csv).toContain(`"'=1+1"`);
    });

    it('em JSON, avisa quando truncou', async () => {
      delegate.findMany.mockResolvedValue([]);

      const result = await service.exportRecords({
        model: 'User',
        format: 'json',
        sortDirection: 'desc',
      });

      expect(result).toHaveProperty('truncated', false);
    });
  });

  describe('createRecord', () => {
    const input = {
      model: 'Epoch',
      data: { name: 'Barroco' },
      actor,
    };

    it('exige a frase de confirmação exata', async () => {
      await expect(
        service.createRecord({ ...input, confirmation: 'sim' }),
      ).rejects.toThrow(/CRIAR Epoch/);

      expect(delegate.create).not.toHaveBeenCalled();
    });

    it('com a frase certa, cria e audita o que foi escrito', async () => {
      await service.createRecord({ ...input, confirmation: 'CRIAR Epoch' });

      expect(delegate.create).toHaveBeenCalled();
      expect(audit.record.mock.calls[0][0].action).toBe(
        'database.record.create',
      );
      expect(audit.record.mock.calls[0][0].metadata.written).toEqual({
        name: 'Barroco',
      });
    });

    // O legado passava `data` cru para `prisma.create`.
    it('recusa campo protegido no corpo', async () => {
      await expect(
        service.createRecord({
          model: 'User',
          data: { email: 'a@b.com', hashedPassword: 'x' },
          confirmation: 'CRIAR User',
          actor,
        }),
      ).rejects.toThrow(/protegido/);
    });

    it('recusa campo que não existe no model', async () => {
      await expect(
        service.createRecord({
          ...input,
          data: { naoExiste: 1 },
          confirmation: 'CRIAR Epoch',
        }),
      ).rejects.toThrow(/Campo desconhecido/);
    });

    it('recusa escrever o identificador', async () => {
      await expect(
        service.createRecord({
          ...input,
          data: { id: 'escolhido-por-mim' },
          confirmation: 'CRIAR Epoch',
        }),
      ).rejects.toThrow(/definido pelo banco/);
    });
  });

  describe('updateRecord', () => {
    it('a frase cita o model e o id', async () => {
      await expect(
        service.updateRecord({
          model: 'User',
          id: 'u1',
          data: { role: 2 },
          confirmation: 'ATUALIZAR User outro-id',
          actor,
        }),
      ).rejects.toThrow(/ATUALIZAR User u1/);
    });

    it('registra o antes e o depois de cada campo', async () => {
      delegate.findUnique.mockResolvedValue({ id: 'u1', role: 0 });
      delegate.update.mockResolvedValue({ id: 'u1', role: 2 });

      const result = await service.updateRecord({
        model: 'User',
        id: 'u1',
        data: { role: 2 },
        confirmation: 'ATUALIZAR User u1',
        actor,
      });

      expect(result.changes).toEqual([{ field: 'role', from: 0, to: 2 }]);
      expect(audit.record.mock.calls[0][0].metadata.changes).toEqual([
        { field: 'role', from: 0, to: 2 },
      ]);
    });

    it('não escreve quando o registro não existe', async () => {
      delegate.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRecord({
          model: 'User',
          id: 'u1',
          data: { role: 2 },
          confirmation: 'ATUALIZAR User u1',
          actor,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(delegate.update).not.toHaveBeenCalled();
    });

    it('lê o estado anterior antes de escrever', async () => {
      const ordem: string[] = [];
      delegate.findUnique.mockImplementation(() => {
        ordem.push('antes');
        return Promise.resolve({ id: 'u1', role: 0 });
      });
      delegate.update.mockImplementation(() => {
        ordem.push('escrita');
        return Promise.resolve({ id: 'u1', role: 2 });
      });

      await service.updateRecord({
        model: 'User',
        id: 'u1',
        data: { role: 2 },
        confirmation: 'ATUALIZAR User u1',
        actor,
      });

      expect(ordem).toEqual(['antes', 'escrita']);
    });
  });

  describe('deleteRecords', () => {
    const ids = ['685d591c1e3db0c5aaa893e4', '685d591c1e3db0c5aaa893e5'];

    // A confirmação de apagar 3 não pode servir para apagar 300.
    it('a frase cita a quantidade', async () => {
      await expect(
        service.deleteRecords({
          model: 'Coupon',
          ids,
          confirmation: 'APAGAR 3 Coupon',
          actor,
        }),
      ).rejects.toThrow(/APAGAR 2 Coupon/);

      expect(delegate.deleteMany).not.toHaveBeenCalled();
    });

    it('guarda na trilha o conteúdo apagado', async () => {
      delegate.findMany.mockResolvedValue([{ id: ids[0], code: 'PROMO' }]);
      delegate.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteRecords({
        model: 'Coupon',
        ids,
        confirmation: 'APAGAR 2 Coupon',
        actor,
      });

      expect(audit.record.mock.calls[0][0].metadata.deleted).toEqual([
        { id: ids[0], code: 'PROMO' },
      ]);
      // Pedir 2 e apagar 1 merece explicação.
      expect(result.notFound).toBe(1);
    });

    it('recusa lista vazia', async () => {
      await expect(
        service.deleteRecords({
          model: 'Coupon',
          ids: [],
          confirmation: 'APAGAR 0 Coupon',
          actor,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
