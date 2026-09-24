import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { CuratorGuard } from './curator.guard';

const ADMIN = { sub: 'a1', role: 2, isTeacher: false };
const PROFESSOR = { sub: 'p1', role: 0, isTeacher: true };
const COMUM = { sub: 'u1', role: 0, isTeacher: false };

function contexto(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function guardaCom(
  exige: boolean,
  perfil: { status: string; isVerified: boolean } | null = null,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(exige),
  } as unknown as Reflector;
  const findUnique = jest.fn().mockResolvedValue(perfil);
  const prisma = { teacher: { findUnique } } as unknown as PrismaService;

  return { guard: new CuratorGuard(reflector, prisma), findUnique };
}

describe('CuratorGuard', () => {
  it('não se mete em rota que não pede curadoria', async () => {
    const { guard, findUnique } = guardaCom(false);

    await expect(guard.canActivate(contexto())).resolves.toBe(true);
    // Sem a marca, nem o banco é tocado.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('administrador passa sem consultar o perfil de professor', async () => {
    const { guard, findUnique } = guardaCom(true);

    await expect(guard.canActivate(contexto(ADMIN))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('professor ativo e verificado edita o catálogo', async () => {
    const { guard } = guardaCom(true, { status: 'ACTIVE', isVerified: true });

    await expect(guard.canActivate(contexto(PROFESSOR))).resolves.toBe(true);
  });

  it('professor pendente não edita — a aprovação é de um administrador', async () => {
    const { guard } = guardaCom(true, { status: 'PENDING', isVerified: true });

    await expect(guard.canActivate(contexto(PROFESSOR))).rejects.toThrow(
      /em análise/,
    );
  });

  it('professor ativo mas não verificado não edita', async () => {
    // Aceitar o convite ativa o perfil; conferir as credenciais é outro passo.
    const { guard } = guardaCom(true, { status: 'ACTIVE', isVerified: false });

    await expect(guard.canActivate(contexto(PROFESSOR))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('quem diz ser professor sem perfil nenhum não edita', async () => {
    const { guard } = guardaCom(true, null);

    await expect(guard.canActivate(contexto(PROFESSOR))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('pessoa comum não edita, e o banco nem é consultado', async () => {
    const { guard, findUnique } = guardaCom(true);

    await expect(guard.canActivate(contexto(COMUM))).rejects.toThrow(
      /administradores e professores/,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('sem usuário é recusa, não liberação', async () => {
    const { guard } = guardaCom(true);

    await expect(guard.canActivate(contexto())).rejects.toThrow(
      /não autenticado/,
    );
  });
});
