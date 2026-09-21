import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelRegistry } from './model-registry';
import { buildOrderBy, buildWhere } from './record-query';

describe('gramática de consulta', () => {
  let registry: ModelRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ModelRegistry, { provide: PrismaService, useValue: {} }],
    }).compile();

    registry = module.get(ModelRegistry);
  });

  const user = () => registry.require('User');
  const work = () => registry.require('Work');

  describe('buildWhere', () => {
    it('traduz igualdade', () => {
      const where = buildWhere(registry, user(), {
        filters: [{ field: 'email', operator: 'eq', value: 'a@b.com' }],
      });

      expect(where).toEqual({ email: 'a@b.com' });
    });

    it('traduz diferença', () => {
      const where = buildWhere(registry, user(), {
        filters: [{ field: 'role', operator: 'ne', value: 0 }],
      });

      expect(where).toEqual({ role: { not: 0 } });
    });

    it('busca textual é insensível a maiúsculas', () => {
      const where = buildWhere(registry, work(), {
        filters: [{ field: 'title', operator: 'contains', value: 'sonata' }],
      });

      expect(where).toEqual({
        title: { contains: 'sonata', mode: 'insensitive' },
      });
    });

    // Ausente não é nulo no MongoDB, e a diferença já mordeu esta base.
    it('expõe `isSet` para distinguir ausente de nulo', () => {
      const where = buildWhere(registry, user(), {
        filters: [{ field: 'lastSeen', operator: 'isSet', value: false }],
      });

      expect(where).toEqual({ lastSeen: { isSet: false } });
    });

    // Com `hashedPassword` dava para sondar o hash por `startsWith`, um
    // caractere de cada vez, sem nunca lê-lo.
    it('recusa filtrar por campo protegido', () => {
      expect(() =>
        buildWhere(registry, user(), {
          filters: [
            {
              field: 'hashedPassword',
              operator: 'startsWith',
              value: '$argon2',
            },
          ],
        }),
      ).toThrow(BadRequestException);
    });

    it('recusa campo que não existe no model', () => {
      expect(() =>
        buildWhere(registry, user(), {
          filters: [{ field: 'naoExiste', operator: 'eq', value: 1 }],
        }),
      ).toThrow(/Campo desconhecido/);
    });

    it('recusa operador de texto em campo numérico', () => {
      expect(() =>
        buildWhere(registry, user(), {
          filters: [{ field: 'role', operator: 'contains', value: '2' }],
        }),
      ).toThrow(/só vale para texto/);
    });

    it('recusa data inválida em vez de repassá-la ao Prisma', () => {
      expect(() =>
        buildWhere(registry, user(), {
          filters: [{ field: 'createdAt', operator: 'gt', value: 'ontem' }],
        }),
      ).toThrow(/data ISO/);
    });

    it('converte número vindo como texto', () => {
      const where = buildWhere(registry, user(), {
        filters: [{ field: 'role', operator: 'gte', value: '1' }],
      });

      expect(where).toEqual({ role: { gte: 1 } });
    });

    it('recusa valor fora do enum', () => {
      expect(() =>
        buildWhere(registry, registry.require('Lesson'), {
          filters: [{ field: 'status', operator: 'eq', value: 'INVENTADO' }],
        }),
      ).toThrow(/aceita apenas/);
    });

    it('`in` exige lista', () => {
      expect(() =>
        buildWhere(registry, user(), {
          filters: [{ field: 'role', operator: 'in', value: 2 }],
        }),
      ).toThrow(/espera uma lista/);
    });

    describe('busca livre', () => {
      it('procura nos campos de texto', () => {
        const where = buildWhere(registry, work(), { search: 'sonata' });

        expect(Array.isArray(where.OR)).toBe(true);
      });

      // Procurar um ObjectId em campo de texto é varredura garantidamente vazia.
      it('um ObjectId vira busca pelo identificador', () => {
        const where = buildWhere(registry, work(), {
          search: '685d591c1e3db0c5aaa893e4',
        });

        expect(where).toEqual({ id: '685d591c1e3db0c5aaa893e4' });
      });

      it('nunca procura dentro de campo protegido', () => {
        const where = buildWhere(registry, user(), { search: 'algo' });
        const campos = (where.OR as Record<string, unknown>[]).flatMap(
          (branch) => Object.keys(branch),
        );

        expect(campos).not.toContain('hashedPassword');
      });
    });
  });

  describe('buildOrderBy', () => {
    it('ordena pelo campo pedido', () => {
      expect(buildOrderBy(registry, work(), 'title', 'asc')).toEqual({
        title: 'asc',
      });
    });

    // O legado mantinha à mão uma lista dos "models sem createdAt".
    it('sem campo pedido, pergunta ao schema em vez de consultar uma lista', () => {
      expect(buildOrderBy(registry, work(), undefined, 'desc')).toEqual({
        createdAt: 'desc',
      });
    });

    it('cai para o identificador em model sem createdAt', () => {
      const semCreatedAt = registry
        .list()
        .find(
          (model) =>
            !model.fields.some((field) => field.name === 'createdAt') &&
            model.idField === 'id',
        );

      if (!semCreatedAt) {
        return;
      }

      expect(buildOrderBy(registry, semCreatedAt, undefined, 'desc')).toEqual({
        id: 'desc',
      });
    });

    it('recusa ordenar por campo protegido', () => {
      expect(() =>
        buildOrderBy(registry, user(), 'hashedPassword', 'asc'),
      ).toThrow(BadRequestException);
    });
  });
});
