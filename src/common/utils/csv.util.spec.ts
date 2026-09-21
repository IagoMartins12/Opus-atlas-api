import { csvField, toCsv } from './csv.util';

describe('CSV', () => {
  // O legado fazia `"${campo}"`: uma aspa no meio do título encerrava o campo
  // e desalinhava todas as colunas dali em diante.
  it('duplica aspas internas', () => {
    expect(csvField('Aula de "Für Elise"')).toBe('"Aula de ""Für Elise"""');
  });

  // Título de aula é texto que o usuário escreve. Sem neutralizar, vira
  // fórmula executável ao abrir o arquivo numa planilha.
  it('neutraliza prefixo de fórmula', () => {
    expect(csvField('=HYPERLINK("http://exemplo","clique")')).toBe(
      '"\'=HYPERLINK(""http://exemplo"",""clique"")"',
    );
    expect(csvField('+1')).toBe('"\'+1"');
    expect(csvField('-2')).toBe('"\'-2"');
    expect(csvField('@cmd')).toBe('"\'@cmd"');
  });

  it('não mexe em texto comum', () => {
    expect(csvField('Sonata ao Luar')).toBe('"Sonata ao Luar"');
  });

  it('trata vazio e ausente', () => {
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });

  it('escreve data em formato estável', () => {
    expect(csvField(new Date('2026-03-10T19:00:00.000Z'))).toBe(
      '"2026-03-10T19:00:00.000Z"',
    );
  });

  it('monta o arquivo com cabeçalho', () => {
    const csv = toCsv(['Data', 'Título'], [['2026-03-10', 'Aula']]);

    expect(csv).toBe('"Data","Título"\r\n"2026-03-10","Aula"');
  });

  it('uma quebra de linha no campo não quebra a linha do arquivo', () => {
    const csv = toCsv(['Título'], [['linha 1\nlinha 2']]);

    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
