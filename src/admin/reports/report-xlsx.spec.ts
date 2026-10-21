import * as ExcelJS from 'exceljs';
import { reportToXlsx } from './report-xlsx';

const meta = {
  name: 'Receita e Assinaturas',
  period: '30d',
  start: new Date('2026-09-20T12:00:00Z'),
  end: new Date('2026-10-20T12:00:00Z'),
  generatedAt: new Date('2026-10-20T12:00:00Z'),
};

async function open(buffer: Buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  return book;
}

describe('reportToXlsx', () => {
  it('traz uma aba de resumo e uma por tabela, com número como número', async () => {
    const book = await open(
      await reportToXlsx(meta, {
        summary: [
          ['Assinaturas', 12],
          ['Receita (R$)', 59.8],
        ],
        sections: [
          {
            title: 'Receita por plano',
            columns: ['Plano', 'Receita'],
            rows: [
              ['Plus', 39.8],
              ['Mentor', 20],
            ],
          },
          { title: 'Vazia', columns: ['A'], rows: [] },
        ],
      }),
    );

    expect(book.worksheets.map((w) => w.name)).toEqual([
      'Resumo',
      'Receita por plano',
      'Vazia',
    ]);
    const resumo = book.getWorksheet('Resumo')!;
    expect(resumo.getRow(1).getCell(1).value).toBe('Receita e Assinaturas');
    expect(resumo.getRow(6).getCell(2).value).toBe(12);

    const tabela = book.getWorksheet('Receita por plano')!;
    expect(tabela.getRow(3).values).toEqual([, 'Plano', 'Receita']);
    expect(tabela.getRow(4).getCell(2).value).toBe(39.8);
    expect(tabela.getRow(1).getCell(1).value).toBe('Receita por plano');
    expect(tabela.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 });

    expect(book.getWorksheet('Vazia')!.getRow(3).getCell(1).value).toBe(
      '(nenhum registro no período)',
    );
  });

  it('nome de aba inválido ou repetido é ajustado', async () => {
    const book = await open(
      await reportToXlsx(meta, {
        summary: [],
        sections: [
          { title: 'Resumo', columns: ['A'], rows: [['x']] },
          { title: 'A/B: custo? [R$]', columns: ['A'], rows: [['x']] },
          {
            title:
              'Um título muito comprido para caber no limite de trinta e um caracteres do Excel',
            columns: ['A'],
            rows: [['x']],
          },
        ],
      }),
    );

    const names = book.worksheets.map((w) => w.name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
    expect(names.some((n) => /[[\]:*?/\\]/.test(n))).toBe(false);
  });
});
