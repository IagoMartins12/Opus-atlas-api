import {
  buildProgress,
  MAX_PROGRESS_MESSAGE,
  readProgress,
  reportProgress,
} from './job-progress';

describe('buildProgress', () => {
  it('guarda o percentual e a frase', () => {
    expect(buildProgress(80, '124 eventos coletados. Importando...')).toEqual({
      percent: 80,
      message: '124 eventos coletados. Importando...',
    });
  });

  it('sem frase, o campo é nulo — não string vazia', () => {
    expect(buildProgress(10).message).toBeNull();
    expect(buildProgress(10, '   ').message).toBeNull();
  });

  // O progresso é regravado no Redis a cada tique e a frase vem de dado
  // externo: sem teto, um job mal-comportado escreve quilobytes por segundo.
  it('corta a frase no teto', () => {
    const long = 'x'.repeat(MAX_PROGRESS_MESSAGE + 50);

    expect(buildProgress(10, long).message).toHaveLength(MAX_PROGRESS_MESSAGE);
  });

  describe('percentual', () => {
    it('arredonda', () => {
      expect(buildProgress(33.6).percent).toBe(34);
    });

    it('não passa de 100 nem fica abaixo de zero', () => {
      expect(buildProgress(180).percent).toBe(100);
      expect(buildProgress(-5).percent).toBe(0);
    });

    it('valor não numérico vira zero em vez de vazar NaN', () => {
      expect(buildProgress(Number.NaN).percent).toBe(0);
    });
  });
});

describe('reportProgress', () => {
  it('reporta o progresso montado', () => {
    const job = { updateProgress: jest.fn().mockResolvedValue(undefined) };

    reportProgress(job, 50, 'Metade');

    expect(job.updateProgress).toHaveBeenCalledWith({
      percent: 50,
      message: 'Metade',
    });
  });

  // Uma promessa rejeitada sem tratador derruba o processo do worker no Node,
  // e com ele todos os outros jobs que estivessem rodando. Perder um tique de
  // progresso não pode custar a varredura que já coletou duzentos eventos.
  it('falha ao gravar o progresso não derruba o job', async () => {
    const job = {
      updateProgress: jest.fn().mockRejectedValue(new Error('Redis fora')),
    };

    expect(() => reportProgress(job, 50, 'Metade')).not.toThrow();

    await Promise.resolve();
  });
});

describe('readProgress', () => {
  it('lê o formato com frase', () => {
    expect(readProgress({ percent: 40, message: 'Importando' })).toEqual({
      percent: 40,
      message: 'Importando',
    });
  });

  // No instante do deploy existem jobs no Redis com o progresso gravado pela
  // versão anterior, como `75`. Se a leitura só entendesse o formato novo,
  // todos apareceriam sem progresso até saírem da retenção — sete dias de tela
  // mentindo por uma mudança de formato.
  it('aceita o número solto que a versão anterior gravava', () => {
    expect(readProgress(75)).toEqual({ percent: 75, message: null });
  });

  it('devolve nulo quando não há progresso reportado', () => {
    expect(readProgress(undefined)).toBeNull();
    expect(readProgress(null)).toBeNull();
    expect(readProgress('quase la')).toBeNull();
    expect(readProgress({})).toBeNull();
    expect(readProgress({ percent: 'muito' })).toBeNull();
  });

  it('limita o percentual lido do Redis', () => {
    expect(readProgress({ percent: 900 })?.percent).toBe(100);
  });
});
