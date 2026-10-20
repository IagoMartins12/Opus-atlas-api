import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import {
  Observable,
  catchError,
  from,
  mergeMap,
  switchMap,
  throwError,
} from 'rxjs';
import { diffSnapshots, labelOf, sanitizeBody } from './audit-changes';
import { AUDIT_ACTION_KEY, AuditOptions } from './audit.decorator';
import { AuditService } from './audit.service';
import { AuditSnapshotService } from './audit-snapshot.service';

interface AuditableRequest extends Request {
  /** O papel vem do token como número (`AccessTokenPayload.role`). */
  user?: { sub?: string; role?: number | string };
}

type Registro = Record<string, unknown>;

const ESCRITA = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** O papel que abre o painel (`common/auth/roles.ts`: 2 é administrador). */
const PAPEL_ADMIN = 2;

/** O id do registro criado, nos formatos que as rotas devolvem. */
function idCriado(resposta: unknown): string | undefined {
  if (!resposta || typeof resposta !== 'object') return undefined;
  const r = resposta as { id?: unknown; data?: { id?: unknown } };
  const id = r.id ?? r.data?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Grava a trilha de auditoria das rotas anotadas com `@Audited()`.
 *
 * Registra sucesso e falha: uma tentativa de exclusão negada por permissão é
 * exatamente o tipo de evento que uma auditoria de segurança precisa mostrar.
 *
 * **O que mudou (29/09/2026).** Até aqui a trilha dizia quem, qual ação e em
 * qual id — não o quê. Agora, numa escrita sobre um tipo conhecido
 * (`AUDIT_ENTITIES`), o registro é fotografado antes e depois, e `metadata`
 * leva o nome do alvo (`alvo`) e a lista de campos alterados (`mudancas`, com
 * antes e depois). Sem foto possível, vai o corpo da requisição limpo
 * (`dados`) — sem senha, token, documento nem cartão, e com texto longo
 * cortado: a tabela existe para ser lida por humanos.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    @Optional() private readonly snapshots?: AuditSnapshotService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditOptions | undefined>(
      AUDIT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditableRequest>();

    // Rotas que servem a qualquer dono (editar o próprio envio) só entram na
    // trilha quando é um administrador agindo sobre o conteúdo dos outros.
    if (options.apenasAdmin && Number(request.user?.role) < PAPEL_ADMIN) {
      return next.handle();
    }

    const entityId = options.entityIdParam
      ? (request.params?.[options.entityIdParam] as string | undefined)
      : undefined;

    const base = {
      actorId: request.user?.sub,
      // A coluna é texto e o papel do token é número: passado cru, o Prisma
      // recusava a gravação e a trilha ficava vazia.
      actorRole:
        request.user?.role !== undefined
          ? String(request.user.role)
          : undefined,
      action: options.action,
      entityType: options.entityType,
      entityId,
      ipAddress: this.resolveIp(request),
      userAgent: request.headers['user-agent'],
      requestId: request.headers['x-request-id'] as string | undefined,
    };

    const metodo = (request.method ?? '').toUpperCase();
    const remocao = metodo === 'DELETE';
    const entidade =
      this.snapshots && ESCRITA.has(metodo)
        ? this.snapshots.entity(options.entityType)
        : null;
    const campos = entidade
      ? this.snapshots!.fieldsFor(entidade, remocao ? null : request.body)
      : [];

    const fotoAntes: Promise<Registro | null> =
      entidade && entityId
        ? this.snapshots!.capture(entidade, entityId, campos)
        : Promise.resolve(null);

    return from(fotoAntes).pipe(
      switchMap((antes) =>
        next.handle().pipe(
          mergeMap(async (resposta) => {
            const id = entityId ?? idCriado(resposta);
            const depois =
              entidade && id && !remocao
                ? await this.snapshots!.capture(entidade, id, campos)
                : null;

            void this.auditService.record({
              ...base,
              entityId: id,
              success: true,
              metadata: this.metadata(
                entidade?.label ?? [],
                antes,
                depois,
                request.body,
                remocao,
              ),
            });

            return resposta;
          }),
          catchError((error: unknown) => {
            const dados = sanitizeBody(request.body);
            void this.auditService.record({
              ...base,
              success: false,
              metadata: {
                error: error instanceof Error ? error.name : 'UnknownError',
                ...(error instanceof Error && error.message
                  ? { mensagem: error.message.slice(0, 200) }
                  : {}),
                ...(antes && entidade
                  ? { alvo: labelOf(antes, entidade.label) }
                  : {}),
                ...(dados ? { dados } : {}),
              } as Prisma.InputJsonValue,
            });

            return throwError(() => error);
          }),
        ),
      ),
    );
  }

  /**
   * O que vai em `metadata` numa ação que deu certo.
   *
   * Com foto: o nome do alvo e as mudanças. Sem foto (tipo desconhecido,
   * criação sem id na resposta, ação sem registro): o corpo limpo. As duas
   * coisas juntas quando a foto não cobriu o pedido inteiro — um POST de
   * "aprovar" não muda campo do corpo, mas o corpo diz o motivo.
   */
  private metadata(
    rotulo: readonly string[],
    antes: Registro | null,
    depois: Registro | null,
    corpo: unknown,
    remocao: boolean,
  ): Prisma.InputJsonValue | undefined {
    const alvo = labelOf(depois ?? antes, rotulo);
    const mudancas =
      antes || depois ? diffSnapshots(antes, remocao ? null : depois) : [];
    const dados = remocao ? null : sanitizeBody(corpo);
    const mudouTudo =
      mudancas.length > 0 &&
      !!dados &&
      Object.keys(dados).every((campo) =>
        mudancas.some((m) => m.campo === campo),
      );

    const out: Record<string, unknown> = {};
    if (alvo) out.alvo = alvo;
    if (mudancas.length) out.mudancas = mudancas;
    if (dados && !mudouTudo) out.dados = dados;

    return Object.keys(out).length ? (out as Prisma.InputJsonValue) : undefined;
  }

  private resolveIp(request: AuditableRequest): string | undefined {
    const forwardedFor = request.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0].trim();
    }

    return request.ip;
  }
}
