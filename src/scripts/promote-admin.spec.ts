import {
  NIVEIS,
  lerArgumentos,
  nomeDoBanco,
  nomeDoNivel,
} from './promote-admin';

describe('promote-admin', () => {
  describe('lerArgumentos', () => {
    const base = ['--email', 'Alguem@Exemplo.com', '--confirmar', 'opus-hml'];

    it('exige o e-mail', () => {
      expect(() => lerArgumentos(['--confirmar', 'opus-hml'])).toThrow(
        /--email/,
      );
    });

    it('exige a confirmação do banco', () => {
      expect(() => lerArgumentos(['--email', 'a@b.com'])).toThrow(
        /--confirmar/,
      );
    });

    it('normaliza o e-mail: espaços e maiúsculas não criam conta diferente', () => {
      const args = lerArgumentos([
        '--email',
        ' Alguem@Exemplo.com ',
        ...base.slice(2),
      ]);
      expect(args.email).toBe('alguem@exemplo.com');
    });

    it('promove a administrador por padrão', () => {
      expect(lerArgumentos(base).nivel).toBe(NIVEIS.admin);
    });

    it('administrador é o nível 2; o 1 é professor e não abre o painel', () => {
      // Enquanto `ADMIN` valia 1, promover a admin dava o papel que o legado
      // usava para marcar professor — e todo professor abria o painel.
      expect(NIVEIS.admin).toBe(2);
      expect(NIVEIS.teacher).toBe(1);
    });

    it('aceita os três níveis pelo nome', () => {
      for (const [nome, valor] of Object.entries(NIVEIS)) {
        expect(lerArgumentos([...base, '--nivel', nome]).nivel).toBe(valor);
      }
    });

    it('recusa nível desconhecido em vez de cair no padrão', () => {
      // Cair no padrão faria "--nivel sudo" promover em silêncio a admin.
      expect(() => lerArgumentos([...base, '--nivel', 'super'])).toThrow(
        /nivel inválido/i,
      );
    });
  });

  describe('nomeDoBanco', () => {
    it('lê o banco de uma URL do Atlas com querystring', () => {
      expect(
        nomeDoBanco(
          'mongodb+srv://u:s@cluster.mongodb.net/opus-hml?retryWrites=true&w=majority',
        ),
      ).toBe('opus-hml');
    });

    it('lê o banco de uma URL local', () => {
      expect(nomeDoBanco('mongodb://localhost:27017/opus')).toBe('opus');
    });

    it('devolve vazio quando a URL não nomeia banco', () => {
      // Sem isto o script não teria como conferir a confirmação.
      expect(
        nomeDoBanco('mongodb+srv://u:s@cluster.mongodb.net/?retryWrites=true'),
      ).toBe('');
    });
  });

  describe('nomeDoNivel', () => {
    it('traduz os níveis conhecidos', () => {
      expect(nomeDoNivel(0)).toBe('user');
      expect(nomeDoNivel(1)).toBe('teacher');
      expect(nomeDoNivel(2)).toBe('admin');
    });

    it('não esconde um valor fora da tabela', () => {
      expect(nomeDoNivel(7)).toContain('7');
    });
  });
});
