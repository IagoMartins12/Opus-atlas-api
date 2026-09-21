import { NotFoundException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { PublicTeachersController } from './public-teachers.controller';
import { PublicTeachersService } from './public-teachers.service';

const YEAR = 365 * 24 * 60 * 60 * 1000;

const teacher = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  bio: 'Bio',
  publicBio: null,
  specialties: ['Técnica'],
  instruments: ['Piano'],
  experience: null,
  education: null,
  achievements: null,
  website: null,
  socialMedia: null,
  highlightedWorks: null,
  teachingMethod: 'Método',
  ageGroups: ['Adultos'],
  skillLevels: ['Iniciante'],
  isVerified: true,
  averageRating: 4.5,
  totalReviews: 3,
  totalStudents: 2,
  totalLessons: 10,
  completionRate: 90,
  createdAt: new Date(Date.now() - 3.5 * YEAR),
  profileImage: null,
  status: 'ACTIVE',
  maxStudentsPerWeek: 5,
  defaultLessonDuration: 60,
  user: {
    id: 'u1',
    firstName: 'Ana',
    lastName: 'Lima',
    email: 'ana@x.com',
    phone: null,
    city: 'Recife',
    state: 'PE',
    image: 'foto.jpg',
  },
  ...overrides,
});

describe('PublicTeachersService', () => {
  let prisma: {
    teacher: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
    };
  };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: PublicTeachersService;

  beforeEach(() => {
    prisma = {
      teacher: {
        findMany: jest.fn().mockResolvedValue([teacher()]),
        findFirst: jest.fn().mockResolvedValue(teacher()),
        count: jest.fn().mockResolvedValue(20),
        aggregate: jest.fn().mockResolvedValue({
          _avg: { averageRating: 4.2 },
          _sum: { totalStudents: 30 },
        }),
      },
    };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    service = new PublicTeachersService(
      prisma as unknown as PrismaService,
      cache as unknown as Cache,
    );
  });

  describe('diretório', () => {
    it('só perfis públicos e ativos; estatísticas sobre o conjunto todo', async () => {
      const result = await service.findAll({});

      expect(prisma.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isPublicProfile: true, status: 'ACTIVE' },
          take: 12,
          skip: 0,
        }),
      );
      expect(result.stats).toEqual({
        totalTeachers: 20,
        verifiedTeachers: 20,
        averageRating: 4.2,
        totalActiveStudents: 30,
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 12,
        total: 20,
        hasMore: true,
      });
      // O id público é o do usuário.
      expect(result.teachers[0]).toMatchObject({
        id: 'u1',
        name: 'Ana Lima',
        profileImage: 'foto.jpg',
        publicBio: 'Bio',
        location: 'Recife, PE',
        yearsExperience: 3,
      });
    });

    it('filtros e localização escapada', async () => {
      await service.findAll({
        verified: true,
        instrument: 'Piano',
        specialty: 'Técnica',
        skillLevel: 'Iniciante',
        ageGroup: 'Adultos',
        location: 'S.P',
        sortBy: 'students',
      } as never);

      const [{ where, orderBy }] = prisma.teacher.findMany.mock.calls[0];
      expect(where).toMatchObject({
        isVerified: true,
        instruments: { has: 'Piano' },
        specialties: { has: 'Técnica' },
        skillLevels: { has: 'Iniciante' },
        ageGroups: { has: 'Adultos' },
      });
      expect(where.user.OR[0].city.contains).toBe('S\\.P');
      expect(orderBy[0]).toEqual({ totalStudents: 'desc' });
    });

    it.each([
      ['experience', { createdAt: 'asc' }],
      ['name', { user: { firstName: 'asc' } }],
      ['rating', { averageRating: 'desc' }],
    ])('ordenação %s', async (sortBy, first) => {
      await service.findAll({ sortBy } as never);

      expect(prisma.teacher.findMany.mock.calls[0][0].orderBy[0]).toEqual(
        first,
      );
    });

    it('sem avaliações, média e alunos zerados; cache evita o banco', async () => {
      prisma.teacher.aggregate.mockResolvedValue({
        _avg: { averageRating: null },
        _sum: { totalStudents: null },
      });
      const result = await service.findAll({ page: 2, limit: 5 } as never);
      expect(result.stats).toMatchObject({
        averageRating: 0,
        totalActiveStudents: 0,
      });

      cache.get.mockResolvedValue({ cached: true });
      await expect(service.findAll({})).resolves.toEqual({ cached: true });
    });
  });

  it('opções de filtro contam e ordenam por frequência', async () => {
    prisma.teacher.findMany.mockResolvedValue([
      {
        instruments: ['Piano', 'Violino'],
        specialties: [],
        skillLevels: ['A'],
        ageGroups: [],
        user: { city: 'Recife', state: null },
      },
      {
        instruments: ['Piano'],
        specialties: ['X'],
        skillLevels: [],
        ageGroups: ['B'],
        user: { city: null, state: null },
      },
    ]);

    const options = await service.getFilterOptions();

    expect(options.instruments).toEqual([
      { name: 'Piano', count: 2 },
      { name: 'Violino', count: 1 },
    ]);
    expect(options.locations).toEqual([{ name: 'Recife', count: 1 }]);

    cache.get.mockResolvedValue({ cached: true });
    await expect(service.getFilterOptions()).resolves.toEqual({ cached: true });
  });

  describe('perfil', () => {
    it('biografia pública, contato e vaga', async () => {
      prisma.teacher.findFirst.mockResolvedValue(
        teacher({
          publicBio: 'Pública',
          user: { ...teacher().user, phone: '81999' },
        }),
      );

      const detail = await service.findOne('u1');

      expect(prisma.teacher.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', isPublicProfile: true, status: 'ACTIVE' },
        }),
      );
      expect(detail).toMatchObject({
        fullBio: 'Pública',
        contactPreferences: {
          preferredMethod: 'whatsapp',
          acceptingStudents: true,
        },
      });
    });

    it('sem biografia nenhuma, lotado, sem telefone', async () => {
      prisma.teacher.findFirst.mockResolvedValue(
        teacher({
          bio: null,
          publicBio: null,
          totalStudents: 5,
          createdAt: new Date(),
          user: { ...teacher().user, city: null, state: null },
        }),
      );

      const detail = await service.findOne('u1');

      expect(detail).toMatchObject({
        fullBio: 'Biografia não disponível.',
        location: null,
        yearsExperience: 1,
        contactPreferences: {
          preferredMethod: 'email',
          acceptingStudents: false,
        },
      });
    });

    it('perfil privado ou inexistente é 404; cache evita o banco', async () => {
      prisma.teacher.findFirst.mockResolvedValue(null);
      await expect(service.findOne('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      cache.get.mockResolvedValue({ id: 'cache' });
      await expect(service.findOne('u1')).resolves.toEqual({ id: 'cache' });
    });
  });
});

describe('PublicTeachersController', () => {
  it('repassa ao serviço', async () => {
    const service = {
      findAll: jest.fn().mockResolvedValue('findAll'),
      getFilterOptions: jest.fn().mockResolvedValue('options'),
      findOne: jest.fn().mockResolvedValue('findOne'),
    };
    const controller = new PublicTeachersController(
      service as unknown as PublicTeachersService,
    );

    await expect(controller.findAll({})).resolves.toBe('findAll');
    await expect(controller.getFilterOptions()).resolves.toBe('options');
    await expect(controller.findOne('u1')).resolves.toBe('findOne');
  });
});
