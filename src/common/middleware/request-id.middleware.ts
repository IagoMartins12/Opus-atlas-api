import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Gera (ou propaga, se já vier do client) um X-Request-Id único por requisição.
 * Esse ID percorre todo o ciclo de vida da request — logs, resposta de erro,
 * jobs de fila disparados — permitindo reconstruir o trace completo de uma
 * chamada específica (ver seção 3.9.1 do SPEC.md).
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : randomUUID();

    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
