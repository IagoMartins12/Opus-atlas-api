import { OrphanFilesService } from './orphan-files.service';

const asset = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  status: 'ACTIVE',
  publicId: 'obras/x',
  secureUrl: 'https://res.cloudinary.com/x.jpg',
  resourceType: 'IMAGE',
  kind: 'WORK_IMAGE',
  format: 'jpg',
  bytes: 1000,
  width: 10,
  height: 10,
  folder: 'obras',
  entityType: 'work',
  entityId: 'w-removida',
  ownerId: 'u1',
  createdAt: new Date('2026-09-10T00:00:00.000Z'),
  ...over,
});

describe('OrphanFilesService', () => {
  let prisma: {
    storedAsset: { findMany: jest.Mock; findUnique: jest.Mock };
    work: { findMany: jest.Mock };
    learned: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
    adminAuditLog: { findMany: jest.Mock };
  };
  let storage: { deleteAsset: jest.Mock };
  let service: OrphanFilesService;

  beforeEach(() => {
    prisma = {
      storedAsset: {
        findMany: jest.fn(
          (args: { where: { entityType?: string; OR?: unknown } }) =>
            Promise.resolve(
              args.where.entityType === 'work' && !('cursor' in args)
                ? [asset(), asset({ id: 'a2', entityId: 'w-viva' })]
                : [],
            ),
        ),
        findUnique: jest.fn().mockResolvedValue({ status: 'DELETED' }),
      },
      work: { findMany: jest.fn().mockResolvedValue([{ id: 'w-viva' }]) },
      learned: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u1', firstName: 'Ana', email: 'a@x' }]),
      },
      adminAuditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            entityId: 'w-removida',
            metadata: { alvo: 'Sonata nº 3' },
            createdAt: new Date('2026-09-20'),
          },
        ]),
      },
    };
    storage = { deleteAsset: jest.fn().mockResolvedValue(undefined) };
    service = new OrphanFilesService(prisma as never, storage as never);
  });

  it('lista só o arquivo cujo dono sumiu, com quem enviou e o nome do registro removido', async () => {
    const r = await service.listar({ tipo: 'work' });

    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      id: 'a1',
      motivo: 'dono-removido',
      url: 'https://res.cloudinary.com/x.jpg',
      dono: { tipo: 'work', id: 'w-removida', nome: 'Sonata nº 3' },
      enviadoPor: { id: 'u1', nome: 'Ana' },
    });
    expect(r.resumo).toEqual({ total: 1, bytes: 1000, porTipo: { work: 1 } });
  });

  it('com datas, filtra pela data do envio; sem datas, não filtra', async () => {
    await service.listar({ tipo: 'work', de: '2026-10-01T00:00:00.000Z' });
    expect(
      prisma.storedAsset.findMany.mock.calls[0][0].where.createdAt,
    ).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
    });

    prisma.storedAsset.findMany.mockClear();
    await service.listar({ tipo: 'work' });
    expect(
      prisma.storedAsset.findMany.mock.calls[0][0].where.createdAt,
    ).toBeUndefined();
  });

  // Entre a lista e o clique, o dono pode ter voltado.
  it('remover confere de novo: o que tem dono vivo é recusado', async () => {
    prisma.storedAsset.findMany.mockResolvedValueOnce([
      asset(),
      asset({ id: 'a2', entityId: 'w-viva' }),
    ]);

    const r = await service.remover(['a1', 'a2', 'a3']);

    expect(storage.deleteAsset).toHaveBeenCalledTimes(1);
    expect(storage.deleteAsset).toHaveBeenCalledWith('a1');
    expect(r.removidos).toBe(1);
    expect(r.recusados.map((x) => x.id).sort()).toEqual(['a2', 'a3']);
  });

  it('sem escolha ou acima do teto é recusado', async () => {
    await expect(service.remover([])).rejects.toThrow('Escolha ao menos');
    await expect(
      service.remover(Array.from({ length: 201 }, (_, i) => `id${i}`)),
    ).rejects.toThrow('No máximo 200');
  });

  describe('vídeo de performance fora de peça', () => {
    const video = (over: Record<string, unknown> = {}) =>
      asset({
        id: 'v1',
        kind: 'PERFORMANCE_VIDEO',
        resourceType: 'VIDEO',
        secureUrl: 'https://res.cloudinary.com/v1.mp4',
        entityId: 'w-viva',
        ...over,
      });

    it('lista o vídeo que nenhuma peça usa, mesmo com a obra existindo', async () => {
      prisma.storedAsset.findMany.mockImplementation(
        (args: { where: { kind?: string } }) =>
          Promise.resolve(
            args.where.kind === 'PERFORMANCE_VIDEO' ? [video()] : [],
          ),
      );

      const r = await service.listar({ tipo: 'video-sem-peca' });

      expect(r.items).toHaveLength(1);
      expect(r.items[0]).toMatchObject({ id: 'v1', motivo: 'video-sem-peca' });
      expect(r.resumo.porTipo).toEqual({ 'video-sem-peca': 1 });
    });

    it('não lista o vídeo que está numa peça', async () => {
      prisma.storedAsset.findMany.mockImplementation(
        (args: { where: { kind?: string } }) =>
          Promise.resolve(
            args.where.kind === 'PERFORMANCE_VIDEO' ? [video()] : [],
          ),
      );
      prisma.learned.findMany.mockResolvedValue([
        { videoUrl: 'https://res.cloudinary.com/v1.mp4' },
      ]);

      const r = await service.listar({ tipo: 'video-sem-peca' });

      expect(r.items).toHaveLength(0);
    });

    it('remove o vídeo fora de peça, e recusa o que voltou a uma peça', async () => {
      prisma.storedAsset.findMany.mockResolvedValue([
        video(),
        video({ id: 'v2', secureUrl: 'https://res.cloudinary.com/v2.mp4' }),
      ]);
      prisma.learned.findMany.mockResolvedValue([
        { videoUrl: 'https://res.cloudinary.com/v2.mp4' },
      ]);

      const r = await service.remover(['v1', 'v2']);

      expect(storage.deleteAsset).toHaveBeenCalledWith('v1');
      expect(storage.deleteAsset).not.toHaveBeenCalledWith('v2');
      expect(r.recusados).toEqual([
        { id: 'v2', motivo: 'O vídeo está numa peça' },
      ]);
    });
  });
});
