import { anonimizar, filtroDaPagina } from './export-hml';

/**
 * Homologação tem SMTP de verdade. O que protege gente real de receber e-mail
 * de lá é esta função.
 */
describe('export-hml — anonimizar', () => {
  const real = {
    _id: { $oid: '64f0c2a1b2c3d4e5f6a7b8c9' },
    email: 'pessoa@gmail.com',
    username: 'pessoa',
    firstName: 'Maria',
    lastName: 'Souza',
    hashedPassword: '$2b$10$hash',
    image: 'https://res.cloudinary.com/foto.jpg',
    phone: '+5511999999999',
    city: 'São Paulo',
    role: 2,
    totalXP: 340,
  };

  const anonimo = anonimizar(real);

  it('mantém o _id, que o resto do banco referencia', () => {
    expect(anonimo._id).toEqual(real._id);
  });

  it('manda o e-mail para um domínio que nunca entrega', () => {
    expect(anonimo.email).toMatch(/\.invalid$/);
    expect(anonimo.email).not.toContain('gmail');
  });

  it('gera e-mail e username únicos por usuário', () => {
    const outro = anonimizar({
      ...real,
      _id: { $oid: '64f0c2a1b2c3d4e5f6a7b8d0' },
    });
    expect(outro.email).not.toBe(anonimo.email);
    expect(outro.username).not.toBe(anonimo.username);
  });

  it('apaga senha, contato, localização e foto', () => {
    for (const campo of ['hashedPassword', 'phone', 'city', 'image']) {
      expect(anonimo[campo]).toBeNull();
    }
    expect(JSON.stringify(anonimo)).not.toMatch(/Maria|Souza|São Paulo/);
  });

  it('não herda papel de administrador', () => {
    expect(anonimo.role).toBe(0);
  });

  it('preserva o que não identifica ninguém', () => {
    expect(anonimo.totalXP).toBe(340);
  });
});

describe('export-hml — filtroDaPagina', () => {
  const ultimo = { $oid: '64f0c2a1b2c3d4e5f6a7b8c9' };

  it('primeira página: só o filtro do chamador', () => {
    expect(filtroDaPagina({ workId: 1 }, null)).toEqual({ workId: 1 });
  });

  it('sem filtro do chamador: só avança pelo _id', () => {
    expect(filtroDaPagina({}, ultimo)).toEqual({ _id: { $gt: ultimo } });
  });

  /**
   * A regressão: com o filtro também em `_id`, as duas condições têm de
   * valer juntas. Perder o `$in` fazia o recorte varrer a coleção inteira.
   */
  it('mantém um filtro sobre _id junto do avanço', () => {
    const fatia = [{ $oid: 'a' }, { $oid: 'b' }];

    expect(filtroDaPagina({ _id: { $in: fatia } }, ultimo)).toEqual({
      $and: [{ _id: { $in: fatia } }, { _id: { $gt: ultimo } }],
    });
  });
});
