import {
  MAX_WATCHES_PER_SOCKET,
  roomOf,
  watchRefusal,
} from './job-watch.policy';

const admin = { sub: 'admin-1', role: 1 };
const superAdmin = { sub: 'super-1', role: 2 };
const comum = { sub: 'user-1', role: 0 };

describe('watchRefusal', () => {
  it('super administrador acompanha qualquer job', () => {
    expect(
      watchRefusal(superAdmin, { requestedBy: 'outra-pessoa' }),
    ).toBeNull();
    expect(watchRefusal(superAdmin, { requestedBy: null })).toBeNull();
  });

  // `POST /scrapers/:id/run` é `@Roles('ADMIN')`: sem isto, um administrador
  // dispara uma varredura de dez minutos e não tem como ver se ela anda.
  it('administrador acompanha o job que ele mesmo pediu', () => {
    expect(watchRefusal(admin, { requestedBy: 'admin-1' })).toBeNull();
  });

  // O socket não pode ser uma porta mais larga do que `GET /admin/jobs/...`,
  // que exige SUPER_ADMIN para ver qualquer job.
  it('administrador não acompanha job de outra pessoa', () => {
    expect(watchRefusal(admin, { requestedBy: 'admin-2' })).toMatch(
      /outra pessoa/,
    );
  });

  // Disparo automático não tem dono: ninguém "pediu" para poder acompanhar.
  it('administrador não acompanha disparo automático', () => {
    expect(watchRefusal(admin, { requestedBy: null })).not.toBeNull();
  });

  it('usuário comum não acompanha nada', () => {
    expect(watchRefusal(comum, { requestedBy: 'user-1' })).toMatch(/permissão/);
  });

  it('job inexistente é recusa, não silêncio', () => {
    expect(watchRefusal(superAdmin, null)).toMatch(/não encontrado/);
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
