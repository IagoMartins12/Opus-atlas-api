import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../../portal/notifications/notifications.service';
import { ModerationService } from './moderation.service';

describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: {
    uploadModeration: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    composer: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    work: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    workScore: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    blogComment: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let notifications: { notify: jest.Mock; notifyMany: jest.Mock };
  let storage: { deleteByEntity: jest.Mock };
  let cache: { invalidateMany: jest.Mock };

  const context = { ipAddress: '203.0.113.10', userAgent: 'jest' };

  const dto = {
    entityType: 'work' as const,
    category: 'wrong_data' as const,
    entityId: 'work-1',
    reason: 'A data de composição está errada',
  };

  beforeEach(async () => {
    prisma = {
      uploadModeration: {
        create: jest.fn().mockResolvedValue({ id: 'mod-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'mod-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      } as never,
      composer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'composer-1' }),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      work: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'work-1', createdBy: 'autor-1' }),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workScore: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'score-1', uploadedBy: 'autor-1' }),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      blogComment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'comment-1',
          userId: 'comentarista-1',
          status: 'APPROVED',
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    storage = { deleteByEntity: jest.fn().mockResolvedValue(0) };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };

    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      notifyMany: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: AppCacheService, useValue: cache },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(ModerationService);
  });

  describe('report', () => {
    it('registra a denúncia com o contexto da requisição', async () => {
      await service.report('user-1', dto, context);

      expect(prisma.uploadModeration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'work',
          entityId: 'work-1',
          reportedBy: 'user-1',
          status: 'pending',
          ipAddress: '203.0.113.10',
        }),
      });
    });

    it('recusa denúncia de conteúdo inexistente', async () => {
      prisma.work.findUnique.mockResolvedValue(null);

      await expect(service.report('user-1', dto, context)).rejects.toThrow(
        NotFoundException,
      );
    });

    // Sem isso, uma pessoa sozinha afunda a fila com o mesmo item repetido.
    it('recusa denúncia repetida do mesmo usuário sobre o mesmo item', async () => {
      prisma.uploadModeration.findFirst.mockResolvedValue({ id: 'mod-antiga' });

      await expect(service.report('user-1', dto, context)).rejects.toThrow(
        ConflictException,
      );
    });

    it('permite denúncia de outro usuário sobre o mesmo item', async () => {
      prisma.uploadModeration.findFirst.mockResolvedValue(null);

      await expect(
        service.report('user-2', dto, context),
      ).resolves.toBeDefined();
    });
  });

  describe('resolve', () => {
    const pending = {
      id: 'mod-1',
      entityType: 'work',
      entityId: 'work-1',
      status: 'pending',
    };

    it('aprova sem remover o conteúdo', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue(pending);

      await service.resolve('moderador', 'mod-1', { action: 'approve' });

      expect(prisma.work.delete).not.toHaveBeenCalled();
      expect(prisma.uploadModeration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'approved',
            moderatedBy: 'moderador',
          }),
        }),
      );
    });

    it('marca como rejeitada quando a denúncia é descartada', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue(pending);

      await service.resolve('moderador', 'mod-1', { action: 'reject' });

      expect(prisma.uploadModeration.update.mock.calls[0][0].data.status).toBe(
        'rejected',
      );
    });

    // Antes, apagar só derrubava a linha do banco e o arquivo seguia acessível
    // por URL direta — conteúdo removido por violação continuava no ar.
    it('remove os arquivos junto com o conteúdo ao apagar', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue(pending);

      await service.resolve('moderador', 'mod-1', {
        action: 'delete',
        notes: 'Cópia protegida por direito autoral',
      });

      expect(storage.deleteByEntity).toHaveBeenCalledWith('work', 'work-1');
      expect(prisma.work.delete).toHaveBeenCalledWith({
        where: { id: 'work-1' },
      });
    });

    it('usa a entidade de armazenamento correta para partitura', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue({
        ...pending,
        entityType: 'score',
        entityId: 'score-1',
      });

      await service.resolve('moderador', 'mod-1', {
        action: 'delete',
        notes: 'Cópia protegida por direito autoral',
      });

      expect(storage.deleteByEntity).toHaveBeenCalledWith(
        'workScore',
        'score-1',
      );
    });

    it('invalida o cache do catálogo ao apagar conteúdo', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue(pending);

      await service.resolve('moderador', 'mod-1', {
        action: 'delete',
        notes: 'Cópia protegida por direito autoral',
      });

      expect(cache.invalidateMany).toHaveBeenCalled();
    });

    it('recusa denúncia já processada', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue({
        ...pending,
        status: 'approved',
      });

      await expect(
        service.resolve('moderador', 'mod-1', { action: 'approve' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('responde 404 para denúncia inexistente', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('moderador', 'sumiu', { action: 'approve' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // **RN-4: denúncia grave dispara providência imediata.**
  describe('denúncia grave', () => {
    const grave = { ...dto, category: 'copyright' as const };

    it('a prioridade vem da categoria, não de quem denuncia', async () => {
      await service.report('user-1', grave, context);

      expect(
        prisma.uploadModeration.create.mock.calls[0][0].data,
      ).toMatchObject({ category: 'copyright', priority: 'urgent' });
    });

    it('categoria comum entra com a prioridade dela', async () => {
      await service.report('user-1', dto, context);

      expect(
        prisma.uploadModeration.create.mock.calls[0][0].data.priority,
      ).toBe('normal');
    });

    // A partitura sai do catálogo na hora: `isActive: false` já é respeitado
    // pela leitura pública, e é o arquivo que a reclamação atinge.
    it('partitura denunciada por direito autoral sai do catálogo', async () => {
      await service.report(
        'user-1',
        { ...grave, entityType: 'score', entityId: 'score-1' },
        context,
      );

      expect(prisma.workScore.update).toHaveBeenCalledWith({
        where: { id: 'score-1' },
        data: { isActive: false },
      });
    });

    // Obra e compositor são ficha, não arquivo: derrubá-las automaticamente
    // daria a qualquer usuário autenticado um botão para sumir com dado.
    it('obra denunciada fica no catálogo, marcada como contestada', async () => {
      await service.report('user-1', grave, context);

      expect(prisma.work.update).toHaveBeenCalledWith({
        where: { id: 'work-1' },
        data: { verificationStatus: 'disputed' },
      });
      expect(prisma.work.delete).not.toHaveBeenCalled();
    });

    it('o selo de verificação não é mexido', async () => {
      await service.report('user-1', grave, context);

      expect(prisma.work.update.mock.calls[0][0].data).not.toHaveProperty(
        'isVerified',
      );
    });

    // Retirar em silêncio é como o autor descobre pela ausência.
    it('avisa quem enviou o conteúdo', async () => {
      await service.report('user-1', grave, context);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'autor-1' }),
      );
    });

    it('conteúdo sem autor conhecido não gera aviso', async () => {
      prisma.work.findUnique.mockResolvedValue({ id: 'work-1' });

      await service.report('user-1', grave, context);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('categoria comum não retém nem avisa', async () => {
      await service.report('user-1', dto, context);

      expect(prisma.work.update).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('soltar a retenção', () => {
    beforeEach(() => {
      prisma.uploadModeration.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: 'pending',
        entityType: 'work',
        entityId: 'work-1',
      });
    });

    // Sem isso, uma denúncia grave arquivada deixaria o conteúdo fora do
    // catálogo para sempre: improcedente teria o mesmo efeito que procedente.
    it('arquivar a denúncia devolve o conteúdo', async () => {
      await service.resolve('moderador', 'mod-1', { action: 'reject' });

      expect(prisma.work.updateMany).toHaveBeenCalledWith({
        where: { id: 'work-1', verificationStatus: 'disputed' },
        data: { verificationStatus: 'pending' },
      });
    });

    // Duas denúncias e uma decisão não podem devolver o conteúdo.
    it('outra denúncia grave pendente mantém a retenção', async () => {
      prisma.uploadModeration.count.mockResolvedValue(1);

      await service.resolve('moderador', 'mod-1', { action: 'approve' });

      expect(prisma.work.updateMany).not.toHaveBeenCalled();
    });

    it('apagar o conteúdo não tenta soltar retenção', async () => {
      await service.resolve('moderador', 'mod-1', {
        action: 'delete',
        notes: 'Cópia protegida',
      });

      expect(prisma.work.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('justificativa (RN-4)', () => {
    beforeEach(() => {
      prisma.uploadModeration.findUnique.mockResolvedValue({
        id: 'mod-1',
        status: 'pending',
        entityType: 'work',
        entityId: 'work-1',
      });
    });

    // Aprovar em silêncio tudo bem: nada se perde. Derrubar o trabalho de
    // alguém sem uma linha dizendo por quê, não.
    it('remover sem justificativa é recusado', async () => {
      await expect(
        service.resolve('moderador', 'mod-1', { action: 'delete' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.work.delete).not.toHaveBeenCalled();
    });

    it('justificativa em branco não conta', async () => {
      await expect(
        service.resolve('moderador', 'mod-1', {
          action: 'delete',
          notes: '   ',
        }),
      ).rejects.toThrow(/justificativa/);
    });

    it('aprovar não exige justificativa', async () => {
      await expect(
        service.resolve('moderador', 'mod-1', { action: 'approve' }),
      ).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('pagina e resolve o conteúdo denunciado de cada linha', async () => {
      prisma.uploadModeration.findMany.mockResolvedValue([
        {
          id: 'mod-1',
          entityType: 'work',
          entityId: 'work-1',
          category: 'wrong_data',
          priority: 'normal',
          createdAt: new Date(),
          reporter: { id: 'user-1' },
          moderator: null,
        },
      ]);
      prisma.uploadModeration.count.mockResolvedValue(1);

      const result = await service.list({
        page: 1,
        limit: 20,
        status: 'pending',
      });

      expect(result.reports[0].entity).toEqual({
        id: 'work-1',
        createdBy: 'autor-1',
      });
      expect(result.pagination.totalPages).toBe(1);
    });
  });

  describe('resolução em lote', () => {
    // A cópia do laço na rota de lote do legado divergiu da original: não
    // removia os arquivos e não invalidava o cache. Reusar a singular é o que
    // impede a divergência.
    it('aplica a resolução singular a cada denúncia', async () => {
      const resolve = jest
        .spyOn(service, 'resolve')
        .mockResolvedValue({} as never);

      await service.resolveMany('moderador-1', ['m1', 'm2'], {
        action: 'approve',
      });

      expect(resolve).toHaveBeenCalledTimes(2);
      expect(resolve.mock.calls[0]).toEqual([
        'moderador-1',
        'm1',
        { action: 'approve' },
      ]);
    });

    // Interromper no primeiro erro deixaria o moderador sem saber o que foi
    // feito e o que não foi.
    it('uma falha não derruba as outras', async () => {
      jest
        .spyOn(service, 'resolve')
        .mockResolvedValueOnce({} as never)
        .mockRejectedValueOnce(new Error('Esta denúncia já foi processada'))
        .mockResolvedValueOnce({} as never);

      const result = await service.resolveMany(
        'moderador-1',
        ['m1', 'm2', 'm3'],
        { action: 'delete', notes: 'Cópia protegida por direito autoral' },
      );

      expect(result.resolved).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.outcomes[1]).toEqual({
        moderationId: 'm2',
        status: 'failed',
        reason: 'Esta denúncia já foi processada',
      });
    });

    it('relata quantas foram pedidas', async () => {
      jest.spyOn(service, 'resolve').mockResolvedValue({} as never);

      const result = await service.resolveMany('moderador-1', ['m1'], {
        action: 'reject',
      });

      expect(result).toMatchObject({
        action: 'reject',
        requested: 1,
        resolved: 1,
        failed: 0,
      });
    });
  });

  // RN-4 nomeia os comentários: a denúncia deles entra na mesma fila.
  describe('comentário do blog', () => {
    const commentReport = (category: 'illegal' | 'offensive') => ({
      entityType: 'blog-comment' as const,
      entityId: 'comment-1',
      category,
      reason: 'Conteúdo ofensivo ou impróprio',
    });

    it('denúncia comum não tira o comentário do ar', async () => {
      await service.report('user-1', commentReport('offensive'), context);

      expect(prisma.blogComment.update).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('denúncia grave tira do ar e avisa quem escreveu', async () => {
      await service.report('user-1', commentReport('illegal'), context);

      expect(prisma.blogComment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { status: 'FLAGGED', isFlagged: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'comentarista-1',
          title: 'Seu comentário saiu do ar para análise',
        }),
      );
    });

    // Apagar levaria junto as respostas de outras pessoas e o texto julgado.
    it('remover pela fila tira do ar, sem apagar nem mexer em arquivo', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue({
        id: 'mod-1',
        entityType: 'blog-comment',
        entityId: 'comment-1',
        status: 'pending',
      });

      await service.resolve('moderador-1', 'mod-1', {
        action: 'delete',
        notes: 'Ofensa pessoal a outro leitor',
      });

      expect(prisma.blogComment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: expect.objectContaining({ status: 'REJECTED', isFlagged: false }),
      });
      expect(storage.deleteByEntity).not.toHaveBeenCalled();
    });

    it('arquivar a denúncia devolve o comentário ao ar', async () => {
      prisma.uploadModeration.findUnique.mockResolvedValue({
        id: 'mod-1',
        entityType: 'blog-comment',
        entityId: 'comment-1',
        status: 'pending',
      });

      await service.resolve('moderador-1', 'mod-1', { action: 'reject' });

      expect(prisma.blogComment.updateMany).toHaveBeenCalledWith({
        where: { id: 'comment-1', status: 'FLAGGED' },
        data: { status: 'APPROVED', isFlagged: false },
      });
    });

    // Decidido pelo painel do blog, a denúncia não pode seguir pendente.
    it('fecha as denúncias pendentes de um item decidido por outro caminho', async () => {
      const closed = await service.closePendingFor({
        entityType: 'blog-comment',
        entityId: 'comment-1',
        moderatorId: 'moderador-1',
        resolution: 'delete',
        notes: 'Marcado como spam',
      });

      expect(closed).toBe(2);
      expect(
        (prisma.uploadModeration as unknown as { updateMany: jest.Mock })
          .updateMany,
      ).toHaveBeenCalledWith({
        where: {
          entityType: 'blog-comment',
          entityId: 'comment-1',
          status: 'pending',
        },
        data: expect.objectContaining({
          status: 'approved',
          resolution: 'delete',
          moderatedBy: 'moderador-1',
        }),
      });
    });
  });
});
