import {
  MAX_WATCHES_PER_SOCKET,
  roomOf,
  watchRefusal,
} from './job-watch.policy';

const admin = { sub: 'admin-1', role: 2 };
const professor = { sub: 'prof-1', role: 1 };
const comum = { sub: 'user-1', role: 0 };

describe('watchRefusal', () => {
  it('administrador acompanha qualquer job', () => {
    expect(watchRefusal(admin, { requestedBy: 'outra-pessoa' })).toBeNull();
    expect(watchRefusal(admin, { requestedBy: null })).toBeNull();
    expect(watchRefusal(admin, { requestedBy: 'admin-1' })).toBeNull();
  });

  /**
   * O nível 1 é professor, e professor não tem acesso administrativo nenhum.
   * Enquanto `ADMIN` valia 1, quem tivesse esse papel — toda conta que o
   * painel antigo promoveu a professor — entrava aqui.
   */
  it('professor não acompanha nada', () => {
    expect(watchRefusal(professor, { requestedBy: 'prof-1' })).toMatch(
      /permissão/,
    );
    expect(watchRefusal(professor, { requestedBy: null })).toMatch(
      /permissão/,
    );
  });

  it('usuário comum não acompanha nada', () => {
    expect(watchRefusal(comum, { requestedBy: 'user-1' })).toMatch(/permissão/);
  });

  it('job inexistente é recusa, não silêncio', () => {
    expect(watchRefusal(admin, null)).toMatch(/não encontrado/);
  });
});

describe('roomOf', () => {
  it('junta fila e job', () => {
    expect(roomOf('scraper', 'scraper.osesp')).toBe('scraper:scraper.osesp');
  });
});

describe('MAX_WATCHES_PER_SOCKET', () => {
  it('existe um teto por conexão', () => {
    expect(MAX_WATCHES_PER_SOCKET).toBeGreaterThan(0);
  });
});
