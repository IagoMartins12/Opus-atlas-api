import { readSubmissions, writeSubmissions } from './assignment-types';

describe('leitura do campo submissions', () => {
  it('trata ausência de conteúdo', () => {
    expect(readSubmissions(null)).toEqual({ entries: [], milestones: [] });
    expect(readSubmissions(undefined)).toEqual({ entries: [], milestones: [] });
  });

  // Um JSON inesperado no banco não pode derrubar a listagem de tarefas.
  it('não quebra com formato inesperado', () => {
    expect(readSubmissions('texto solto')).toEqual({
      entries: [],
      milestones: [],
    });
    expect(readSubmissions(42)).toEqual({ entries: [], milestones: [] });
    expect(readSubmissions([1, 2, 3])).toEqual({ entries: [], milestones: [] });
  });

  // O legado guardava um vídeo único em `videoSubmission`; ele passa a ser o
  // primeiro item do histórico, sem precisar de migração.
  it('converte o vídeo único do formato antigo', () => {
    const result = readSubmissions({
      videoSubmission: {
        filename: 'estudo.mp4',
        originalName: 'estudo.mp4',
        filePath: 'https://res.cloudinary.com/demo/video/upload/v1/estudo.mp4',
        cloudinaryPublicId: 'opus/dev/assignments/a1/estudo',
        uploadedAt: '2026-01-10T12:00:00.000Z',
      },
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      kind: 'video',
      id: 'opus/dev/assignments/a1/estudo',
      url: 'https://res.cloudinary.com/demo/video/upload/v1/estudo.mp4',
      submittedAt: '2026-01-10T12:00:00.000Z',
    });
  });

  it('descarta vídeo antigo sem URL', () => {
    expect(
      readSubmissions({ videoSubmission: { filename: 'x.mp4' } }).entries,
    ).toHaveLength(0);
  });

  it('lê os marcos do nome antigo do campo', () => {
    const result = readSubmissions({
      progressMilestones: [
        {
          label: 'Mãos separadas',
          progress: 50,
          reachedAt: '2026-01-10T12:00:00.000Z',
        },
      ],
    });

    expect(result.milestones).toHaveLength(1);
    expect(result.milestones[0].label).toBe('Mãos separadas');
  });

  it('descarta item sem rótulo', () => {
    expect(
      readSubmissions({ milestones: [{ progress: 10 }, 'lixo'] }).milestones,
    ).toHaveLength(0);
  });

  it('descarta envio sem id', () => {
    expect(
      readSubmissions({ entries: [{ kind: 'video', url: 'https://x' }] })
        .entries,
    ).toHaveLength(0);
  });

  it('cai para `document` em tipo desconhecido', () => {
    const result = readSubmissions({
      entries: [{ id: 'e1', kind: 'holograma' }],
    });

    expect(result.entries[0].kind).toBe('document');
  });

  it('mantém o formato ao escrever e reler', () => {
    const original = {
      entries: [
        {
          id: 'e1',
          kind: 'audio' as const,
          note: 'primeira tentativa',
          assetId: 'asset-1',
          url: 'https://exemplo/a.mp3',
          submittedAt: '2026-01-10T12:00:00.000Z',
        },
      ],
      milestones: [
        {
          label: 'Metade',
          progress: 50,
          reachedAt: '2026-01-11T12:00:00.000Z',
        },
      ],
    };

    expect(readSubmissions(writeSubmissions(original))).toEqual(original);
  });
});
