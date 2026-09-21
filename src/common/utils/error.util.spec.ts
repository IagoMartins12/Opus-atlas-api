import { errorMessage, errorStack, toError } from './error.util';

describe('error.util', () => {
  describe('errorMessage', () => {
    it('extrai a mensagem de um Error', () => {
      expect(errorMessage(new Error('falhou'))).toBe('falhou');
    });

    it('devolve a própria string quando o valor lançado é string', () => {
      expect(errorMessage('erro cru')).toBe('erro cru');
    });

    it('lê `message` de objeto que não é Error', () => {
      expect(errorMessage({ message: 'vindo de lib externa' })).toBe(
        'vindo de lib externa',
      );
    });

    it('não quebra com null, undefined ou número', () => {
      expect(errorMessage(null)).toBe('null');
      expect(errorMessage(undefined)).toBe('undefined');
      expect(errorMessage(42)).toBe('42');
    });

    it('ignora `message` que não é string', () => {
      expect(errorMessage({ message: { nested: true } })).toContain('object');
    });
  });

  describe('errorStack', () => {
    it('devolve o stack de um Error', () => {
      expect(errorStack(new Error('x'))).toContain('Error: x');
    });

    it('devolve undefined para valor que não é Error', () => {
      expect(errorStack('string')).toBeUndefined();
    });
  });

  describe('toError', () => {
    it('preserva a instância original de Error', () => {
      const original = new Error('original');
      expect(toError(original)).toBe(original);
    });

    it('embrulha valor não-Error mantendo a mensagem', () => {
      expect(toError('texto').message).toBe('texto');
    });
  });
});
