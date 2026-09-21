import { gunzipSync, gzipSync } from 'zlib';
import { PrismaService } from '../../prisma/prisma.service';
import { BackupService } from './backup.service';
import {
  BackupStorageService,
  ArquivoDeBackup,
} from './backup-storage.service';

/** Um banco de mentira que responde `find` e `getMore` como o Mongo. */
function prismaCom(colecoes: Record<string, Record<string, unknown>[]>) {
  // Responde como o Mongo responde à paginação por `_id`: a partir do último
  // visto, em ordem, até o limite do lote.
  const runCommandRaw = jest.fn((comando: Record<string, unknown>) => {
    if (!('find' in comando)) return Promise.resolve({});

    const nome = comando.find as string;
    const limite = (comando.limit as number) ?? Number.POSITIVE_INFINITY;
    const filtro = comando.filter as { _id?: { $gt?: unknown } } | undefined;
    const depoisDe = filtro?._id?.$gt;

    const todos = colecoes[nome] ?? [];
    const inicio = depoisDe
      ? todos.findIndex((documento) => documento._id === depoisDe) + 1
      : 0;

    return Promise.resolve({
      cursor: { id: 0, firstBatch: todos.slice(inicio, inicio + limite) },
    });
  });

  return { $runCommandRaw: runCommandRaw } as unknown as PrismaService;
}

function storageCom(existentes: ArquivoDeBackup[]) {
  const enviados = new Map<string, Buffer>();
  const apagados: string[] = [];

  const storage = {
    prefixo: 'backups',
    enviar: jest.fn((key: string, corpo: Buffer) => {
      enviados.set(key, corpo);
      return Promise.resolve();
    }),
    baixar: jest.fn((key: string) => {
      const conteudo = enviados.get(key);
      return conteudo
        ? Promise.resolve(conteudo)
        : Promise.reject(new Error('não encontrado'));
    }),
    listar: jest.fn(() =>
      Promise.resolve(
        [
          ...existentes,
          ...[...enviados.keys()].map((key) => ({
            key,
            sizeBytes: enviados.get(key)?.byteLength ?? 0,
            criadoEm: new Date(),
          })),
        ].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime()),
      ),
    ),
    apagar: jest.fn((key: string) => {
      apagados.push(key);
      return Promise.resolve();
    }),
  } as unknown as BackupStorageService;

  return { storage, enviados, apagados };
}

function arquivo(dia: string): ArquivoDeBackup {
  return {
    key: `backups/backup-${dia}.json.gz`,
    sizeBytes: 10,
    criadoEm: new Date(`${dia}T03:00:00Z`),
  };
}

describe('BackupService', () => {
  const hoje = new Date('2026-09-21T03:00:00Z');

  it('exporta as coleções escolhidas, respeitando o limite de cada uma', async () => {
    const prisma = prismaCom({
      Work: Array.from({ length: 10 }, (_, i) => ({ _id: `w${i}` })),
      Composer: [{ _id: 'c1' }, { _id: 'c2' }],
    });
    const { storage, enviados } = storageCom([]);

    const resultado = await new BackupService(prisma, storage).executar(
      [
        { name: 'Work', limit: 3 },
        { name: 'Composer', limit: null },
      ],
      3,
      hoje,
    );

    expect(resultado.collections).toEqual([
      { name: 'Work', documents: 3 },
      { name: 'Composer', documents: 2 },
    ]);
    expect(resultado.documentCount).toBe(5);
    expect(resultado.objectKey).toBe('backups/backup-2026-09-21.json.gz');

    // O conteúdo é NDJSON: cada linha se lê sozinha.
    const texto = gunzipSync(enviados.get(resultado.objectKey) as Buffer)
      .toString('utf8')
      .split('\n');

    expect(JSON.parse(texto[0]).type).toBe('meta');
    expect(texto.filter((l) => l.includes('"type":"doc"'))).toHaveLength(5);
  });

  it('verifica o arquivo antes de girar', async () => {
    const prisma = prismaCom({ Work: [{ _id: 'w1' }] });
    const { storage } = storageCom([]);

    const resultado = await new BackupService(prisma, storage).executar(
      [{ name: 'Work', limit: null }],
      3,
      hoje,
    );

    expect(resultado.verifiedAt).toBeInstanceOf(Date);
    expect(storage.baixar).toHaveBeenCalledWith(resultado.objectKey);
  });

  // É assim que se acumulam três arquivos corrompidos e nenhum bom.
  it('não apaga nada quando a verificação falha', async () => {
    const prisma = prismaCom({ Work: [{ _id: 'w1' }] });
    const { storage, apagados } = storageCom([
      arquivo('2026-09-18'),
      arquivo('2026-09-19'),
      arquivo('2026-09-20'),
    ]);

    (storage.baixar as jest.Mock).mockRejectedValue(
      new Error('objeto ilegível'),
    );

    await expect(
      new BackupService(prisma, storage).executar(
        [{ name: 'Work', limit: null }],
        3,
        hoje,
      ),
    ).rejects.toThrow('não passou na verificação');

    expect(apagados).toEqual([]);
  });

  it('mantém apenas os mais recentes, e nunca o recém-criado', async () => {
    const prisma = prismaCom({ Work: [{ _id: 'w1' }] });
    const { storage, apagados } = storageCom([
      arquivo('2026-09-18'),
      arquivo('2026-09-19'),
      arquivo('2026-09-20'),
    ]);

    const resultado = await new BackupService(prisma, storage).executar(
      [{ name: 'Work', limit: null }],
      3,
      hoje,
    );

    // Entram 4, ficam 3: sai o mais antigo.
    expect(apagados).toEqual(['backups/backup-2026-09-18.json.gz']);
    expect(apagados).not.toContain(resultado.objectKey);
  });

  // Uma coleção que não existe lê zero documentos sem erro nenhum: o arquivo
  // sai menor e com cara de sucesso. Foi assim que `users` no lugar de `User`
  // passou batido.
  it('avisa quando a configuração aponta para coleção que não existe', async () => {
    const prisma = prismaCom({ User: [{ _id: 'u1' }] });
    const { storage } = storageCom([]);

    const resultado = await new BackupService(prisma, storage).executar(
      [
        { name: 'User', limit: null },
        { name: 'users', limit: null },
      ],
      3,
      hoje,
      new Set(['User', 'Work']),
    );

    expect(resultado.warnings).toHaveLength(1);
    expect(resultado.warnings[0]).toContain('"users"');
    expect(resultado.documentCount).toBe(1);
  });

  it('recusa rodar sem coleção selecionada', async () => {
    const { storage } = storageCom([]);

    await expect(
      new BackupService(prismaCom({}), storage).executar([], 3, hoje),
    ).rejects.toThrow('Nenhuma coleção selecionada');
  });

  it('falha quando o arquivo sai com menos documentos do que o esperado', async () => {
    const prisma = prismaCom({ Work: [{ _id: 'w1' }, { _id: 'w2' }] });
    const { storage, apagados } = storageCom([]);

    // Um arquivo truncado: o upload não acusa nada, a leitura de volta sim.
    (storage.baixar as jest.Mock).mockResolvedValue(
      gzipSync(
        Buffer.from('{"type":"meta"}\n{"type":"doc","collection":"Work"}'),
      ),
    );

    await expect(
      new BackupService(prisma, storage).executar(
        [{ name: 'Work', limit: null }],
        3,
        hoje,
      ),
    ).rejects.toThrow('não passou na verificação');

    expect(apagados).toEqual([]);
  });
});
