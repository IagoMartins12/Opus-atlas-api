import { reportToCsv } from './report-csv';
import { periodRange } from './report-types';

describe('reportToCsv', () => {
  const meta = {
    name: 'Resumo de Usuários',
    period: '7d',
    start: new Date('2026-09-05T12:00:00Z'),
    end: new Date('2026-09-12T12:00:00Z'),
    generatedAt: new Date('2026-09-12T12:00:00Z'),
  };

  it('cabeçalho, resumo e uma tabela por seção, separados por linha em branco', () => {
    const csv = reportToCsv(meta, {
      summary: [['Usuários', 10]],
      sections: [
        {
          title: 'Novos',
          columns: ['Nome', 'Perfil'],
          rows: [['Ana', 'Professor']],
        },
        { title: 'Vazia', columns: ['X'], rows: [] },
      ],
    });

    expect(csv.split('\r\n')).toEqual([
      '"Relatório","Resumo de Usuários"',
      '"Período","7d (05/09/2026 a 12/09/2026)"',
      '"Gerado em","2026-09-12T12:00:00.000Z"',
      '',
      '"Resumo"',
      '"Indicador","Valor"',
      '"Usuários","10"',
      '',
      '"Novos"',
      '"Nome","Perfil"',
      '"Ana","Professor"',
      '',
      '"Vazia"',
      '"(nenhum registro no período)"',
    ]);
  });

  // Nome de usuário é texto livre — não pode virar fórmula na planilha.
  it('neutraliza fórmula vinda de dado do usuário', () => {
    const csv = reportToCsv(meta, {
      summary: [],
      sections: [
        { title: 'T', columns: ['Nome'], rows: [['=HYPERLINK("x")']] },
      ],
    });

    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('periodRange', () => {
  it('conta os dias para trás a partir de agora', () => {
    const now = new Date('2026-09-12T00:00:00Z');
    expect(periodRange('1y', now).start.toISOString()).toBe(
      '2025-09-12T00:00:00.000Z',
    );
    expect(periodRange('30d', now).end).toBe(now);
  });
});
