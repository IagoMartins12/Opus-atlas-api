import { validate } from 'class-validator';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Contrato mínimo de todo DTO da API: o arquivo carrega, e cada classe valida
 * um corpo vazio sem quebrar.
 *
 * Os testes de unidade chamam os serviços direto, sem passar pelo
 * `ValidationPipe` — então um DTO com import circular, decorador aplicado ao
 * tipo errado ou `@ValidateNested` sem classe só apareceria na primeira
 * requisição real. Aqui aparece na suíte.
 */
const SRC = join(__dirname, '..');

function dtoFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return entry === 'node_modules' ? [] : dtoFiles(path);
    }

    const isDto =
      (path.endsWith('.dto.ts') || path.includes('/dto/')) &&
      path.endsWith('.ts') &&
      !path.endsWith('.spec.ts');

    return isDto ? [path] : [];
  });
}

const files = dtoFiles(SRC).map((path) => relative(SRC, path));

describe('contratos de DTO', () => {
  it('encontra os DTOs da API', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s carrega e valida corpo vazio', async (file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(join(SRC, file)) as Record<string, unknown>;
    const classes = Object.values(exported).filter(
      (value): value is new () => object =>
        typeof value === 'function' && /^[A-Z]/.test(value.name),
    );

    for (const Dto of classes) {
      let instance: object;
      try {
        instance = new Dto();
      } catch {
        // Classe com construtor obrigatório não é DTO de entrada.
        continue;
      }

      await expect(validate(instance)).resolves.toBeInstanceOf(Array);
    }
  });
});
