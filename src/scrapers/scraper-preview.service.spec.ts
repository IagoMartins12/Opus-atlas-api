import { ScraperPreviewService } from './scraper-preview.service';

const lido = (title: string) => ({
  title,
  externalId: title,
  startDate: '2026-11-01T00:00:00.000Z',
});

describe('ScraperPreviewService', () => {
  const status = { resultadoCompleto: jest.fn() };
  const importer = {
    existente: jest.fn(),
    importEvents: jest.fn(),
  };
  const service = new ScraperPreviewService(status as never, importer as never);

  const rodada = (over: Record<string, unknown> = {}) => ({
    state: 'completed',
    result: {
      scraperId: 'osesp',
      venueName: 'Sala São Paulo',
      modo: 'previa',
      eventsFound: 3,
      eventos: [],
      lidos: [lido('A'), lido('B'), lido('C')],
      ...over,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    status.resultadoCompleto.mockResolvedValue(rodada());
  });

  it('confere a prévia de novo contra a agenda', async () => {
    importer.existente.mockImplementation((e: { title: string }) =>
      Promise.resolve(e.title === 'B' ? { id: 'ev-b' } : null),
    );

    const r = await service.previa('job-1');

    expect(r.novos).toBe(2);
    expect(r.eventos.map((e) => [e.indice, e.estado])).toEqual([
      [0, 'novo'],
      [1, 'ja-existia'],
      [2, 'novo'],
    ]);
  });

  // O navegador escolhe quais; o conteúdo vem da rodada guardada.
  it('importa só os escolhidos, lidos da rodada, sem repetir nem sair da faixa', async () => {
    importer.importEvents.mockResolvedValue({
      imported: 2,
      duplicates: 0,
      failed: 0,
      details: [
        { title: 'A', status: 'success', message: 'ok', eventId: 'e1' },
        { title: 'C', status: 'success', message: 'ok', eventId: 'e3' },
      ],
    });

    const r = await service.importar('job-1', [2, 0, 2, 9, -1]);

    expect(importer.importEvents).toHaveBeenCalledWith('osesp', [
      lido('A'),
      lido('C'),
    ]);
    expect(r).toMatchObject({ escolhidos: 2, importados: 2 });
    expect(r.eventos.map((e) => e.indice)).toEqual([0, 2]);
  });

  it('nada escolhido é recusado', async () => {
    await expect(service.importar('job-1', [7])).rejects.toThrow(
      'Escolha ao menos um evento',
    );
  });

  it('rodada agendada, em andamento ou vencida não tem o que escolher', async () => {
    status.resultadoCompleto.mockResolvedValueOnce(
      rodada({ modo: 'importar', lidos: undefined }),
    );
    await expect(service.previa('j')).rejects.toThrow('já importou sozinha');

    status.resultadoCompleto.mockResolvedValueOnce({
      state: 'active',
      result: null,
    });
    await expect(service.previa('j')).rejects.toThrow('ainda não terminou');

    status.resultadoCompleto.mockResolvedValueOnce(null);
    await expect(service.previa('j')).rejects.toThrow('sete dias');
  });
});
