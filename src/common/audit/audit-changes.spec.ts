import {
  compactValue,
  diffSnapshots,
  labelOf,
  sanitizeBody,
} from './audit-changes';

describe('audit-changes', () => {
  describe('sanitizeBody', () => {
    it('nunca guarda senha, token, hash, documento ou cartão', () => {
      expect(
        sanitizeBody({
          title: 'Clair de lune',
          password: 'x',
          hashedPassword: 'y',
          refreshToken: 'z',
          payerDocument: '123',
          cardNumber: '4111',
        }),
      ).toEqual({ title: 'Clair de lune' });
    });

    it('corta texto longo e resume lista grande', () => {
      const out = sanitizeBody({
        content: 'a'.repeat(500),
        tags: Array.from({ length: 40 }, (_, i) => i),
      })!;

      expect(String(out.content)).toMatch(/… \(\+340 caracteres\)$/);
      expect(out.tags).toBe('40 itens');
    });

    it('corpo vazio ou que não é objeto não vira registro', () => {
      expect(sanitizeBody(undefined)).toBeNull();
      expect(sanitizeBody({})).toBeNull();
      expect(sanitizeBody(['a'])).toBeNull();
      expect(sanitizeBody({ password: 'x' })).toBeNull();
    });
  });

  describe('diffSnapshots', () => {
    it('só lista o que mudou, com antes e depois', () => {
      expect(
        diffSnapshots(
          { title: 'Rêverie', year: 1890, isVerified: false },
          { title: 'Rêverie', year: 1890, isVerified: true },
        ),
      ).toEqual([{ campo: 'isVerified', antes: false, depois: true }]);
    });

    it('compara data pelo instante, não pela referência', () => {
      const a = new Date('2026-09-29T10:00:00Z');
      const b = new Date('2026-09-29T10:00:00Z');
      expect(diffSnapshots({ validUntil: a }, { validUntil: b })).toEqual([]);
    });

    it('criação lista o que nasceu; remoção, o que se perdeu', () => {
      expect(diffSnapshots(null, { code: 'PRIMAVERA20' })).toEqual([
        { campo: 'code', antes: null, depois: 'PRIMAVERA20' },
      ]);
      expect(diffSnapshots({ code: 'PRIMAVERA20' }, null)).toEqual([
        { campo: 'code', antes: 'PRIMAVERA20', depois: null },
      ]);
    });

    it('ignora id, updatedAt e campo sensível', () => {
      expect(
        diffSnapshots(
          { id: '1', updatedAt: 1, hashedPassword: 'a', role: 0 },
          { id: '1', updatedAt: 2, hashedPassword: 'b', role: 2 },
        ),
      ).toEqual([{ campo: 'role', antes: 0, depois: 2 }]);
    });
  });

  describe('labelOf', () => {
    it('junta nome e sobrenome', () => {
      expect(
        labelOf({ firstName: 'Ana', lastName: 'Ribeiro', email: 'a@b.c' }, [
          'firstName',
          'lastName',
          'email',
        ]),
      ).toBe('Ana Ribeiro');
    });

    it('cai para o próximo campo quando o primeiro falta', () => {
      expect(
        labelOf({ firstName: null, lastName: null, email: 'a@b.c' }, [
          'firstName',
          'lastName',
          'email',
        ]),
      ).toBe('a@b.c');
      expect(
        labelOf({ name: '', fullName: 'Chopin' }, ['name', 'fullName']),
      ).toBe('Chopin');
    });

    it('sem registro, sem nome', () => {
      expect(labelOf(null, ['title'])).toBeNull();
    });
  });

  it('compactValue guarda data como ISO', () => {
    expect(compactValue(new Date('2026-01-02T03:04:05Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });
});
