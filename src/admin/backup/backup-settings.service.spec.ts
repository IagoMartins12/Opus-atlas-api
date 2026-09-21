import { PrismaService } from '../../prisma/prisma.service';
import { BackupSettingsService } from './backup-settings.service';

function prismaCom(gravado: unknown) {
  return {
    backupSettings: {
      findFirst: jest.fn(() => Promise.resolve(gravado)),
      update: jest.fn(() => Promise.resolve({})),
      create: jest.fn(() => Promise.resolve({})),
    },
    $runCommandRaw: jest.fn(() => Promise.resolve({ n: 42 })),
  } as unknown as PrismaService;
}

describe('BackupSettingsService', () => {
  it('sem configuração, devolve o padrão e nenhuma coleção', async () => {
    const service = new BackupSettingsService(prismaCom(null));

    await expect(service.ler()).resolves.toEqual({ keep: 3, collections: [] });
  });

  it('lê o que foi gravado', async () => {
    const service = new BackupSettingsService(
      prismaCom({
        keep: 5,
        collections: [
          { name: 'Work', limit: 1000 },
          { name: 'Composer', limit: null },
        ],
      }),
    );

    await expect(service.ler()).resolves.toEqual({
      keep: 5,
      collections: [
        { name: 'Work', limit: 1000 },
        { name: 'Composer', limit: null },
      ],
    });
  });

  /**
   * Configuração corrompida vira lista vazia — e a tarefa então recusa rodar
   * dizendo que nada foi selecionado. O contrário (aceitar o que veio) faria
   * o backup exportar algo aleatório, com cara de sucesso.
   */
  it('descarta entrada malformada', async () => {
    const service = new BackupSettingsService(
      prismaCom({
        keep: 3,
        collections: [
          { name: 'Work', limit: 10 },
          { limit: 5 },
          'Composer',
          null,
          { name: '', limit: 1 },
          { name: 'Epoch', limit: -3 },
        ],
      }),
    );

    await expect(service.ler()).resolves.toEqual({
      keep: 3,
      collections: [
        { name: 'Work', limit: 10 },
        // limite negativo não é limite: vira "tudo".
        { name: 'Epoch', limit: null },
      ],
    });
  });

  it('lista as coleções do schema com a contagem', async () => {
    const service = new BackupSettingsService(prismaCom(null));
    const colecoes = await service.listarColecoes();

    expect(colecoes.length).toBeGreaterThan(50);
    expect(colecoes.every((c) => c.documents === 42)).toBe(true);
    // O nome no banco é o que vai no arquivo; o model é o que a tela mostra.
    expect(colecoes.find((c) => c.model === 'BlogArticle')?.name).toBe(
      'blog_articles',
    );
  });
});
