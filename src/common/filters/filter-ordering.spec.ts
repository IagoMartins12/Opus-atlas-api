import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { PrismaExceptionFilter } from './prisma-exception.filter';

@Controller('ordering')
class OrderingController {
  @Get('unique')
  unique(): never {
    throw new Prisma.PrismaClientKnownRequestError('duplicado', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['email'] },
    });
  }

  @Get('missing')
  missing(): never {
    throw new Prisma.PrismaClientKnownRequestError('sumiu', {
      code: 'P2025',
      clientVersion: 'test',
    });
  }

  @Get('boom')
  boom(): never {
    throw new Error('erro interno com segredo: senha=123');
  }
}

/**
 * Reproduz exatamente a ordem de registro de filtros do `AppModule`.
 * Se alguém inverter essa ordem, ou voltar a registrar o
 * `AllExceptionsFilter` via `useGlobalFilters` no `main.ts`, este teste falha.
 */
@Module({
  controllers: [OrderingController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
class OrderingTestModule {}

describe('Ordem dos filtros globais de exceção', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OrderingTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // Este é o teste de regressão do bug: o `AllExceptionsFilter` usa `@Catch()`
  // sem argumento e casa com qualquer exceção. Registrado depois do filtro do
  // Prisma, ele era sempre escolhido primeiro e o filtro específico virava
  // código morto — violação de unique voltava 500 em vez de 409.
  it('deixa o PrismaExceptionFilter traduzir P2002 em 409', async () => {
    const response = await request(app.getHttpServer()).get('/ordering/unique');

    expect(response.status).toBe(409);
    expect(response.body.statusCode).toBe(409);
  });

  it('deixa o PrismaExceptionFilter traduzir P2025 em 404', async () => {
    const response = await request(app.getHttpServer()).get(
      '/ordering/missing',
    );

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Registro não encontrado');
  });

  it('mantém o AllExceptionsFilter atendendo o que não é erro do Prisma', async () => {
    const response = await request(app.getHttpServer()).get('/ordering/boom');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      statusCode: 500,
      path: '/ordering/boom',
    });
  });

  it('normaliza o corpo de erro com os campos do contrato', async () => {
    const response = await request(app.getHttpServer()).get('/ordering/unique');

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: expect.any(Number),
        error: expect.any(String),
        message: expect.anything(),
        path: expect.any(String),
        timestamp: expect.any(String),
      }),
    );
  });

  it('nunca expõe stack trace na resposta', async () => {
    const response = await request(app.getHttpServer()).get('/ordering/boom');

    expect(JSON.stringify(response.body)).not.toContain('at ');
    expect(response.body).not.toHaveProperty('stack');
  });
});
