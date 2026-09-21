import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CATALOG_NAMESPACES, CacheNamespace } from './cache-keys';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * A invalidação procura `<namespace>:*`. Chave montada com outro começo nunca é
 * limpa pelas escritas — foi o que aconteceu com o catálogo, que gravava
 * `catalog:works:…`, `catalog:composers:…` e afins: nenhuma edição de
 * compositor aparecia antes de o TTL vencer.
 */
describe('chaves de cache dentro do namespace', () => {
  it('nenhuma chave começa com "catalog:" ou "public-teachers:"', () => {
    const root = join(__dirname, '..', '..');
    // Comentário pode citar a chave antiga; código, não.
    const offenders = sourceFiles(root).filter((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .some((line) => /['`](catalog|public-teachers):/.test(line)),
    );

    expect(offenders).toEqual([]);
  });

  // As páginas de história listam compositores por época; as descobertas
  // mostram obras e compositores novos.
  it('escrita no catálogo limpa também épocas e descobertas', () => {
    expect(CATALOG_NAMESPACES).toEqual(
      expect.arrayContaining([
        CacheNamespace.WORKS,
        CacheNamespace.COMPOSERS,
        CacheNamespace.EPOCHS,
        CacheNamespace.DISCOVERY,
      ]),
    );
  });
});
