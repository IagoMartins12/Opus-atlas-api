import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { errorMessage } from '../utils/error.util';
import { isSensitiveField } from './audit-changes';
import { AUDIT_ENTITIES, AuditEntity } from './audit-entities';

type Registro = Record<string, unknown>;

interface Delegate {
  findUnique(args: unknown): Promise<Registro | null>;
}

/** Campos escalares e enum de cada model, lidos do DMMF uma vez. */
const ESCALARES = new Map<string, Set<string>>(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Set(
      model.fields
        .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
        .map((field) => field.name),
    ),
  ]),
);

const clientKey = (model: string) =>
  model.charAt(0).toLowerCase() + model.slice(1);

/** Na remoção, quantos campos da foto guardar: o bastante para reconhecer. */
const MAX_CAMPOS_REMOCAO = 12;

/**
 * Fotografa o registro que uma ação administrativa vai mudar.
 *
 * O interceptor pede a foto antes de a rota rodar e de novo depois; a
 * diferença é o que a trilha mostra. Só os campos que importam entram na
 * foto: os que vieram no corpo (é o que a ação pretendia mudar) e os de
 * rótulo. Numa remoção, os primeiros campos escalares — é o que se perde.
 *
 * **Nunca lança.** Falha ao fotografar vira foto ausente: a ação de negócio
 * não pode quebrar porque a auditoria não conseguiu ler.
 */
@Injectable()
export class AuditSnapshotService {
  private readonly logger = new Logger(AuditSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  entity(entityType?: string): AuditEntity | null {
    return entityType ? (AUDIT_ENTITIES[entityType] ?? null) : null;
  }

  /**
   * Os campos a fotografar: rótulo + os do corpo que existem no model.
   * Remoção (`corpo` nulo) leva os primeiros escalares do model.
   */
  fieldsFor(entity: AuditEntity, corpo: unknown): string[] {
    const escalares = ESCALARES.get(entity.model);
    if (!escalares) return [];

    const pedidos =
      corpo && typeof corpo === 'object' && !Array.isArray(corpo)
        ? Object.keys(corpo as Registro)
        : [...escalares].slice(0, MAX_CAMPOS_REMOCAO);

    return [
      ...new Set([
        ...entity.label,
        ...pedidos.filter(
          (campo) => escalares.has(campo) && !isSensitiveField(campo),
        ),
      ]),
    ].filter((campo) => escalares.has(campo));
  }

  async capture(
    entity: AuditEntity,
    id: string,
    campos: string[],
  ): Promise<Registro | null> {
    if (campos.length === 0 || !/^[a-f\d]{24}$/i.test(id)) return null;

    try {
      const delegate = (this.prisma as unknown as Record<string, Delegate>)[
        clientKey(entity.model)
      ];
      if (!delegate?.findUnique) return null;

      return await delegate.findUnique({
        where: { id },
        select: Object.fromEntries(campos.map((campo) => [campo, true])),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Foto de auditoria de ${entity.model} ${id} falhou: ${errorMessage(error).trim()}`,
      );
      return null;
    }
  }
}
