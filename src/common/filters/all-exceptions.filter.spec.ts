import { ArgumentsHost, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Erro interno (não-HTTP) só mostra a mensagem crua em desenvolvimento. Em
 * homologação a URL é pública, e a mensagem de um erro do Prisma carrega nome
 * de coleção e detalhe da consulta.
 */
describe('AllExceptionsFilter — mensagem de erro interno', () => {
  const original = process.env.NODE_ENV;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  function responder(): { message: unknown } {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ headers: {}, url: '/api/x', method: 'GET' }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new Error('Invalid `prisma.work.findMany()` in collection Work'),
      host,
    );

    return json.mock.calls[0][0] as { message: unknown };
  }

  it('mostra a mensagem em desenvolvimento, para depurar', () => {
    process.env.NODE_ENV = 'development';
    expect(responder().message).toContain('prisma.work.findMany');
  });

  it.each(['production', 'staging'])('esconde a mensagem em %s', (env) => {
    process.env.NODE_ENV = env;
    expect(responder().message).toBe('Erro interno do servidor');
  });
});
