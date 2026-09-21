import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageCleanupService } from '../../common/storage/storage-cleanup.service';
import { TextIndexService } from '../../common/search/text-index.service';
import { MaintenanceTasksService } from './maintenance-tasks.service';
import { BackupService } from '../backup/backup.service';
import { BackupSettingsService } from '../backup/backup-settings.service';
import { BackupHistoryService } from '../backup/backup-history.service';
import { BackupStorageService } from '../backup/backup-storage.service';

describe('MaintenanceTasksService', () => {
  let service: MaintenanceTasksService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let storageCleanup: { cleanupStalePending: jest.Mock };
  let textIndex: { ensureAll: jest.Mock };
  let backup: { executar: jest.Mock };
  let backupSettings: { ler: jest.Mock; listarColecoes: jest.Mock };
  let backupHistory: { iniciar: jest.Mock; concluir: jest.Mock; falhar: jest.Mock };
  let backupStorage: { diagnostico: string | null };

  const model = () => ({
    count: jest.fn().mockResolvedValue(0),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  });

  beforeEach(async () => {
    prisma = {
      storedAsset: model(),
      userToken: model(),
      notification: model(),
      adminAuditLog: model(),
      user: model(),
      composer: model(),
      work: model(),
      workScore: model(),
      assignment: model(),
      blogArticle: model(),
      advertisement: model(),
    };

    storageCleanup = {
      cleanupStalePending: jest.fn().mockResolvedValue({
        pendingExamined: 10,
        uploadedButAbandoned: 3,
        neverUploaded: 7,
        failures: 0,
      }),
    };

    textIndex = {
      ensureAll: jest.fn().mockResolvedValue([
        { collection: 'Work', name: 'work_text_search', ready: true },
        { collection: 'Composer', name: 'composer_text_search', ready: true },
        {
          collection: 'blog_articles',
          name: 'article_text_search',
          ready: false,
          error: 'sem permissão',
        },
      ]),
    };

    backup = {
      executar: jest.fn().mockResolvedValue({
        objectKey: 'backups/backup-2026-09-21.json.gz',
        sizeBytes: 1024,
        documentCount: 10,
        collections: [{ name: 'Work', documents: 10 }],
        verifiedAt: new Date(),
        rotated: [],
        warnings: [],
      }),
    };

    backupSettings = {
      ler: jest
        .fn()
        .mockResolvedValue({ keep: 3, collections: [{ name: 'Work', limit: 10 }] }),
      listarColecoes: jest
        .fn()
        .mockResolvedValue([{ name: 'Work', model: 'Work', documents: 10 }]),
    };

    backupHistory = {
      iniciar: jest.fn().mockResolvedValue('run1'),
      concluir: jest.fn().mockResolvedValue(undefined),
      falhar: jest.fn().mockResolvedValue(undefined),
    };

    backupStorage = { diagnostico: null };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceTasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageCleanupService, useValue: storageCleanup },
        { provide: TextIndexService, useValue: textIndex },
        { provide: BackupService, useValue: backup },
        { provide: BackupSettingsService, useValue: backupSettings },
        { provide: BackupHistoryService, useValue: backupHistory },
        { provide: BackupStorageService, useValue: backupStorage },
      ],
    }).compile();

    service = module.get(MaintenanceTasksService);
  });

  describe('storage.cleanup-pending', () => {
    it('repassa a simulação para o serviço de limpeza', async () => {
      await service.run('storage.cleanup-pending', { dryRun: true });

      expect(storageCleanup.cleanupStalePending).toHaveBeenCalledWith(true);
    });

    it('traduz o relatório', async () => {
      const result = await service.run('storage.cleanup-pending', {
        dryRun: false,
      });

      expect(result.summary).toEqual({
        examinados: 10,
        removidosDoProvedor: 3,
        nuncaEnviados: 7,
        falhas: 0,
      });
    });
  });

  describe('storage.orphan-sweep', () => {
    it('conta como órfão o arquivo cujo dono sumiu', async () => {
      let page = 0;
      prisma.storedAsset.findMany.mockImplementation(({ where }) => {
        if (where.entityType !== 'work' || page > 0) {
          return Promise.resolve([]);
        }
        page += 1;
        return Promise.resolve([
          { id: 'a1', entityId: 'obra-viva', publicId: 'p1' },
          { id: 'a2', entityId: 'obra-morta', publicId: 'p2' },
        ]);
      });
      prisma.work.findMany.mockResolvedValue([{ id: 'obra-viva' }]);

      const result = await service.run('storage.orphan-sweep', {
        dryRun: false,
      });

      expect(result.summary.examinados).toBe(2);
      expect(result.summary.orfaos).toBe(1);
      expect(result.sample).toEqual(['work:obra-morta → p2']);
    });

    // Órfão é sintoma de exclusão em cascata incompleta.
    it('nunca apaga nada', async () => {
      await service.run('storage.orphan-sweep', { dryRun: false });

      expect(prisma.storedAsset.deleteMany).not.toHaveBeenCalled();
    });

    // Dizer "zero órfãos" sem contar o que não deu para verificar seria a
    // conclusão errada.
    it('avisa sobre arquivos ativos sem dono declarado', async () => {
      prisma.storedAsset.count.mockResolvedValue(4);

      const result = await service.run('storage.orphan-sweep', {
        dryRun: false,
      });

      expect(result.summary.semDonoDeclarado).toBe(4);
      expect(result.warnings?.[0]).toContain('4 arquivos');
    });
  });

  describe('tokens.prune', () => {
    it('na simulação, conta e não apaga', async () => {
      prisma.userToken.count.mockResolvedValue(120);

      const result = await service.run('tokens.prune', { dryRun: true });

      expect(result.summary.aRemover).toBe(120);
      expect(prisma.userToken.deleteMany).not.toHaveBeenCalled();
    });

    it('aplicando, apaga e relata', async () => {
      prisma.userToken.deleteMany.mockResolvedValue({ count: 120 });

      const result = await service.run('tokens.prune', { dryRun: false });

      expect(result.summary.removidos).toBe(120);
    });

    it('usa a retenção padrão do catálogo quando não vem uma', async () => {
      await service.run('tokens.prune', { dryRun: true });

      expect(prisma.userToken.count.mock.calls[0][0].where.OR).toHaveLength(2);
    });
  });

  describe('notifications.prune', () => {
    // Medido nesta base: `lt: <data>` compara por tipo BSON e não casa com
    // campo ausente. Notificação sem `expiresAt` nunca vence, e sem `readAt`
    // nunca envelhece — as duas condições dependem do campo existir.
    it('as duas regras exigem um campo de data presente', async () => {
      await service.run('notifications.prune', { dryRun: true });

      const { OR } = prisma.notification.count.mock.calls[0][0].where;

      expect(OR).toHaveLength(2);
      for (const branch of OR) {
        const campo = 'expiresAt' in branch ? branch.expiresAt : branch.readAt;
        expect(campo.lt).toBeInstanceOf(Date);
      }
    });

    // Um convite que o aluno não abriu vale exatamente por não ter sido visto.
    it('nunca remove notificação não lida por idade', async () => {
      await service.run('notifications.prune', { dryRun: true });

      const { OR } = prisma.notification.count.mock.calls[0][0].where;
      const porIdade = OR.find(
        (branch: Record<string, unknown>) => 'readAt' in branch,
      );

      expect(porIdade.status.in).toEqual(['READ', 'DISMISSED']);
    });

    // Prazo vencido vale mesmo para não lida: ela já está invisível para o
    // dono desde que o prazo passou, porque o filtro de leitura a esconde.
    it('remove o que já tem prazo vencido, sem olhar o status', async () => {
      await service.run('notifications.prune', { dryRun: true });

      const { OR } = prisma.notification.count.mock.calls[0][0].where;
      const porPrazo = OR.find(
        (branch: Record<string, unknown>) => 'expiresAt' in branch,
      );

      expect(porPrazo.expiresAt.lt).toBeInstanceOf(Date);
      expect(porPrazo.status).toBeUndefined();
    });
  });

  describe('audit.prune', () => {
    const diasDoCorte = (call: number) => {
      const cutoff =
        prisma.adminAuditLog.count.mock.calls[call][0].where.createdAt.lt;

      return Math.round((Date.now() - cutoff.getTime()) / 86_400_000);
    };

    // **RN-5: a retenção é por classe de ação.** Três consultas, uma por
    // classe, cada uma com o seu corte.
    it('aplica um corte por classe de ação', async () => {
      await service.run('audit.prune', { dryRun: true });

      expect(prisma.adminAuditLog.count).toHaveBeenCalledTimes(3);
      expect(diasDoCorte(0)).toBe(90);
      expect(diasDoCorte(1)).toBe(1825);
      expect(diasDoCorte(2)).toBe(730);
    });

    it('separa as classes pela ação, e o resto é tudo que sobra', async () => {
      await service.run('audit.prune', { dryRun: true });

      const [leitura, graves, resto] = prisma.adminAuditLog.count.mock.calls;

      expect(leitura[0].where.action.in).toContain('database.records.read');
      expect(graves[0].where.action.in).toContain('user.export');
      expect(resto[0].where.action.notIn).toContain('database.records.read');
      expect(resto[0].where.action.notIn).toContain('user.export');
    });

    // Encurtar retenção de auditoria escrevendo um número na requisição seria
    // contornar a política pela chamada.
    it('a retenção pedida é piso, não prazo', async () => {
      await service.run('audit.prune', { dryRun: true, retentionDays: 30 });

      expect(diasDoCorte(0)).toBe(90);
    });

    it('uma retenção maior que a política vale para todas as classes', async () => {
      await service.run('audit.prune', { dryRun: true, retentionDays: 3650 });

      expect(diasDoCorte(0)).toBe(3650);
      expect(diasDoCorte(1)).toBe(3650);
      expect(diasDoCorte(2)).toBe(3650);
    });

    it('devolve o total e a quebra por classe', async () => {
      const result = await service.run('audit.prune', { dryRun: true });

      expect(result.summary).toMatchObject({
        retencaoLeituraEmDias: 90,
        retencaoEscritaEmDias: 730,
        retencaoGravesEmDias: 1825,
      });
      expect(result.summary).toHaveProperty('leitura');
      expect(result.summary).toHaveProperty('graves');
    });
  });

  describe('search.reindex', () => {
    // `prisma db push` derruba os índices de texto; até a subida seguinte a
    // busca varre 207 mil obras por consulta.
    it('recria os índices e relata o que não ficou pronto', async () => {
      const result = await service.run('search.reindex', { dryRun: false });

      expect(textIndex.ensureAll).toHaveBeenCalled();
      expect(result.summary).toEqual({ colecoes: 3, prontos: 2 });
      expect(result.warnings).toEqual(['blog_articles: sem permissão']);
    });
  });

  it('mede a duração de toda execução', async () => {
    const result = await service.run('search.reindex', { dryRun: false });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.taskId).toBe('search.reindex');
  });

  describe('database.backup', () => {
    it('roda com a configuração gravada e registra o resultado', async () => {
      const resultado = await service.run('database.backup', { dryRun: false });

      expect(backup.executar).toHaveBeenCalledWith(
        [{ name: 'Work', limit: 10 }],
        3,
        expect.any(Date),
        expect.any(Set),
      );
      expect(backupHistory.concluir).toHaveBeenCalledWith(
        'run1',
        expect.objectContaining({ documentCount: 10 }),
      );
      expect(resultado.summary.documentos).toBe(10);
    });

    // Sem bucket, avisar é mais útil do que estourar: a tela mostra o que falta.
    it('avisa quando o armazenamento não está configurado, sem tentar nada', async () => {
      backupStorage.diagnostico = 'Falta BACKUP_R2_BUCKET.';

      const resultado = await service.run('database.backup', { dryRun: false });

      expect(backup.executar).not.toHaveBeenCalled();
      expect(backupHistory.iniciar).not.toHaveBeenCalled();
      expect(resultado.warnings).toEqual(['Falta BACKUP_R2_BUCKET.']);
    });

    it('avisa quando nenhuma coleção foi selecionada', async () => {
      backupSettings.ler.mockResolvedValue({ keep: 3, collections: [] });

      const resultado = await service.run('database.backup', { dryRun: false });

      expect(backup.executar).not.toHaveBeenCalled();
      expect(resultado.warnings?.[0]).toContain('Nenhuma coleção selecionada');
    });

    // O histórico é o que responde "o último backup funcionou?".
    it('registra a falha no histórico antes de propagá-la', async () => {
      backup.executar.mockRejectedValue(new Error('bucket recusou'));

      await expect(
        service.run('database.backup', { dryRun: false }),
      ).rejects.toThrow('bucket recusou');

      expect(backupHistory.falhar).toHaveBeenCalledWith('run1', 'bucket recusou');
    });
  });
});