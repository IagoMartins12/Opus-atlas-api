import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { escapeRegex } from './regex.util';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('escapeRegex', () => {
  it('neutraliza todo metacaractere', () => {
    expect(escapeRegex('Op. 9 (Chopin) [a|b]*+?^$\\')).toBe(
      'Op\\. 9 \\(Chopin\\) \\[a\\|b\\]\\*\\+\\?\\^\\$\\\\',
    );
  });

  it('o resultado casa só o texto literal', () => {
    const pattern = new RegExp(escapeRegex('b.ch'), 'i');
    expect(pattern.test('Bach')).toBe(false);
    expect(pattern.test('b.ch')).toBe(true);
  });
});

/**
 * No MongoDB o Prisma monta estes filtros como expressão regular, sem escapar
 * (ver `regex.util.ts`). Um filtro com texto variável sem `escapeRegex` é
 * expressão regular escolhida por quem chama.
 */
describe('filtros de texto com escape', () => {
  it('nenhum contains/startsWith/endsWith com variável sem escapeRegex', () => {
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];

    for (const file of sourceFiles(root)) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, index) => {
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;

          const match =
            /\b(contains|startsWith|endsWith):\s*([A-Za-z_$][\w$.]*)/.exec(
              line,
            );
          if (!match) return;

          const value = match[2];
          if (
            value.startsWith('escapeRegex') ||
            /^[A-Z_][A-Z0-9_]*$/.test(value) ||
            ['true', 'false', 'undefined', 'null'].includes(value)
          ) {
            return;
          }

          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }

    expect(offenders).toEqual([]);
  });
});
