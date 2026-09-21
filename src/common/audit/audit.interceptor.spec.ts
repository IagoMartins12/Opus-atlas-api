import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

describe('AuditInterceptor', () => {
  const record = jest.fn().mockResolvedValue(undefined);
  const getAllAndOverride = jest.fn();
  const interceptor = new AuditInterceptor(
    { getAllAndOverride } as unknown as Reflector,
    { record } as unknown as AuditService,
  );

  const contextFor = (user?: object) =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params: { id: 'ad1' },
          headers: { 'user-agent': 'jest' },
        }),
      }),
    }) as unknown as ExecutionContext;

  const ok: CallHandler = { handle: () => of('ok') };

  beforeEach(() => {
    record.mockClear();
    getAllAndOverride.mockReturnValue({
      action: 'ad.update',
      entityType: 'advertisement',
      entityIdParam: 'id',
    });
  });

  // O papel vem do token como número e a coluna é texto. Passado cru, o
  // Prisma recusava a gravação: a trilha nunca teve uma linha.
  it('grava o papel do token como texto', async () => {
    await lastValueFrom(
      interceptor.intercept(contextFor({ sub: 'u1', role: 2 }), ok),
    );

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        actorRole: '2',
        action: 'ad.update',
        entityType: 'advertisement',
        entityId: 'ad1',
        success: true,
      }),
    );
  });

  it('registra a falha, também com o papel em texto', async () => {
    const failing: CallHandler = {
      handle: () => throwError(() => new Error('negado')),
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor({ sub: 'u1', role: 1 }), failing),
      ),
    ).rejects.toThrow('negado');

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: '1', success: false }),
    );
  });

  it('sem usuário, grava sem autor', async () => {
    await lastValueFrom(interceptor.intercept(contextFor(undefined), ok));

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: undefined, actorRole: undefined }),
    );
  });

  it('rota sem @Audited não grava', async () => {
    getAllAndOverride.mockReturnValue(undefined);

    await lastValueFrom(interceptor.intercept(contextFor({ sub: 'u1' }), ok));

    expect(record).not.toHaveBeenCalled();
  });
});
