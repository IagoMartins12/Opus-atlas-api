import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { describeFields, FieldInfo } from './field-policy';

/**
 * O subconjunto do delegate do Prisma que o navegador de banco usa.
 *
 * **Uma conversão de tipo, num lugar só, e é aqui.** Acessar
 * `prisma[nomeDoModel]` com uma string colapsa as sobrecargas do Prisma numa
 * união que o TypeScript não consegue chamar — é o mesmo problema que apareceu
 * na fatia de métricas. O legado resolvia escrevendo à mão um mapa de 70
 * entradas (`{ user: prisma.user, account: prisma.account, ... }`) **duplicado
 * em dois arquivos**, que já divergiam entre si: o mapa de `/records` tinha
 * `blogCommentLike` e o de `/models` não o listava na categorização.
 *
 * Aqui o mapa vem do DMMF, que é a mesma fonte que gerou o cliente — se um
 * model existe no schema, ele existe aqui, sem ninguém precisar lembrar.
 */
interface GenericDelegate {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
}

export interface ModelInfo {
  /** Nome no schema, ex.: `NewsletterCampaign`. */
  name: string;
  /** Chave no cliente Prisma, ex.: `newsletterCampaign`. */
  key: string;
  fields: FieldInfo[];
  /** Nome do campo identificador, quase sempre `id`. */
  idField: string;
}

const clientKey = (modelName: string): string =>
  modelName.charAt(0).toLowerCase() + modelName.slice(1);

@Injectable()
export class ModelRegistry {
  private readonly models = new Map<string, ModelInfo>();

  constructor(private readonly prisma: PrismaService) {
    for (const model of Prisma.dmmf.datamodel.models) {
      const fields = describeFields(model);
      const idField = fields.find((field) => field.isId);

      // Um model sem identificador não é navegável: não há como endereçar uma
      // linha para ler em detalhe, editar ou apagar.
      if (!idField) {
        continue;
      }

      this.models.set(model.name, {
        name: model.name,
        key: clientKey(model.name),
        fields,
        idField: idField.name,
      });
    }
  }

  list(): ModelInfo[] {
    return [...this.models.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  has(modelName: string): boolean {
    return this.models.has(modelName);
  }

  /**
   * Resolve o model pelo nome exato do schema.
   *
   * Sensível a maiúsculas de propósito: o legado aceitava qualquer string e
   * fazia `models[modelKey]`, devolvendo `undefined` para nome errado — que
   * virava um 404 genérico e, em `/export`, um `prisma[modelName]` cru.
   */
  require(modelName: string): ModelInfo {
    const model = this.models.get(modelName);

    if (!model) {
      throw new BadRequestException(
        `Model desconhecido: "${modelName}". Consulte GET /admin/database/models.`,
      );
    }

    return model;
  }

  field(model: ModelInfo, fieldName: string): FieldInfo {
    const field = model.fields.find((entry) => entry.name === fieldName);

    if (!field) {
      throw new BadRequestException(
        `Campo desconhecido em ${model.name}: "${fieldName}".`,
      );
    }

    if (field.isSecret) {
      throw new BadRequestException(
        `Campo "${model.name}.${fieldName}" é protegido e não pode ser lido, filtrado, ordenado nem escrito.`,
      );
    }

    return field;
  }

  delegate(model: ModelInfo): GenericDelegate {
    const client = this.prisma as unknown as Record<string, GenericDelegate>;
    const delegate = client[model.key];

    if (!delegate || typeof delegate.findMany !== 'function') {
      throw new BadRequestException(
        `Model ${model.name} existe no schema mas não no cliente Prisma — rode \`prisma generate\`.`,
      );
    }

    return delegate;
  }
}
