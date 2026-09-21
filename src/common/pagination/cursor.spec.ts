import { nextCursorOf, pageArgs } from './cursor';

describe('paginação das listas do painel', () => {
  describe('pageArgs', () => {
    it('sem cursor, salta até a página pedida', () => {
      expect(pageArgs({ page: 3, limit: 25 })).toEqual({ skip: 50, take: 25 });
    });

    // Sem `skip: 1` o próprio cursor volta como primeiro item da página
    // seguinte, e a tela mostra a mesma linha duas vezes.
    it('com cursor, pula o item que já foi mostrado', () => {
      expect(
        pageArgs({ cursor: '685d591c1e3db0c5aaa893e4', page: 1, limit: 25 }),
      ).toEqual({
        cursor: { id: '685d591c1e3db0c5aaa893e4' },
        skip: 1,
        take: 25,
      });
    });

    // A rolagem infinita não reenvia `page`, e o cursor manda nos dois casos.
    it('o cursor tem precedência sobre a página', () => {
      expect(
        pageArgs({ cursor: '685d591c1e3db0c5aaa893e4', page: 9, limit: 10 }),
      ).toMatchObject({ skip: 1 });
    });
  });

  describe('nextCursorOf', () => {
    it('página cheia devolve o id do último item', () => {
      expect(nextCursorOf([{ id: 'a' }, { id: 'b' }], 2)).toBe('b');
    });

    // Veio menos do que cabia: não há mais nada atrás.
    it('página incompleta encerra a rolagem', () => {
      expect(nextCursorOf([{ id: 'a' }], 2)).toBeNull();
    });

    it('página vazia encerra a rolagem', () => {
      expect(nextCursorOf([], 2)).toBeNull();
    });
  });
});
