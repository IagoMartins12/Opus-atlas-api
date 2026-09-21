import { conferirDestino, identificarBanco } from './restore';

/**
 * As travas do restore. É a única parte do script que decide **onde** se
 * escreve — e um engano aqui apaga o banco errado.
 */
describe('restore — travas do destino', () => {
  const HML =
    'mongodb+srv://u:p@cluster-hml.abc.mongodb.net/opus-hml?retryWrites=true';
  const PRD =
    'mongodb+srv://u:p@cluster-prd.xyz.mongodb.net/opus?retryWrites=true';

  describe('identificarBanco', () => {
    it('separa host e banco, ignorando credencial e parâmetros', () => {
      expect(identificarBanco(HML)).toEqual({
        host: 'cluster-hml.abc.mongodb.net',
        banco: 'opus-hml',
      });
    });

    it('lida com senha que contém @', () => {
      expect(
        identificarBanco('mongodb://u:p@ss@localhost:27017/teste').banco,
      ).toBe('teste');
    });

    it('devolve banco vazio quando a URL não diz qual', () => {
      expect(identificarBanco('mongodb://localhost:27017').banco).toBe('');
    });
  });

  describe('conferirDestino', () => {
    it('aceita destino diferente da origem, com o nome confirmado', () => {
      expect(conferirDestino(HML, PRD, 'opus-hml').banco).toBe('opus-hml');
    });

    it('exige RESTORE_DATABASE_URL — nunca cai no DATABASE_URL', () => {
      expect(() => conferirDestino(undefined, PRD, 'opus')).toThrow(
        'RESTORE_DATABASE_URL',
      );
    });

    it('recusa destino igual à origem', () => {
      expect(() => conferirDestino(PRD, PRD, 'opus')).toThrow('mesmo banco');
    });

    it('recusa mesmo com credenciais e parâmetros diferentes', () => {
      const outraForma =
        'mongodb+srv://outro:senha@CLUSTER-PRD.xyz.mongodb.net/opus';
      expect(() => conferirDestino(outraForma, PRD, 'opus')).toThrow(
        'mesmo banco',
      );
    });

    it('recusa sem a confirmação do nome', () => {
      expect(() => conferirDestino(HML, PRD, undefined)).toThrow(
        '--confirmar opus-hml',
      );
    });

    it('recusa com a confirmação de outro banco', () => {
      expect(() => conferirDestino(HML, PRD, 'opus')).toThrow('--confirmar');
    });

    it('recusa URL sem nome de banco', () => {
      expect(() =>
        conferirDestino('mongodb://localhost:27017', PRD, ''),
      ).toThrow('nome do banco');
    });
  });
});
