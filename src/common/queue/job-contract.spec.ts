import { buildIdempotencyKey, envelope } from './job-contract';

describe('buildIdempotencyKey', () => {
  it('mantém a chave legível quando cabe', () => {
    expect(
      buildIdempotencyKey('newsletter.plan', '685d591c1e3db0c5aaa893e4'),
    ).toBe('newsletter.plan.685d591c1e3db0c5aaa893e4');
  });

  it('é determinística: a mesma entrada dá a mesma chave', () => {
    const first = buildIdempotencyKey('backup.full', 'diario', 7);
    const second = buildIdempotencyKey('backup.full', 'diario', 7);

    expect(first).toBe(second);
  });

  it('distingue partes diferentes', () => {
    expect(buildIdempotencyKey('newsletter.batch', 'campanha', 1)).not.toBe(
      buildIdempotencyKey('newsletter.batch', 'campanha', 2),
    );
  });

  // O `jobId` vira nome de chave no Redis; caractere solto ali é problema.
  it('troca caractere inseguro por traço', () => {
    expect(buildIdempotencyKey('scope', 'a b/c:d')).toBe('scope.a-b-c-d');
  });

  it('trata nulo e indefinido como parte vazia, sem quebrar', () => {
    expect(buildIdempotencyKey('scope', null, undefined)).toBe('scope');
  });

  // Chave gigante é chave gigante no Redis, e o BullMQ monta várias por job.
  it('cai para o resumo em hash quando passa do limite', () => {
    const key = buildIdempotencyKey('scope', 'x'.repeat(300));

    expect(key.length).toBeLessThan(50);
    expect(key.startsWith('scope.')).toBe(true);
  });

  // Separador de bytes nulos existe justamente para isto.
  it('não colide ao mover caracteres entre as partes', () => {
    const first = buildIdempotencyKey('scope', 'a'.repeat(200), 'b');
    const second = buildIdempotencyKey('scope', 'a'.repeat(199), 'ab');

    expect(first).not.toBe(second);
  });
});

describe('envelope', () => {
  it('preenche autor nulo quando o disparo é automático', () => {
    const body = envelope({ idempotencyKey: 'k', payload: { a: 1 } });

    expect(body.requestedBy).toBeNull();
    expect(body.payload).toEqual({ a: 1 });
    expect(Date.parse(body.requestedAt)).not.toBeNaN();
  });

  it('carrega quem pediu', () => {
    const body = envelope({
      idempotencyKey: 'k',
      payload: {},
      requestedBy: 'admin-1',
    });

    expect(body.requestedBy).toBe('admin-1');
  });
});
