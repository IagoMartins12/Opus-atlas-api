import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';
import { CATALOGS } from './catalogs';
import { localeFromHeader } from './locale';
import { translate, translateMessage } from './translate';

const SRC = join(__dirname, '..', '..');

/**
 * Areas that answer only in Portuguese for now: the portal, the admin and
 * the blog's editing side (owner's decision, 13/10), plus internal tools.
 */
const PORTUGUESE_ONLY = [
  /^portal\//,
  /^admin\//,
  /^scrapers\//,
  /^scripts\//,
  /^mail\//,
  /-admin\.(service|controller)\.ts$/,
  /^blog\/articles\/(article-writer|article-publishing|author-articles|article-featured)/,
  /^blog\/articles\/dto\/write-article/,
  /^blog\/categories\/dto\//,
  /^blog\/media\//,
  /^blog\/translation\//,
  /^blog\/tts\/speech-synthesizer/,
  /^blog\/calendar\/(calendar-import|events\.service)/,
  /^blog\/calendar\/dto\//,
  /^blog\/shared\//,
  /^blog\/tags\/dto\//,
  /^blog\/tts\/tts\.dto/,
  /^blog\/shared\//,
  /^blog\/tags\/dto\//,
  /^blog\/tts\/tts\.dto/,
  /^uploads\/moderation\/moderation-sweep/,
  /^billing\/(webhook\.controller|services\/(stripe-catalog|plan-pricing))/,
  /^common\/guards\/api-key/,
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });

/**
 * A string expression as catalog keys: `${x}` and `+ x` become `{n}`; each
 * branch of `a ? 'x' : 'y'` is a key of its own.
 */
function keysOf(node: ts.Expression): string[] {
  const walk = (e: ts.Expression, n: { i: number }): string[] => {
    if (ts.isParenthesizedExpression(e)) return walk(e.expression, n);
    if (ts.isConditionalExpression(e))
      return [...walk(e.whenTrue, { i: 0 }), ...walk(e.whenFalse, { i: 0 })];
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))
      return [e.text];
    if (ts.isTemplateExpression(e))
      return [
        e.head.text +
          e.templateSpans.map((s) => `{${n.i++}}${s.literal.text}`).join(''),
      ];
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = walk(e.left, n);
      const right = walk(e.right, n);
      return left.length === 1 && right.length === 1
        ? [left[0] + right[0]]
        : [];
    }
    return [];
  };
  return walk(node, { i: 0 });
}

/** Exception messages, `message` (property or variable) and the `title` beside it. */
function messagesIn(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      /Exception$/.test(node.expression.getText(source)) &&
      node.arguments?.[0]
    ) {
      found.push(...keysOf(node.arguments[0]));
    }
    // `const message = …` handed on as `{ message }`.
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'message' &&
      node.initializer
    )
      found.push(...keysOf(node.initializer));
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(
        node.properties
          .filter(ts.isPropertyAssignment)
          .map((p) => [p.name.getText(source), p.initializer] as const),
      );
      const message = props.get('message');
      const keys = message ? keysOf(message) : [];
      if (keys.length) {
        found.push(...keys);
        const title = props.get('title');
        if (title) found.push(...keysOf(title));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('i18n', () => {
  it('reads the language from Accept-Language', () => {
    expect(localeFromHeader('en-US,en;q=0.9,pt;q=0.8')).toBe('en');
    expect(localeFromHeader('fr-FR,pt-BR;q=0.7,en;q=0.5')).toBe('pt');
    expect(localeFromHeader('de, en;q=0.4')).toBe('en');
    expect(localeFromHeader(undefined)).toBe('pt');
  });

  it('translates fixed messages and templates, values included', () => {
    expect(translate('Obra não encontrada', 'en')).toBe('Work not found');
    expect(translate('Obra não encontrada', 'pt')).toBe('Obra não encontrada');
    expect(
      translate('Você já tem 10 coleções. Apague uma para criar outra.', 'en'),
    ).toBe('You already have 10 collections. Delete one to create another.');
    expect(
      translateMessage(['Senha atual incorreta', 'desconhecida'], 'en'),
    ).toEqual(['Current password is incorrect', 'desconhecida']);
  });

  it.each(Object.keys(CATALOGS))(
    'every message the site can show has a "%s" translation',
    (locale) => {
      const catalog = CATALOGS[locale as keyof typeof CATALOGS];
      const missing = new Set<string>();
      for (const path of files(SRC)) {
        const rel = relative(SRC, path);
        if (PORTUGUESE_ONLY.some((re) => re.test(rel))) continue;
        for (const key of messagesIn(path))
          if (/[a-zà-ú]{3}/i.test(key) && !(key in catalog))
            missing.add(`${rel} | ${key}`);
      }
      expect([...missing].sort()).toEqual([]);
    },
  );

  it('keeps the placeholders of every template', () => {
    for (const catalog of Object.values(CATALOGS))
      for (const [source, target] of Object.entries(catalog)) {
        const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
        expect(`${source} → ${holes(target)}`).toBe(
          `${source} → ${holes(source)}`,
        );
      }
  });
});
