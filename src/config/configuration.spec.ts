import { appConfiguration } from './configuration';

describe('appConfiguration — pasta do backup', () => {
  const salvo = { ...process.env };

  afterEach(() => {
    process.env = { ...salvo };
  });

  /**
   * Homologação e produção podem dividir o bucket; não podem dividir a pasta.
   * A rotação apaga os mais antigos **da pasta**, então pasta comum faria a
   * homologação apagar backup de produção.
   */
  it('separa homologação e produção por padrão', () => {
    delete process.env.BACKUP_R2_PREFIX;

    process.env.NODE_ENV = 'staging';
    const hml = appConfiguration().backup.prefix;

    process.env.NODE_ENV = 'production';
    const prd = appConfiguration().backup.prefix;

    expect(hml).toBe('backups/staging');
    expect(prd).toBe('backups/production');
    // Nenhum é prefixo do outro: a listagem de um não enxerga o outro.
    expect(`${prd}/`.startsWith(`${hml}/`)).toBe(false);
    expect(`${hml}/`.startsWith(`${prd}/`)).toBe(false);
  });

  it('respeita o prefixo definido à mão', () => {
    process.env.BACKUP_R2_PREFIX = 'opus-backups';
    expect(appConfiguration().backup.prefix).toBe('opus-backups');
  });
});
