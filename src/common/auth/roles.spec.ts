import { ROLE, ROLE_NAME_TO_LEVEL, isAdmin } from './roles';

/**
 * A regra que este arquivo guarda custou um acesso indevido: enquanto `ADMIN`
 * valia `role: 1`, **toda conta que o painel antigo promoveu a professor abria
 * o painel administrativo** — porque o legado usava `role: 1` para marcar
 * professor e o guard compara `role >= exigido`.
 */
describe('papéis', () => {
  it('o nível 1 é professor e não abre nada de administrativo', () => {
    expect(ROLE.TEACHER).toBe(1);
    expect(isAdmin(ROLE.TEACHER)).toBe(false);
  });

  it('administrador é o nível 2', () => {
    expect(ROLE.ADMIN).toBe(2);
    expect(isAdmin(ROLE.ADMIN)).toBe(true);
  });

  it('pessoa comum não é administradora', () => {
    expect(isAdmin(ROLE.USER)).toBe(false);
  });

  it('papel ausente conta como pessoa comum, nunca como administrador', () => {
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it('um papel acima do conhecido continua sendo administrador', () => {
    // A comparação é `>=`: um nível novo no topo não pode tirar acesso de
    // quem já tinha.
    expect(isAdmin(3)).toBe(true);
  });

  it('`ADMIN` e `SUPER_ADMIN` exigem o mesmo nível — e nunca menos que 2', () => {
    expect(ROLE_NAME_TO_LEVEL.ADMIN).toBe(ROLE.ADMIN);
    expect(ROLE_NAME_TO_LEVEL.SUPER_ADMIN).toBe(ROLE.ADMIN);
  });

  it('nenhum nome de papel administrativo aceita o nível do professor', () => {
    for (const nome of ['ADMIN', 'SUPER_ADMIN']) {
      expect(ROLE_NAME_TO_LEVEL[nome]).toBeGreaterThan(ROLE.TEACHER);
    }
  });
});
