import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

interface CapturedResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const makeHost = (response: CapturedResponse): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        url: '/api/works',
        method: 'POST',
        headers: {},
      }),
    }),
  }) as unknown as ArgumentsHost;

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('erro do prisma', {
    code,
    clientVersion: 'test',
    meta,
  });

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;
  let response: CapturedResponse;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  const body = () => response.json.mock.calls[0][0] as Record<string, unknown>;

  it('traduz P2002 (unique) em 409 Conflict', () => {
    filter.catch(
      prismaError('P2002', { target: ['email'] }),
      makeHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(body().statusCode).toBe(HttpStatus.CONFLICT);
  });

  it('traduz P2025 (não encontrado) em 404 Not Found', () => {
    filter.catch(prismaError('P2025'), makeHost(response));

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(body().message).toBe('Registro não encontrado');
  });

  it('traduz P2003 (chave estrangeira) em 409 Conflict', () => {
    filter.catch(prismaError('P2003'), makeHost(response));

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it('traduz ObjectId malformado (P2023) em 400 — `GET /works/nao-e-id` dava 500', () => {
    filter.catch(
      prismaError('P2023', {
        message:
          'Malformed ObjectID: provided hex string representation must be exactly 12 bytes',
      }),
      makeHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body().statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  it('mantém 500 para P2023 que não é ObjectId (dado inconsistente no banco)', () => {
    filter.catch(
      prismaError('P2023', { message: 'Inconsistent column data' }),
      makeHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('mantém 500 para código do Prisma sem tradução definida', () => {
    filter.catch(prismaError('P1001'), makeHost(response));

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('nunca devolve stack trace no corpo da resposta', () => {
    filter.catch(
      prismaError('P2002', { target: ['slug'] }),
      makeHost(response),
    );

    expect(body()).not.toHaveProperty('stack');
  });
});
