import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import { AuditSnapshotService } from './audit-snapshot.service';

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

  describe('o que mudou', () => {
    const capture = jest.fn();
    const snapshots = {
      entity: (tipo?: string) =>
        tipo === 'work' ? { model: 'Work', label: ['title'] } : null,
      fieldsFor: () => ['title', 'isVerified'],
      capture,
    } as unknown as AuditSnapshotService;
    const comFoto = new AuditInterceptor(
      { getAllAndOverride } as unknown as Reflector,
      { record } as unknown as AuditService,
      snapshots,
    );

    const escrita = (method: string, body: object | undefined, role = 2) =>
      ({
        getType: () => 'http',
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
          getRequest: () => ({
            method,
            body,
            user: { sub: 'u1', role },
            params: { id: '64f000000000000000000001' },
            headers: {},
          }),
        }),
      }) as unknown as ExecutionContext;

    beforeEach(() => {
      capture.mockReset();
      getAllAndOverride.mockReturnValue({
        action: 'work.update',
        entityType: 'work',
        entityIdParam: 'id',
      });
    });

    it('grava o nome do alvo e os campos alterados, com antes e depois', async () => {
      capture
        .mockResolvedValueOnce({ title: 'Rêverie', isVerified: false })
        .mockResolvedValueOnce({ title: 'Rêverie', isVerified: true });

      await lastValueFrom(
        comFoto.intercept(escrita('PATCH', { isVerified: true }), ok),
      );

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          metadata: {
            alvo: 'Rêverie',
            mudancas: [{ campo: 'isVerified', antes: false, depois: true }],
          },
        }),
      );
    });

    it('na remoção, guarda o que se perdeu e não fotografa depois', async () => {
      capture.mockResolvedValueOnce({ title: 'Rêverie', isVerified: true });

      await lastValueFrom(comFoto.intercept(escrita('DELETE', undefined), ok));

      expect(capture).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            alvo: 'Rêverie',
            mudancas: [
              { campo: 'title', antes: 'Rêverie', depois: null },
              { campo: 'isVerified', antes: true, depois: null },
            ],
          },
        }),
      );
    });

    it('foto que falha não impede o registro', async () => {
      capture.mockResolvedValue(null);

      await lastValueFrom(
        comFoto.intercept(
          escrita('PATCH', { title: 'Novo', password: 'x' }),
          ok,
        ),
      );

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { dados: { title: 'Novo' } } }),
      );
    });

    it('apenasAdmin: dono comum editando o próprio envio não entra na trilha', async () => {
      getAllAndOverride.mockReturnValue({
        action: 'upload.work.update',
        entityType: 'work',
        entityIdParam: 'id',
        apenasAdmin: true,
      });

      await lastValueFrom(
        comFoto.intercept(escrita('PATCH', { title: 'x' }, 0), ok),
      );
      expect(record).not.toHaveBeenCalled();

      capture.mockResolvedValue({ title: 'x' });
      await lastValueFrom(
        comFoto.intercept(escrita('PATCH', { title: 'x' }, 2), ok),
      );
      expect(record).toHaveBeenCalledTimes(1);
    });
  });
});
